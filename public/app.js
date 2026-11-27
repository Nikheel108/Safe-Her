const content = document.querySelector('#content');
const state = {
  page: location.hash.slice(1) || 'overview',
  theme: 'light',
  demo: false,
  demoAllowed: false,
  authenticated: false,
  authConfigured: false,
  deviceId: 'WSD_001',
  device: null,
  live: null,
  sensorHistory: [],
  activeEvents: [],
  systemHistory: [],
  loadingLive: false,
  usbConnected: false,
  serialPort: null,
  serialReader: null,
  serialBuffer: '',
  serial: { logs: [], inSystemStatus: false },
  readingHistory: [],
  indexedDbReady: false,
  csvRecording: false,
  csvFileHandle: null,
  lastMapUpdatedAt: 0,
  overviewMapCoords: null,
  overviewLocationMap: null,
  overviewLocationMarker: null,
  emergencyLocationMap: null,
  emergencyLocationMarker: null,
  emergencyMapCoords: null,
  locationMap: null,
  locationMarker: null,
  chartRangeMins: 1,
  historySearch: '',
  historyFilter: 'all',
  historyDateRange: '7d',
  historySort: 'newest',
  historyPage: 1,
  historyPageSize: 10,
  contactEditingId: null,
  sosDelivery: null,
  emergency: null,
  activity: '—',
  confidence: 0,
  coords: { lat: null, lon: null, accuracy: null },
  series: [],
  events: [],
  contacts: [],
  sharedSosActive: false,
};
const csvReadingFields=['time','updatedAt','mpuConnected','whoAmI','accelX','accelY','accelZ','accelMagnitude','gyroX','gyroY','gyroZ','temperature','gpsCharacters','satellites','hdop','latitude','longitude','locationStatus','locationAge','altitude','speed','gpsDateTime','touch','buzzer','led','sos','fallDetection','freeFall','fallModelReady','fallProbability','fallPrediction','cancelHold'];
let csvWriteQueue=Promise.resolve();
let readingDatabase=null;
let readingWriteQueue=Promise.resolve();

function openReadingDatabase() {
  if(readingDatabase)return Promise.resolve(readingDatabase);
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('safeher-local-readings',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('reports'))request.result.createObjectStore('reports',{keyPath:'id'});};
    request.onsuccess=()=>{readingDatabase=request.result;resolve(readingDatabase);};
    request.onerror=()=>reject(request.error);
  });
}
function readAllStoredReports(db) {
  return new Promise((resolve,reject)=>{
    const request=db.transaction('reports','readonly').objectStore('reports').getAll();
    request.onsuccess=()=>resolve(request.result.sort((a,b)=>Number(a.time)-Number(b.time)));
    request.onerror=()=>reject(request.error);
  });
}
function writeStoredReports(db,reports,{clear=false}={}) {
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('reports','readwrite'),store=transaction.objectStore('reports');
    if(clear)store.clear();else reports.forEach(report=>store.put(report));
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||new Error('Local report storage transaction aborted'));
  });
}
async function restoreLocalState() {
  let saved=null;
  try {
    saved=JSON.parse(localStorage.getItem('safeher-local-device')||'null');
    saved??={};
    if(saved.serial&&typeof saved.serial==='object')state.serial={...state.serial,...saved.serial};
    if(Array.isArray(saved.series))state.series=saved.series.slice(-600);
    if(!state.series.length&&Array.isArray(saved.readingHistory))state.series=saved.readingHistory.map(r=>({x:Number(r.accelX),y:Number(r.accelY),z:Number(r.accelZ),t:Number(r.time)})).filter(r=>Number.isFinite(r.x)&&Number.isFinite(r.y)&&Number.isFinite(r.z)).slice(-120);
    if(Array.isArray(saved.readingHistory))state.readingHistory=saved.readingHistory;
    if(Array.isArray(saved.contacts))state.contacts=saved.contacts;
    if(saved.sosDelivery&&typeof saved.sosDelivery==='object')state.sosDelivery=saved.sosDelivery;
    state.events=[];
    state.demo=false;
    if(state.serial.latitude!=null&&state.serial.longitude!=null)state.coords={lat:Number(state.serial.latitude),lon:Number(state.serial.longitude),accuracy:state.serial.hdop==null?null:Number(state.serial.hdop)*5};
    state.emergency=state.serial.sos==='ACTIVE'?{type:'ESP32 SOS',source:'Device safety logic',time:new Date(state.serial.updatedAt||Date.now())}:null;
  } catch { /* Ignore a damaged or unavailable local browser cache. */ }
  if(!('indexedDB' in window))return;
  try {
    const db=await openReadingDatabase();
    const existing=await readAllStoredReports(db),known=new Set(existing.map(report=>report.id));
    const legacy=(Array.isArray(saved?.readingHistory)?saved.readingHistory:[]).map((report,index)=>({...report,id:report.id||`legacy-${report.time}-${index}`})).filter(report=>!known.has(report.id));
    if(legacy.length)await writeStoredReports(db,legacy);
    state.readingHistory=await readAllStoredReports(db);
    state.indexedDbReady=true;
    persistLocalState();
  } catch { state.indexedDbReady=false; }
}
function saveReadingReport(report) {
  if(!state.indexedDbReady){persistLocalState();return;}
  readingWriteQueue=readingWriteQueue.then(async()=>{
    const db=await openReadingDatabase();
    await writeStoredReports(db,[report]);
  }).catch(()=>{
    state.indexedDbReady=false;
    persistLocalState();
    toast('Could not save to the browser reading archive. Keep CSV recording on to protect new reports.','error');
  });
}
async function clearLocalReadings() {
  await readingWriteQueue;
  state.readingHistory=[];
  state.series=[];
  state.serial={logs:[],inSystemStatus:false};
  try {
    if('indexedDB' in window)await writeStoredReports(await openReadingDatabase(),[],{clear:true});
    persistLocalState();
    toast('Local sensor history cleared.');
    render();
  } catch { toast('Could not clear the local reading archive.','error'); }
}
function persistLocalState() {
  const saved={serial:state.serial,series:state.series.slice(-600),contacts:state.contacts,events:state.events.slice(-200),sosDelivery:state.sosDelivery};
  if(!state.indexedDbReady)saved.readingHistory=state.readingHistory;
  try { localStorage.setItem('safeher-local-device',JSON.stringify(saved)); }
  catch { toast('Browser storage is full; latest readings may not persist.','error'); }
}

try { if (localStorage.getItem('safeher-theme') === 'dark') state.theme = 'dark'; } catch {}
document.documentElement.dataset.theme = state.theme;

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('safeher-theme', theme); } catch {}
  const button = document.querySelector('#theme-toggle');
  const next = theme === 'light' ? 'dark' : 'light';
  button.setAttribute('aria-label', `Switch to ${next} mode`);
  button.title = `Switch to ${next} mode`;
  button.textContent = theme === 'light' ? '☾' : '☀';
  requestAnimationFrame(drawChart);
}

const pageNames = { overview: 'Overview', live: 'Live Monitoring', location: 'Location Tracking', emergency: 'Emergency Center', activity: 'Activity Detection', contacts: 'Emergency Contacts', history: 'Event History', device: 'Device Management', settings: 'Settings' };
const sensorDefs = [
  ['Accelerometer X', '0.12', 'g', '+0.02', 'violet'], ['Accelerometer Y', '0.34', 'g', '-0.01', 'pink'], ['Accelerometer Z', '0.98', 'g', '+0.04', 'green'],
  ['Gyroscope X', '1.2', '°/s', '+0.3', 'violet'], ['Gyroscope Y', '0.5', '°/s', '-0.1', 'pink'], ['Gyroscope Z', '0.8', '°/s', '+0.1', 'green'],
];
const icons = { device: '▣', activity: '⌁', location: '◎', communication: '⌁', sms: '✉', alert: '!', clock: '◷', walking: '↗' };
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowTime = date => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(date);
const fullDate = date => new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
const coordsText = () => `${Math.abs(state.coords.lat).toFixed(4)}° ${state.coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(state.coords.lon).toFixed(4)}° ${state.coords.lon >= 0 ? 'E' : 'W'}`;

function toast(message, kind = 'success') {
  const node = document.createElement('div'); node.className = `toast ${kind}`; node.textContent = message;
  document.querySelector('#toast-region').append(node); setTimeout(() => node.remove(), 3300);
}
function logEvent(type, detail, category = 'system') {
  state.events.unshift({ type, detail, time: new Date(), category });
  state.events = state.events.slice(0, 80);
}
function sparkline(color, phase) {
  const points = Array.from({ length: 16 }, (_, i) => `${i * 4},${12 + Math.sin(i * .7 + phase) * 6 + Math.cos(i * .37 + phase) * 3}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 60 24" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function hasUsbReadings() { return Boolean(state.usbConnected || state.serial.updatedAt); }
function metricCards() {
  if (hasUsbReadings()) return [['Accelerometer X',state.serial.accelX,'g'],['Accelerometer Y',state.serial.accelY,'g'],['Accelerometer Z',state.serial.accelZ,'g'],['Gyroscope X',state.serial.gyroX,'°/s'],['Gyroscope Y',state.serial.gyroY,'°/s'],['Gyroscope Z',state.serial.gyroZ,'°/s']].map(([name,value,unit])=>`<article class="sensor-card"><div class="sensor-label">${name}</div><div class="sensor-value">${value==null?'—':Number(value).toFixed(2)} <em>${value==null?'':unit}</em></div><div class="sensor-foot"><span>● USB serial</span><span>${state.usbConnected?'Live':'Last reading'}</span></div></article>`).join('');
  if (state.demo) return sensorDefs.map(([name, value, unit, delta, tone], i) => `<article class="sensor-card"><div class="sensor-label">${name}</div><div class="sensor-value">${value} <em>${unit}</em></div><div class="sensor-foot"><span>● Demo stream</span><span>${delta}</span></div>${sparkline(tone === 'pink' ? '#ed78b2' : tone === 'green' ? '#43cf9b' : '#a18cff', i * .9)}</article>`).join('');
  const r = state.live?.latest_sensor;
  if (!r) return '<div class="empty-state" style="grid-column:1/-1">No sensor samples have been stored yet. The first values will appear after the ESP32 uploads.</div>';
  return [['Accelerometer X',r.accel_x,'g'],['Accelerometer Y',r.accel_y,'g'],['Accelerometer Z',r.accel_z,'g'],['Gyroscope X',r.gyro_x,'°/s'],['Gyroscope Y',r.gyro_y,'°/s'],['Gyroscope Z',r.gyro_z,'°/s']].map(([name,value,unit],i)=>`<article class="sensor-card"><div class="sensor-label">${name}</div><div class="sensor-value">${Number(value).toFixed(2)} <em>${unit}</em></div><div class="sensor-foot"><span>● Stored device reading</span><span>${state.online?'Live':'Last saved'}</span></div>${sparkline(i%3===1?'#ed78b2':i%3===2?'#43cf9b':'#a18cff',i*.9)}</article>`).join('');
}
function statusCards() {
  if(hasUsbReadings()){
    const d=state.serial;
    const rows=[['Device Status',state.usbConnected?'USB connected':'USB disconnected',d.mpuConnected?'MPU sensor connected':'Waiting for status report',icons.device,'blue'],['Activity Status',d.sos==='ACTIVE'?'SOS active':d.freeFall==='YES'?'Freefall detected':'Monitoring',d.fallDetection?`Fall detection ${d.fallDetection.toLowerCase()}`:'Read from ESP32 serial',icons.activity,'purple'],['GPS Status',d.latitude!=null?'Location available':'No GPS fix',d.satellites!=null?`${d.satellites} satellites · HDOP ${d.hdop??'—'}`:'Waiting for GPS',icons.location,'pink'],['Connection','USB serial','Direct browser connection; no backend',icons.communication,'green']];
    return rows.map(([title,value,sub,icon,color])=>`<article class="status-card"><div class="status-top"><span>${title}</span><span class="status-icon ${color}">${icon}</span></div><div class="status-main">${esc(value)}</div><div class="status-sub">${esc(sub)}<span class="status-live">${state.usbConnected?'Live':'Last'}</span></div></article>`).join('');
  }
  const online = state.demo || state.online;
  const reported = state.live?.status;
  const rows = [
    ['Device Status', state.demo ? 'Demo online' : state.online ? 'Online' : state.device ? 'Offline' : 'Awaiting device', state.demo ? 'Illustrative device state' : state.device ? `Last heartbeat ${ageText(reported?.heartbeat_at || state.device.last_seen_at)}` : 'No device has uploaded yet', icons.device, 'blue'],
    ['Activity Status', state.demo ? state.activity : state.live?.latest_activity?.label ?? 'Unavailable', state.demo ? `Demo prediction · ${Math.round(state.confidence * 100)}%` : state.live?.latest_activity ? `Stored prediction · ${Math.round(state.live.latest_activity.confidence * 100)}%` : 'No activity prediction received', icons.activity, 'purple'],
    ['GPS Status', state.demo ? 'Location available' : state.live?.latest_location ? 'Location available' : 'No GPS fix', state.demo ? 'Illustrative coordinates' : state.live?.latest_location ? `Last fix ${ageText(state.live.latest_location.observed_at)}` : 'No saved GPS fix', icons.location, 'pink'],
    ['Communication', state.demo ? 'Wi-Fi active' : reported?.communication_method ?? 'Unknown', state.demo ? 'Illustrative status' : reported ? `Wi-Fi ${reported.wifi_status} · GSM ${reported.gsm_status}` : 'No heartbeat received', icons.communication, 'green'],
  ];
  return rows.map(([title, value, sub, icon, color]) => `<article class="status-card"><div class="status-top"><span>${title}</span><span class="status-icon ${color}">${icon}</span></div><div class="status-main">${esc(value)}</div><div class="status-sub">${esc(sub)}<span class="status-live">${state.demo ? 'Demo' : state.online ? 'Live' : state.device ? 'Offline' : 'Waiting'}</span></div></article>`).join('');
}
function ageText(value) { if (!value) return 'unknown'; const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(value))/1000)); return seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:`${Math.floor(seconds/3600)}h ago`; }
function updateReportAge() {
  const actions=content.querySelector('.live-command-heading .heading-actions');
  if(!actions)return;
  let stamp=actions.querySelector('.command-time');
  if(!stamp){stamp=document.createElement('span');stamp.className='command-time';actions.append(stamp);}
  const seconds=state.serial.updatedAt?Math.max(0,Math.floor((Date.now()-state.serial.updatedAt)/1000)):null;
  stamp.classList.toggle('report-stale',Boolean(state.usbConnected&&seconds!==null&&seconds>6));
  stamp.innerHTML=`${state.serial.updatedAt?nowTime(new Date(state.serial.updatedAt)):'—'}<small>${seconds===null?(state.usbConnected?'Waiting for serial report':'No device report yet'):state.usbConnected?`USB update ${seconds<2?'just now':`${seconds}s ago`} · expected every 2s`:`Last saved report ${ageText(state.serial.updatedAt)} · USB disconnected`}</small>`;
}
function latestSensor() { return state.demo || state.live?.latest_sensor; }
function hasLocation() { return state.demo || Boolean(state.live?.latest_location); }
function chartMarkup() {
  return `<div class="panel"><div class="panel-title-row"><div><div class="chart-heading">MOTION ACTIVITY</div><div class="chart-sub">Actual MPU accelerometer readings · g</div></div><div class="range-group" role="group" aria-label="Chart time range">${[1,5,15].map(m=>`<button class="${state.chartRangeMins===m?'active':''}" data-range="${m}">${m} min</button>`).join('')}</div></div><div class="chart-legend"><span><i class="legend-dot" style="background:#a18cff"></i>X axis</span><span><i class="legend-dot" style="background:#ed78b2"></i>Y axis</span><span><i class="legend-dot" style="background:#54cda2"></i>Z axis</span><span style="margin-left:auto">${state.usbConnected?'USB live':state.serial.updatedAt?'Saved locally':'Waiting for data'}</span></div><canvas class="chart-canvas" id="motion-chart" aria-label="ESP32 accelerometer chart"></canvas><div class="chart-foot"><span>Older</span><span>Now</span></div></div>`;
}

function mapSvg() {
  return `<svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid slice" aria-label="Illustrative Bengaluru street map"><rect width="420" height="220" fill="#17212b"/><path d="M-20 27 94 66l58-16 70 32 72-43 147 24M-15 180l118-56 68 15 81-44 183 48M75-15l18 88 54 30-12 127M260-10l-31 82 41 47-19 113M397-5l-48 78 34 65-14 98" fill="none" stroke="#293947" stroke-width="12"/><path d="M-18 27 94 66l58-16 70 32 72-43 147 24M-15 180l118-56 68 15 81-44 183 48M75-15l18 88 54 30-12 127M260-10l-31 82 41 47-19 113M397-5l-48 78 34 65-14 98" fill="none" stroke="#465460" stroke-width="1.4"/><path d="M-20 98 131 88l68 37 75-52 159 17M-10 149l124-46 93 74 112-53 120 20" fill="none" stroke="#33453e" stroke-width="5"/><path d="M-20 98 131 88l68 37 75-52 159 17M-10 149l124-46 93 74 112-53 120 20" fill="none" stroke="#6a8270" stroke-width="1"/><text x="36" y="52" fill="#bdc7c7" font-size="10">Vasant Nagar</text><text x="172" y="38" fill="#bdc7c7" font-size="9">Cubbon Road</text><text x="305" y="118" fill="#bdc7c7" font-size="10">MG Road</text><text x="120" y="194" fill="#93a19e" font-size="9">Residency Road</text><circle cx="236" cy="104" r="25" fill="#8d72ff" opacity=".13"/><circle cx="236" cy="104" r="13" fill="#8d72ff" opacity=".22"/></svg><div class="map-pin" aria-hidden="true"></div><div class="map-controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div><div class="map-caption"><div><strong>Current coordinates</strong><small>${state.demo ? coordsText() : 'Location unavailable'}</small></div><small>${state.demo ? `Accuracy ±${state.coords.accuracy} m` : 'Waiting for a device fix'}</small></div>`;
}
function usbGpsPreview() {
  const d=state.serial;
  return d.latitude==null||d.longitude==null?'<div class="empty-state">The ESP32 has not reported a GPS fix yet.</div>':`<div class="detail-card"><h3>Current ESP32 coordinates</h3><div class="detail-row"><span>Latitude</span><strong>${Number(d.latitude).toFixed(6)}</strong></div><div class="detail-row"><span>Longitude</span><strong>${Number(d.longitude).toFixed(6)}</strong></div><div class="detail-row"><span>Satellites</span><strong>${d.satellites??'—'}</strong></div><a class="button" style="display:inline-block;margin-top:12px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${d.latitude},${d.longitude}">Open in Maps ↗</a></div>`;
}
function activityRows(limit = 3) {
  return state.events.slice(0, limit).map(event => `<div class="activity-row"><span class="activity-icon">${event.category === 'alert' ? '!' : event.category === 'location' ? '◎' : event.category === 'activity' ? '⌁' : '▣'}</span><span class="activity-copy"><strong>${esc(event.type)}</strong><small>${esc(event.detail)}</small></span><time class="activity-time">${nowTime(event.time)}</time></div>`).join('') || '<div class="empty-state">No events recorded.</div>';
}
function overviewPage() {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour:'numeric', hour12:false, timeZone:'Asia/Kolkata' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="page-heading"><div><div class="eyebrow">SAFE HER / COMMAND CENTER</div><h1>Overview</h1><p>Your connected safety device at a glance.</p></div><div class="heading-actions"><span class="demo-chip"><i></i>${state.demo ? 'Demo preview' : hasUsbReadings() ? 'USB serial readings' : 'Waiting for USB'}</span><span class="section-meta">Use Connect ESP32 USB above for live readings</span></div></div><div class="hello-row"><div><h2>${greeting}, Ananya</h2><p>Monitor your safety device and stay informed.</p></div><div class="system-banner"><i></i>${state.emergency ? 'Emergency active — attention needed' : state.demo ? 'All demo systems operational' : 'Waiting for device connection'}</div></div><div class="status-grid">${statusCards()}</div><div class="section-row"><div class="section-header"><span class="section-title">LIVE SENSOR OVERVIEW</span><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : hasUsbReadings() ? 'USB LIVE DATA' : 'NO LIVE DATA'}</span><a class="footer-link" href="#live" data-navigate="live">View monitoring&nbsp; →</a></div><div class="sensor-grid">${(state.demo || hasUsbReadings()) ? metricCards() : '<div class="empty-state" style="grid-column:1/-1">Live sensor readings will appear when a device is connected.</div>'}</div></div><div class="section-row charts-grid">${(state.demo || hasUsbReadings()) ? chartMarkup() : '<div class="panel empty-state">Motion charts are unavailable until live sensor data arrives.</div>'}<div class="panel"><div class="panel-title-row"><div><div class="chart-heading">GPS LOCATION PREVIEW</div><div class="chart-sub">Most recent device location</div></div><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : hasUsbReadings() ? 'USB GPS DATA' : 'NO GPS FIX'}</span></div><div class="map-preview">${state.demo ? mapSvg() : hasUsbReadings() ? usbGpsPreview() : '<div class="empty-state">No GPS coordinates received yet.</div>'}</div></div></div><div class="section-row bottom-grid"><div class="panel emergency-panel"><div><div class="section-title">EMERGENCY STATUS</div><div class="safe-mark" style="margin-top:13px"><span class="safe-icon">${state.emergency ? '!' : '✓'}</span><span><strong>${state.emergency ? 'Emergency active' : state.demo ? 'Demo state: Safe' : 'Status unavailable'}</strong><small>${state.emergency ? `${state.emergency.type} · ${nowTime(state.emergency.time)}` : (state.demo ? 'No demo emergency is active.' : 'No device emergency status received.')}</small></span></div></div>${hasUsbReadings() ? '<span class="badge">Read-only USB status</span>' : `<button class="button ${state.emergency ? 'button-danger' : ''}" data-action="${state.emergency ? 'resolve-emergency' : 'sos'}">${state.emergency ? 'Resolve demo event' : 'Test demo SOS'}</button>`}</div><div class="panel"><div class="section-header"><span class="section-title">RECENT ACTIVITY</span><span class="badge">DEMO EVENT LOG</span><a class="footer-link" href="#history" data-navigate="history">View all&nbsp; →</a></div><div class="activity-list">${activityRows(3)}</div></div></div>`;
}

function livePage() {
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / SENSOR STREAM</div><h1>Live Monitoring</h1><p>Motion data and device signals, refreshed every 3 seconds in demo mode.</p></div><div class="heading-actions"><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : 'LIVE DEVICE MODE'}</span><button class="button ${state.emergency ? 'button-danger' : ''}" data-action="${state.emergency ? 'resolve-emergency' : 'sos'}">${state.emergency ? 'Resolve demo SOS' : 'Test demo SOS'}</button></div></div><div class="status-grid">${statusCards()}</div><div class="section-row"><div class="section-header"><span class="section-title">MPU6050 SENSOR READINGS</span><span class="section-meta">${state.demo ? 'Values below are illustrative only' : 'Waiting for the device to send telemetry'}</span></div><div class="sensor-grid">${(state.demo || hasUsbReadings()) ? metricCards() : '<div class="empty-state" style="grid-column:1/-1">No sensor readings have been received.</div>'}</div></div><div class="section-row charts-grid">${(state.demo || hasUsbReadings()) ? chartMarkup() : '<div class="panel empty-state">No accelerometer data yet.</div>'}<div class="panel"><div class="section-header"><span class="section-title">DEVICE SIGNALS</span><span class="badge">DEMO</span></div>${[['Touch sensor','Released'],['Buzzer','Off'],['Red LED','Off'],['GPS fix',state.demo?'Available':'Unavailable'],['ML prediction',state.demo?`${state.activity} · ${Math.round(state.confidence*100)}%`:'Not connected']].map(([a,b])=>`<div class="detail-row"><span>${a}</span><strong>${b}</strong></div>`).join('')}</div></div><div class="section-row panel"><div class="section-header"><span class="section-title">CLASSIFICATION</span><span class="badge success">${state.demo?'DEMO PREDICTION':'AWAITING DEVICE'}</span></div><div class="activity-big"><span class="status-icon purple">⌁</span><span><strong>${state.demo?esc(state.activity):'No prediction'}</strong><small>${state.demo?`Illustrative model confidence · ${Math.round(state.confidence*100)}% · Not an actual ML inference`:'Connect an inference source to show activity predictions.'}</small></span></div></div>`;
}
function locationPage() {
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / GPS</div><h1>Location Tracking</h1><p>Review the latest GPS fix reported by the safety device.</p></div><span class="demo-chip"><i></i>${(state.demo || hasUsbReadings())?'ILLUSTRATIVE DEMO LOCATION':'NO LIVE LOCATION'}</span></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">CURRENT LOCATION</span><span class="badge ${(state.demo || hasUsbReadings())?'success':''}">${(state.demo || hasUsbReadings())?'GPS FIX':'UNAVAILABLE'}</span></div><div class="map-preview" style="min-height:350px">${(state.demo || hasUsbReadings())?mapSvg():'<div class="empty-state">GPS coordinates are unavailable. The map will update when the device sends a valid fix.</div>'}</div><div class="detail-row"><span>Latitude / longitude</span><strong>${(state.demo || hasUsbReadings())?coordsText():'Unavailable'}</strong></div><div class="detail-row"><span>Accuracy</span><strong>${(state.demo || hasUsbReadings())?`±${state.coords.accuracy} m`:'Unavailable'}</strong></div><div class="detail-row"><span>Last updated</span><strong>${(state.demo || hasUsbReadings())?'Just now':'No update received'}</strong></div>${(state.demo || hasUsbReadings())?`<a class="button" style="display:inline-block;margin-top:12px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${state.coords.lat},${state.coords.lon}">Open in Google Maps ↗</a>`:''}</div><div class="card-stack"><div class="detail-card"><h3>Location details</h3><div class="detail-row"><span>Data source</span><strong>${(state.demo || hasUsbReadings())?'Demonstration coordinates':'No device data'}</strong></div><div class="detail-row"><span>Coordinates</span><strong>${(state.demo || hasUsbReadings())?coordsText():'—'}</strong></div><div class="detail-row"><span>Accuracy</span><strong>${(state.demo || hasUsbReadings())?`±${state.coords.accuracy} meters`:'—'}</strong></div></div><div class="detail-card"><h3>Location history</h3>${(state.demo || hasUsbReadings())?`<div class="activity-row"><span class="activity-icon">◎</span><span class="activity-copy"><strong>Vasant Nagar, Bengaluru</strong><small>${coordsText()}</small></span><time class="activity-time">Now</time></div>`:'<div class="empty-state">No location history received.</div>'}</div></div></div>`;
}
function emergencyPage() {
  const e = state.emergency;
  return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / SAFETY EVENTS</div><h1>Emergency Center</h1><p>Review alerts and their acknowledgement state.</p></div><button class="button button-danger" data-action="${e?'resolve-emergency':'sos'}">${e?'Resolve demo event':'Test demo SOS'}</button></div>${e?`<div class="panel" style="border-color:#6b3a48;margin-bottom:15px"><div class="section-header"><span class="section-title" style="color:#ffa5bc">DEMO EMERGENCY ACTIVE</span><span class="badge danger">UNACKNOWLEDGED</span></div><div class="wide-grid"><div class="detail-card"><h3>${esc(e.type)}</h3><div class="detail-row"><span>Trigger source</span><strong>${esc(e.source)}</strong></div><div class="detail-row"><span>Time</span><strong>${nowTime(e.time)}</strong></div><div class="detail-row"><span>Location</span><strong>${coordsText()}</strong></div><div class="detail-row"><span>Notification status</span><strong>Demo only · not sent</strong></div></div><div class="detail-card"><h3>Event timeline</h3><div class="timeline"><div class="timeline-item"><strong>Demo SOS triggered</strong><small>${nowTime(e.time)}</small><p>No calls or SMS messages were sent.</p></div><div class="timeline-item"><strong>Location attached</strong><small>${coordsText()}</small><p>Illustrative demo coordinates.</p></div></div></div></div><div style="margin-top:12px;display:flex;gap:8px"><button class="button" data-action="acknowledge">Acknowledge demo alert</button><button class="button button-danger" data-action="resolve-emergency">Resolve demo event</button></div></div>`:`<div class="panel empty-state"><strong>No active emergencies</strong>The device has no active emergency event. A demo SOS can be triggered to preview the response workflow; it does not contact anyone.</div>`}<div class="panel"><div class="section-header"><span class="section-title">EMERGENCY EVENT HISTORY</span><span class="badge">${state.events.filter(x=>x.category==='alert').length} demo events</span></div>${state.events.filter(x=>x.category==='alert').length?`<div class="activity-list">${activityRows(80)}</div>`:'<div class="empty-state">No emergency events recorded.</div>'}</div>`;
}
function activityPage() {
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / CLASSIFICATION</div><h1>Activity Detection</h1><p>Prediction display is an integration surface; this demo does not run a machine learning model.</p></div><span class="demo-chip"><i></i>${state.demo?'ILLUSTRATIVE DEMO DATA':'LIVE DEVICE MODE'}</span></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">CURRENT CLASSIFICATION</span><span class="badge warning">DEMO ONLY</span></div><div class="activity-big"><span class="status-icon purple">⌁</span><span><strong>${state.demo?esc(state.activity):'No activity received'}</strong><small>${state.demo?`Illustrative confidence · ${Math.round(state.confidence*100)}%`:'Predictions will appear when sent by an integrated inference service.'}</small></span></div><div class="detail-row" style="margin-top:12px"><span>Inference source</span><strong>${state.demo?'Simulated UI state':'Not connected'}</strong></div><div class="detail-row"><span>Detection time</span><strong>${state.demo?nowTime(new Date()):'Unavailable'}</strong></div><div class="detail-row"><span>Automatic SOS</span><strong>Not evaluated by this demo</strong></div></div><div class="panel"><div class="section-header"><span class="section-title">ACTIVITY HISTORY</span><span class="badge">DEMO</span></div><div class="activity-list">${state.events.filter(x=>x.category==='activity'||x.category==='alert').map(e=>`<div class="activity-row"><span class="activity-icon">${e.category==='alert'?'!':'⌁'}</span><span class="activity-copy"><strong>${esc(e.type)}</strong><small>${esc(e.detail)}</small></span><time class="activity-time">${nowTime(e.time)}</time></div>`).join('')||'<div class="empty-state">No activity predictions received.</div>'}</div></div></div><div class="panel section-row"><div class="section-header"><span class="section-title">SUPPORTED CLASSIFICATIONS</span><span class="section-meta">Values below are illustrative UI categories</span></div><div class="detail-row"><span>Normal activity · Walking · Running · Sudden movement · Potential fall</span><strong>Awaiting integrated model</strong></div><p class="chart-sub">Prediction confidence and activity labels must come from an ESP32 or backend inference integration. The dashboard never claims to run a model.</p></div>`;
}
function contactsPage() {
  return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / TRUSTED PEOPLE</div><h1>Emergency Contacts</h1><p>Manage the demo contact list. No contact is notified by this dashboard.</p></div><span class="demo-chip"><i></i>LOCAL DEMO ONLY</span></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">SAVED CONTACTS</span><span class="badge">${state.contacts.length} contacts</span></div>${state.contacts.length?state.contacts.map(c=>`<div class="detail-card contact-card"><span class="contact-avatar">${esc(c.name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase())}</span><span class="contact-info"><strong>${esc(c.name)} ${c.primary?'<span class="badge success">PRIMARY</span>':''}</strong><small>${esc(c.relationship)} · ${esc(c.phone)} · Priority ${c.priority} · ${c.active?'Active':'Inactive'}</small></span><span class="contact-actions"><button class="button button-quiet" data-action="contact-primary" data-id="${c.id}">${c.primary?'Primary':'Set primary'}</button><button class="button button-quiet" data-action="contact-delete" data-id="${c.id}">Remove</button></span></div>`).join(''):'<div class="empty-state">No contacts added.</div>'}<p class="field-help">Contact records in this prototype stay in page memory only and are not uploaded or stored securely.</p></div><form class="panel" id="contact-form"><div class="section-header"><span class="section-title">ADD CONTACT</span></div><div class="form-grid"><div class="form-field"><label for="contact-name">Name</label><input id="contact-name" name="name" required maxlength="60" placeholder="Contact name" /></div><div class="form-field"><label for="contact-phone">Indian mobile number</label><input id="contact-phone" name="phone" required inputmode="tel" placeholder="+91 98765 43210" /><div class="field-help">Use a valid 10-digit Indian mobile number.</div></div><div class="form-field"><label for="contact-relationship">Relationship</label><input id="contact-relationship" name="relationship" required maxlength="40" placeholder="Family, friend…" /></div><div class="form-field"><label for="contact-priority">Priority</label><select id="contact-priority" name="priority"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></div></div><button class="button button-primary" style="margin-top:13px" type="submit">Add demo contact</button></form></div>`;
}
function historyPage() {
  const filtered = state.events.filter(e => {
    const q = (document.querySelector('#event-search')?.value || '').toLowerCase();
    const type = document.querySelector('#event-filter')?.value || 'all';
    return (type === 'all' || e.category === type) && `${e.type} ${e.detail}`.toLowerCase().includes(q);
  });
  return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / AUDIT TRAIL</div><h1>Event History</h1><p>Review demo and device events in chronological order.</p></div><button class="button" data-action="export-csv">Export CSV ↓</button></div><div class="panel"><div class="heading-actions" style="justify-content:flex-start;margin-bottom:14px"><input class="select-control" id="event-search" type="search" placeholder="Search events" aria-label="Search events" /><select class="select-control" id="event-filter" aria-label="Filter event type"><option value="all">All event types</option><option value="alert">Emergency</option><option value="activity">Activity</option><option value="location">Location</option><option value="device">Device</option></select><span class="demo-chip"><i></i>DEMO EVENT LOG</span></div><div class="table-wrap"><table><thead><tr><th>EVENT</th><th>DETAIL</th><th>CATEGORY</th><th>TIME</th></tr></thead><tbody>${filtered.map(e=>`<tr><td>${esc(e.type)}</td><td class="muted">${esc(e.detail)}</td><td><span class="badge ${e.category==='alert'?'danger':''}">${esc(e.category)}</span></td><td>${nowTime(e.time)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No events match these filters.</td></tr>'}</tbody></table></div><p class="field-help">Export contains only the events currently shown. This prototype keeps its event log in page memory.</p></div>`;
}
function devicePage() {
  const online = state.demo || state.online;
  return `<div class="page-heading"><div><div class="eyebrow">MANAGE / CONNECTED HARDWARE</div><h1>Device Management</h1><p>Hardware capabilities are shown as reported; unsupported telemetry stays unavailable.</p></div><span class="demo-chip"><i></i>${online?'ILLUSTRATIVE DEMO STATUS':'NO DEVICE CONNECTED'}</span></div><div class="wide-grid"><div class="card-stack">${[['ESP32 DevKit','Ananya',online?'Online':'Offline','Wi-Fi connection',online?'Connected':'Unavailable','Firmware version','Not reported'],['SIM800L GSM','Emergency fallback',online?'Ready (demo)':'Unavailable','Network registration','Not reported','Signal strength','Not reported'],['NEO-6M GPS','Location module',online?'Fix available (demo)':'No fix','Latitude / longitude',online?coordsText():'Unavailable','Satellites','Not reported'],['MPU6050','Motion sensor',online?'Connected (demo)':'Unavailable','Last reading',online?'Illustrative only':'Unavailable','Sample interval','3 seconds (demo)']].map(([name,id,status,l1,v1,l2,v2])=>`<div class="detail-card"><div class="section-header"><h3 style="margin:0">${name}</h3><span class="badge ${online?'success':''}">${status}</span></div><div class="detail-row"><span>Module / name</span><strong>${id}</strong></div><div class="detail-row"><span>${l1}</span><strong>${v1}</strong></div><div class="detail-row"><span>${l2}</span><strong>${v2}</strong></div></div>`).join('')}</div><div class="card-stack"><div class="detail-card"><h3>Device configuration</h3><div class="form-field"><label for="device-id">Device name</label><input id="device-id" value="Ananya" readonly /></div><div class="form-field" style="margin-top:10px"><label for="sensor-interval">Sensor update interval</label><select id="sensor-interval"><option>3 seconds</option><option>5 seconds</option><option>10 seconds</option></select></div><div class="form-field" style="margin-top:10px"><label for="gps-interval">GPS update interval</label><select id="gps-interval"><option>5 seconds</option><option>10 seconds</option><option>30 seconds</option></select></div><p class="field-help">Settings are a UI preview and are not sent to hardware.</p></div><div class="detail-card"><h3>Integration status</h3><div class="empty-state">No ESP32 integration endpoint is configured in this first dashboard phase.</div></div></div></div>`;
}
function settingsPage() {
  return `<div class="page-heading"><div><div class="eyebrow">MANAGE / PREFERENCES</div><h1>Settings</h1><p>Dashboard preferences and safety workflow configuration.</p></div><span class="demo-chip"><i></i>LOCAL PREVIEW</span></div><div class="wide-grid"><form class="panel" id="settings-form"><div class="section-header"><span class="section-title">SAFETY PREFERENCES</span></div><div class="form-field"><label for="helpline">Emergency helpline number</label><input id="helpline" name="helpline" inputmode="tel" placeholder="Enter a number" /><div class="field-help">This prototype does not place calls or send messages.</div></div><div class="form-field" style="margin-top:12px"><label for="update-interval">Sensor update interval</label><select id="update-interval" name="interval"><option>3 seconds</option><option>5 seconds</option><option>10 seconds</option></select></div><div class="toggle-row"><span><strong>Show demo sensor data</strong><small>Mark the dashboard as illustrative demo mode.</small></span><input class="switch" type="checkbox" name="demo" ${state.demo?'checked':''} /></div><div class="toggle-row"><span><strong>Activity notifications</strong><small>Preference preview only; no messages are sent.</small></span><input class="switch" type="checkbox" name="notifications" checked /></div><button class="button button-primary" type="submit">Save preferences</button></form><div class="card-stack"><div class="detail-card"><h3>Communication preference</h3><div class="detail-row"><span>Wi-Fi</span><strong>Preferred on ESP32</strong></div><div class="detail-row"><span>GSM fallback</span><strong>Handled by device firmware</strong></div><p class="field-help">The dashboard reports communication status from device telemetry. It does not detect GSM availability or perform message fallback.</p></div><div class="detail-card"><h3>Account</h3><div class="detail-row"><span>Profile</span><strong>Ananya Khadakabhavi</strong></div><div class="detail-row"><span>Role</span><strong>Administrator</strong></div><div class="detail-row"><span>Authentication</span><strong>Not connected</strong></div></div></div></div>`;
}
const renderers = { overview: overviewPage, live: livePage, location: locationPage, emergency: emergencyPage, activity: activityPage, contacts: contactsPage, history: historyPage, device: devicePage, settings: settingsPage };

function drawChart() {
  const canvas = document.querySelector('#motion-chart'); if (!canvas) return;
  const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height, pad = { left: 20, right: 8, top: 7, bottom: 13 };
  ctx.strokeStyle = state.theme === 'light' ? '#d8dfeb' : '#253043'; ctx.lineWidth = 1; ctx.font = '8px DM Sans'; ctx.fillStyle = state.theme === 'light' ? '#68758a' : '#78849a';
  for (let i = 0; i < 4; i++) { const y = pad.top + i * (h - pad.top - pad.bottom) / 3; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke(); ctx.fillText((1.5 - i).toFixed(1), 0, y + 3); }
  const cutoff=Date.now()-state.chartRangeMins*60_000; const points=state.series.filter(p=>!p.t||p.t>=cutoff);
  if(!points.length){ctx.fillStyle=state.theme==='light'?'#68758a':'#9ba6b9';ctx.font='11px DM Sans';ctx.fillText('Waiting for ESP32 samples',pad.left,h/2);return;}
  const colors = ['#a18cff', '#ed78b2', '#54cda2'];
  colors.forEach((color, line) => { ctx.beginPath(); points.forEach((point, i) => { const value = [point.x, point.y, point.z][line]; const x = pad.left + i * (w - pad.left - pad.right) / Math.max(1,points.length - 1); const y = pad.top + (1 - (value + 1.5) / 3) * (h - pad.top - pad.bottom); if (!i) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke(); });
}
function applySosVisual() {
  const active=state.serial.sos==='ACTIVE'||state.sharedSosActive;
  document.documentElement.classList.toggle('sos-active',active);
  const banner=document.querySelector('#sos-alert-banner');
  if(banner){banner.hidden=!active;banner.textContent=active?'SOS ACTIVE · The ESP32 reports an active emergency. Use the device touch control to cancel.':'';}
}
let sosAudioContext=null;
function playSosAlarm(){
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return;
    sosAudioContext??=new AudioContextClass();void sosAudioContext.resume();
    const start=sosAudioContext.currentTime;
    for(let i=0;i<6;i++){
      const oscillator=sosAudioContext.createOscillator(),gain=sosAudioContext.createGain(),at=start+i*.42;
      oscillator.type='sawtooth';oscillator.frequency.setValueAtTime(i%2?740:960,at);
      gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.16,at+.025);gain.gain.exponentialRampToValueAtTime(.0001,at+.32);
      oscillator.connect(gain);gain.connect(sosAudioContext.destination);oscillator.start(at);oscillator.stop(at+.34);
    }
  }catch{}
}
function setSharedSos(active,{announce=false}={}){
  state.sharedSosActive=active;
  try{localStorage.setItem('safeher-sos-status',JSON.stringify({active,updatedAt:Date.now(),source:active?'Safe Her SOS':'Safe Her'}));}catch{}
  applySosVisual();
  if(announce&&active)playSosAlarm();
}
function render({preserveInputs=false}={}) {
  const focusedId=preserveInputs&&content.contains(document.activeElement)?document.activeElement.id:null;
  const inputState=preserveInputs?Array.from(content.querySelectorAll('input,select,textarea')).map(el=>({id:el.id,value:el.value,checked:el.checked,start:typeof el.selectionStart==='number'?el.selectionStart:null,end:typeof el.selectionEnd==='number'?el.selectionEnd:null})):[];
  if (!renderers[state.page]) state.page = 'overview';
  content.classList.toggle('activity-layout',state.page==='activity');
  const usbPages={overview:usbOverviewPage,live:serialDashboardPage,location:usbLocationPage,emergency:usbEmergencyPage,activity:usbActivityPage,contacts:usbContactsPage,history:usbHistoryPage,device:usbDevicePage,settings:usbSettingsPage};
  content.innerHTML = usbPages[state.page]();
  if(state.page==='overview'){state.overviewMapCoords=null;initializeOverviewMap();}
  if(state.page==='emergency')initializeEmergencyLocationMap();
  if(state.page==='activity')content.querySelector('.activity-side-stack')?.insertAdjacentHTML('afterbegin',activityDistributionMarkup());
  for(const saved of inputState){const el=document.getElementById(saved.id);if(el){el.value=saved.value;if(el.type==='checkbox')el.checked=saved.checked;}}
  if(state.page==='location')initializeLocationMap();
  applySosVisual();
  document.querySelector('#breadcrumb-current').textContent = pageNames[state.page];
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === state.page));
  const count = document.querySelector('#nav-emergency-count'); if (count) { const active=state.demo?Boolean(state.emergency):state.serial.sos==='ACTIVE'; count.hidden=!active; if(active)count.textContent='1'; }
  document.querySelector('#top-date').textContent = fullDate(new Date());
  const connection = document.querySelector('.connection-pill');
  connection.classList.toggle('offline', !state.usbConnected);
  connection.querySelector('span').textContent = state.usbConnected ? 'USB serial connected' : 'USB disconnected';
  const usbButton=document.querySelector('#usb-connect'); if(usbButton)usbButton.textContent=state.usbConnected?'Disconnect USB':'Connect ESP32 USB';
  updateReportAge();
  drawChart(); drawFallChart(); bindPageActions();
  if(focusedId){const el=document.getElementById(focusedId);if(el){el.focus({preventScroll:true});if(inputState[0]?.start!=null&&typeof el.setSelectionRange==='function'){const saved=inputState.find(x=>x.id===focusedId);if(saved?.start!=null)el.setSelectionRange(saved.start,saved.end);}}}
}
function liveDashboardPage() {
  const data=state.live, sensor=data?.latest_sensor, loc=data?.latest_location, status=data?.status;
  const stamp=sensor?.observed_at || loc?.observed_at || status?.heartbeat_at || state.device?.last_seen_at;
  const offlineLabel=state.online?'Live device telemetry':state.device?'ESP32 is offline · displaying the last data saved in the database':'Waiting for the first ESP32 upload';
  if(state.page==='emergency') return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / SAFETY EVENTS</div><h1>Emergency Center</h1><p>Emergency status and event history from the device.</p></div></div>${state.activeEvents.length?state.activeEvents.map(e=>`<article class="panel" style="margin-bottom:12px"><div class="section-header"><span class="section-title">${esc(e.event_type.replaceAll('_',' ').toUpperCase())}</span><span class="badge danger">${esc(e.alert_status)}</span></div><div class="detail-row"><span>Trigger</span><strong>${esc(e.trigger_source)}</strong></div><div class="detail-row"><span>Observed</span><strong>${new Date(e.observed_at).toLocaleString()}</strong></div><div class="detail-row"><span>Location</span><strong>${e.latitude==null?'Not available':`${Number(e.latitude).toFixed(6)}, ${Number(e.longitude).toFixed(6)}`}</strong></div><div class="detail-row"><span>Acknowledged</span><strong>${e.acknowledged_at?new Date(e.acknowledged_at).toLocaleString():'Not yet'}</strong></div><div style="display:flex;gap:8px;margin-top:12px"><button class="button" data-action="acknowledge-live-event" data-id="${esc(e.id)}">Acknowledge</button><button class="button button-danger" data-action="resolve-live-event" data-id="${esc(e.id)}">Resolve</button></div></article>`).join(''):'<div class="panel empty-state">No active emergency events.</div>'}`;
  if(state.page==='history') return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / AUDIT TRAIL</div><h1>Event History</h1><p>Events saved by the Safe Her API.</p></div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Event</th><th>Details</th><th>Category</th><th>Time</th></tr></thead><tbody>${state.systemHistory.map(e=>`<tr><td>${esc(e.event_type)}</td><td class="muted">${esc(e.detail)}</td><td><span class="badge">${esc(e.category)}</span></td><td>${new Date(e.observed_at).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No events have been saved.</td></tr>'}</tbody></table></div></div>`;
  if(state.page==='device') return `<div class="page-heading"><div><div class="eyebrow">MANAGE / DEVICE</div><h1>Device Management</h1><p>${esc(offlineLabel)}</p></div></div><div class="panel"><div class="detail-row"><span>Device ID</span><strong>${esc(state.device?.id||state.deviceId)}</strong></div><div class="detail-row"><span>Firmware</span><strong>${esc(state.device?.firmware_version||'Not reported')}</strong></div><div class="detail-row"><span>Last seen</span><strong>${state.device?.last_seen_at?new Date(state.device.last_seen_at).toLocaleString():'No upload yet'}</strong></div>${[['Wi-Fi',status?.wifi_status],['Communication',status?.communication_method],['GPS',status?.gps_status],['MPU6050',status?.mpu6050_status]].map(([label,value])=>`<div class="detail-row"><span>${label}</span><strong>${esc(value||'Not reported')}</strong></div>`).join('')}</div>`;
  if (state.page==='location') return `<div class="page-heading"><div><div class="eyebrow">MONITORING / GPS</div><h1>Location Tracking</h1><p>${esc(offlineLabel)}</p></div></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">LAST SAVED GPS FIX</span><span class="badge ${loc?'success':''}">${loc?state.online?'LIVE':'SAVED':'NO FIX'}</span></div>${loc?`<div class="detail-row"><span>Latitude / longitude</span><strong>${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)}</strong></div><div class="detail-row"><span>Accuracy</span><strong>${loc.accuracy_m==null?'Not reported':`±${Number(loc.accuracy_m).toFixed(0)} m`}</strong></div><div class="detail-row"><span>Satellites</span><strong>${loc.satellites??'Not reported'}</strong></div><div class="detail-row"><span>Observed</span><strong>${new Date(loc.observed_at).toLocaleString()}</strong></div><a class="button" style="display:inline-block;margin-top:12px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}">Open saved location in Maps ↗</a>`:'<div class="empty-state">No GPS fixes are saved yet.</div>'}</div><div class="panel"><div class="section-title">DEVICE</div>${statusCards()}</div></div>`;
  if (state.page==='activity') return `<div class="page-heading"><div><div class="eyebrow">MONITORING / CLASSIFICATION</div><h1>Activity Detection</h1><p>Activity predictions appear only if the ESP32 sends a supported label.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">LATEST PREDICTION</div>${data?.latest_activity?`<div class="activity-big"><span class="status-icon purple">⌁</span><span><strong>${esc(data.latest_activity.label)}</strong><small>${Math.round(data.latest_activity.confidence*100)}% confidence · ${new Date(data.latest_activity.observed_at).toLocaleString()}</small></span></div>`:'<div class="empty-state">No activity prediction has been uploaded.</div>'}</div><div class="panel"><div class="section-title">DEVICE HEALTH</div>${statusCards()}</div></div>`;
  return `<div class="page-heading"><div><div class="eyebrow">SAFE HER / ${state.page==='overview'?'COMMAND CENTER':'SENSOR STREAM'}</div><h1>${state.page==='overview'?'Overview':'Live Monitoring'}</h1><p>${esc(offlineLabel)}${stamp?` · Last update ${esc(ageText(stamp))}`:''}</p></div><div class="heading-actions"><span class="demo-chip"><i></i>${state.online?'LIVE':'LAST SAVED'}</span><button class="button" data-action="refresh-live">Refresh now</button></div></div><div class="status-grid">${statusCards()}</div><div class="section-row"><div class="section-header"><span class="section-title">${state.online?'LIVE':'LAST SAVED'} MPU6050 READINGS</span><span class="section-meta">${stamp?`Observed ${new Date(stamp).toLocaleString()}`:'No saved sample yet'}</span></div><div class="sensor-grid">${metricCards()}</div></div><div class="section-row charts-grid">${sensor?liveChartMarkup():'<div class="panel empty-state">Motion chart will appear after the first upload.</div>'}<div class="panel"><div class="section-title">DEVICE SIGNALS</div>${[['Touch sensor',status?.touch_active],['Buzzer',status?.buzzer_active],['Red LED',status?.red_led_active],['Wi-Fi',status?.wifi_status],['GPS',status?.gps_status],['MPU6050',status?.mpu6050_status]].map(([label,value])=>`<div class="detail-row"><span>${label}</span><strong>${value==null?'Not reported':typeof value==='boolean'?value?'Active':'Inactive':esc(value)}</strong></div>`).join('')}</div></div><div class="section-row panel"><div class="section-title">LATEST LOCATION & ACTIVITY</div><div class="wide-grid"><div class="detail-row"><span>GPS</span><strong>${loc?`${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)} · ${ageText(loc.observed_at)}`:'No saved fix'}</strong></div><div class="detail-row"><span>Activity</span><strong>${data?.latest_activity?`${esc(data.latest_activity.label)} · ${Math.round(data.latest_activity.confidence*100)}%`:'No prediction uploaded'}</strong></div></div></div>`;
}
function liveChartMarkup() {
  const rows=state.sensorHistory.length?state.sensorHistory:[state.live.latest_sensor];
  const values=rows.map(r=>({x:Number(r.accel_x),y:Number(r.accel_y),z:Number(r.accel_z)}));
  return `<div class="panel"><div class="panel-title-row"><div><div class="chart-heading">MPU6050 MOTION</div><div class="chart-sub">Most recent ${values.length} stored readings</div></div><span class="badge">${state.online?'LIVE':'SAVED'}</span></div><canvas class="chart-canvas" id="motion-chart" aria-label="Stored ESP32 accelerometer readings"></canvas></div>`;
}
function serialDashboardPage() {
  const d=state.serial; const v=x=>x==null?'—':esc(x); const gps=d.latitude!=null&&d.longitude!=null;
  if(gps){state.lastMapCoords=[Number(d.latitude),Number(d.longitude)];state.lastMapUpdatedAt=Date.now();}
  const row=(name,value)=>`<div class="detail-row"><span>${name}</span><strong>${v(value)}</strong></div>`;
  const sensors=[['Accelerometer X',d.accelX,'g','#8d63ff'],['Accelerometer Y',d.accelY,'g','#ec4899'],['Accelerometer Z',d.accelZ,'g','#3b82f6'],['Acceleration magnitude',d.accelMagnitude,'g','#16b88a'],['Gyroscope X',d.gyroX,'°/s','#8d63ff'],['Gyroscope Y',d.gyroY,'°/s','#ec4899'],['Gyroscope Z',d.gyroZ,'°/s','#3b82f6'],['Temperature',d.temperature,'°C','#f59e0b']];
  const alarmActive=d.sos==='ACTIVE';
  const modules=[['ESP32',state.usbConnected?'Connected':'Disconnected',state.usbConnected],['MPU6050',d.mpuConnected?'Connected':d.updatedAt?'Disconnected':'Waiting',Boolean(d.mpuConnected)],['Touch sensor',d.touch||'Waiting',Boolean(d.touch)],['Buzzer',alarmActive?'Pulsing':d.buzzer||'Waiting',alarmActive||d.buzzer==='ON'],['Red LED',alarmActive?'Flashing':d.led||'Waiting',alarmActive||d.led==='ON'],['GPS module',gps?'Fix available':'Waiting for fix',gps],['Safety status',d.sos||'Waiting',d.sos==='ACTIVE']];
  return `<div class="command-heading live-command-heading"><div><div class="eyebrow">SAFE HER / HARDWARE TELEMETRY</div><h1>Live Device Monitoring</h1><p>Real sensor output streamed directly from your ESP32.</p></div><div class="heading-actions"><span class="badge ${state.usbConnected?'success':''}"><i class="status-dot"></i>${state.usbConnected?'USB CONNECTED':'USB DISCONNECTED'}</span>${d.updatedAt?`<span class="command-time">${nowTime(new Date(d.updatedAt))}<small>Last device report</small></span>`:''}</div></div>${!state.usbConnected?'<div class="connect-notice"><strong>Connect your ESP32 to start live monitoring</strong><span>Close Arduino Serial Monitor, use Chrome or Edge on localhost, then select the ESP32 USB port.</span><button class="button button-primary" data-action="usb-toggle">Connect ESP32 USB</button></div>':''}<div class="module-grid">${modules.map(([name,value,active])=>`<article class="module-card"><span class="module-icon ${active?'module-ready':''}">${name==='ESP32'?'▣':name==='GPS module'?'◎':name==='Buzzer'?'♬':name==='Red LED'?'◉':name==='Safety status'?'盾':'⌁'}</span><span class="module-copy"><small>${name}</small><strong>${esc(value)}</strong></span><i class="module-indicator ${active?'':'module-idle'}"></i></article>`).join('')}</div><div class="section-row"><div class="section-header"><div><span class="section-title">SENSOR TELEMETRY</span><small class="section-caption">${d.updatedAt?`LAST REPORT ${new Date(d.updatedAt).toLocaleTimeString()}`:'WAITING FOR FIRST DEVICE REPORT'}</small></div><span class="badge ${state.usbConnected?'success':''}">${state.usbConnected?'STREAMING':d.updatedAt?'LAST SAVED':'WAITING'}</span></div><div class="sensor-grid live-metric-grid">${sensors.map(([label,value,unit,color])=>`<article class="sensor-card live-metric-card"><div class="sensor-label">${label}<i style="--metric-color:${color}"></i></div><div class="sensor-value">${v(value)} <em>${value==null?'':unit}</em></div><div class="sensor-foot"><span>${value==null?'No value reported':'ESP32 USB reading'}</span></div></article>`).join('')}</div></div><div class="section-row charts-grid live-telemetry-grid"><div class="panel live-chart-panel"><div class="panel-title-row"><div><div class="chart-heading">MOTION ACTIVITY</div><div class="chart-sub">Actual accelerometer readings · g</div></div><div class="range-group" role="group" aria-label="Chart time range">${[1,5,15].map(m=>`<button class="${state.chartRangeMins===m?'active':''}" data-range="${m}">${m} min</button>`).join('')}</div></div><div class="chart-legend"><span><i class="legend-dot" style="background:#8d63ff"></i>X-axis</span><span><i class="legend-dot" style="background:#ec4899"></i>Y-axis</span><span><i class="legend-dot" style="background:#3b82f6"></i>Z-axis</span><span class="chart-stream-status">${state.usbConnected?'LIVE USB STREAM':d.updatedAt?'LAST SAVED':'WAITING'}</span></div><canvas class="chart-canvas" id="motion-chart" aria-label="Live ESP32 accelerometer graph"></canvas><div class="chart-foot"><span>Earlier readings</span><span>Latest report</span></div></div><div class="panel telemetry-panel"><div class="section-header"><div><span class="section-title">GPS TELEMETRY</span><small class="section-caption">${gps?state.usbConnected?'CURRENT FIX':'LAST SAVED FIX':'NO GPS FIX'}</small></div><a class="footer-link" href="#location" data-navigate="location">Open map →</a></div>${row('Coordinates',gps?`${Number(d.latitude).toFixed(6)}, ${Number(d.longitude).toFixed(6)}`:d.locationStatus||'Waiting for fix')}${row('Satellites',d.satellites)}${row('HDOP',d.hdop)}${row('Location age',d.locationAge==null?null:`${d.locationAge} ms`)}${row('Altitude',d.altitude==null?null:`${d.altitude} m`)}${row('Speed',d.speed==null?null:`${d.speed} km/h`)}${row('GPS date/time',d.gpsDateTime)}${gps?`<a class="button" style="display:inline-block;margin-top:13px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${encodeURIComponent(`${d.latitude},${d.longitude}`)}">Open location in Maps ↗</a>`:''}</div></div><div class="section-row live-bottom-grid"><div class="panel"><div class="section-header"><div><span class="section-title">DEVICE TELEMETRY</span><small class="section-caption">ESP32 STATUS REPORT</small></div><span class="badge ${state.usbConnected?'success':''}">${state.usbConnected?'CONNECTION STABLE':'USB OFFLINE'}</span></div><div class="telemetry-stats">${[['Touch state',d.touch],['Fall detection',d.fallDetection],['Freefall detected',d.freeFall],['MPU identity',d.whoAmI],['GPS characters',d.gpsCharacters],['Cancel hold',d.cancelHold]].map(([name,value])=>`<div class="telemetry-stat"><small>${name}</small><strong>${v(value)}</strong></div>`).join('')}</div></div><div class="panel"><div class="section-header"><div><span class="section-title">OUTPUT STATUS</span><small class="section-caption">DEVICE SAFETY LOGIC</small></div><span class="badge ${d.sos==='ACTIVE'?'danger':'success'}">${d.sos==='ACTIVE'?'SOS ACTIVE':'NORMAL'}</span></div><div class="output-status-grid">${[['SOS',d.sos],['Buzzer',d.buzzer],['Red LED',d.led]].map(([name,value])=>`<div class="output-status-card ${value==='ON'||value==='ACTIVE'?'output-active':''}"><small>${name}</small><strong>${v(value)}</strong></div>`).join('')}</div><details class="serial-details"><summary>View raw serial output</summary><pre>${d.logs.map(esc).join('\n')||'Waiting for USB serial output…'}</pre></details></div></div>`;
}
function osmEmbedUrl(lat,lon) {
  const padLat=.008,padLon=.012;
  const bbox=[lon-padLon,lat-padLat,lon+padLon,lat+padLat].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}
function usbLocationPage() {
  const d=state.serial, fix=d.latitude!=null&&d.longitude!=null;
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / GPS</div><h1>Location Tracking</h1><p>GPS values read directly from the ESP32 over USB.</p></div><span class="demo-chip"><i></i>${fix?'GPS FIX':'WAITING FOR FIX'}</span></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">CURRENT DEVICE LOCATION</span>${fix?`<span class="badge success">${state.usbConnected?'LIVE':'LAST SAVED'}</span>`:'<span class="badge">NO FIX</span>'}</div>${fix?`<div id="osm-location-map" class="leaflet-map" role="application" aria-label="Interactive map showing the ESP32 GPS location"></div><p class="field-help">© OpenStreetMap contributors. Map tile service availability depends on internet access.</p><div class="detail-row"><span>Latitude</span><strong id="location-lat">${Number(d.latitude).toFixed(6)}</strong></div><div class="detail-row"><span>Longitude</span><strong id="location-lon">${Number(d.longitude).toFixed(6)}</strong></div><button class="button" data-action="refresh-map">Center map on latest GPS fix</button><a class="button" style="margin-left:6px" target="_blank" rel="noreferrer" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(d.latitude)}&mlon=${encodeURIComponent(d.longitude)}#map=16/${encodeURIComponent(d.latitude)}/${encodeURIComponent(d.longitude)}">Open full map ↗</a>`:'<div class="empty-state">No GPS fix reported by the module yet. Check GPS status on Live Monitoring.</div><a class="button" href="#live" data-navigate="live">Open live readings</a>'}</div><div class="panel"><div class="section-title">GPS DETAILS</div>${[['Satellites',d.satellites],['HDOP',d.hdop],['Location age',d.locationAge==null?null:`${d.locationAge} ms`],['Altitude',d.altitude==null?null:`${d.altitude} m`],['Speed',d.speed==null?null:`${d.speed} km/h`],['GPS date/time',d.gpsDateTime],['Characters processed',d.gpsCharacters]].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong data-gps-detail="${k}">${v==null?'—':esc(v)}</strong></div>`).join('')}</div></div>`;
}
function initializeOverviewMap() {
  const element=document.querySelector('#overview-osm-map');
  const lat=Number(state.serial.latitude),lon=Number(state.serial.longitude);
  if(!element||!Number.isFinite(lat)||!Number.isFinite(lon))return;
  if(!window.L){if(!element.dataset.fallback)element.innerHTML='<div class="empty-state">Map tiles are unavailable. Open Location Tracking to retry.</div>';element.dataset.fallback='true';return;}
  const position=[lat,lon];
  if(state.overviewLocationMap&&state.overviewLocationMap.getContainer()!==element){state.overviewLocationMap.remove();state.overviewLocationMap=null;state.overviewLocationMarker=null;}
  if(!state.overviewLocationMap){
    state.overviewLocationMap=window.L.map(element,{zoomControl:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,attributionControl:true}).setView(position,15,{animate:false});
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(state.overviewLocationMap);
    state.overviewLocationMarker=window.L.marker(position).addTo(state.overviewLocationMap);
    state.overviewMapCoords=position;
    setTimeout(()=>state.overviewLocationMap?.invalidateSize({animate:false}),80);
    return;
  }
  const previous=state.overviewMapCoords;
  const moved=!previous||Math.abs(lat-previous[0])>.00001||Math.abs(lon-previous[1])>.00001;
  if(moved){
    state.overviewLocationMarker?.setLatLng(position);
    if(!state.overviewLocationMap.getBounds().pad(-.2).contains(position))state.overviewLocationMap.setView(position,15,{animate:false});
    state.overviewMapCoords=position;
  }
}
function initializeLocationMap() {
  const element=document.querySelector('#osm-location-map');
  if(!element)return;
  if(!window.L){const lat=Number(state.serial.latitude),lon=Number(state.serial.longitude);element.innerHTML=Number.isFinite(lat)&&Number.isFinite(lon)?`<iframe title="OpenStreetMap location" src="${osmEmbedUrl(lat,lon)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;height:100%;border:0"></iframe>`:'<div class="empty-state">The map library did not load and no GPS position is available.</div>';return;}
  if(state.locationMap){state.locationMap.remove();state.locationMap=null;state.locationMarker=null;}
  const position=[Number(state.serial.latitude),Number(state.serial.longitude)];
  if(!position.every(Number.isFinite))return;
  state.locationMap=window.L.map(element,{scrollWheelZoom:true}).setView(position,16);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'}).addTo(state.locationMap);
  state.locationMarker=window.L.marker(position).addTo(state.locationMap).bindPopup(`ESP32 GPS<br>${position[0].toFixed(6)}, ${position[1].toFixed(6)}`).openPopup();
  state.lastMapCoords=position;state.lastMapUpdatedAt=Date.now();
  setTimeout(()=>state.locationMap?.invalidateSize(),100);
}

function updateLocationValues() {
  const d=state.serial;
  const lat=document.querySelector('#location-lat'),lon=document.querySelector('#location-lon');
  if(lat&&d.latitude!=null)lat.textContent=Number(d.latitude).toFixed(6);
  if(lon&&d.longitude!=null)lon.textContent=Number(d.longitude).toFixed(6);
  const details={'Satellites':d.satellites,'HDOP':d.hdop,'Location age':d.locationAge==null?null:`${d.locationAge} ms`,'Altitude':d.altitude==null?null:`${d.altitude} m`,'Speed':d.speed==null?null:`${d.speed} km/h`,'GPS date/time':d.gpsDateTime,'Characters processed':d.gpsCharacters};
  document.querySelectorAll('[data-gps-detail]').forEach(node=>{const value=details[node.dataset.gpsDetail];node.textContent=value==null?'—':value;});
  const map=document.querySelector('#osm-location-map');
  const coords=[Number(d.latitude),Number(d.longitude)];
  if(map&&coords.every(Number.isFinite)){const moved=!state.lastMapCoords||Math.abs(coords[0]-state.lastMapCoords[0])>.0005||Math.abs(coords[1]-state.lastMapCoords[1])>.0005;if(moved&&Date.now()-state.lastMapUpdatedAt>60000){if(state.locationMap){state.locationMap.setView(coords);state.locationMarker?.setLatLng(coords).setPopupContent(`ESP32 GPS<br>${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);}else{const fallback=map.querySelector('iframe');if(fallback)fallback.src=osmEmbedUrl(...coords);}state.lastMapCoords=coords;state.lastMapUpdatedAt=Date.now();}}
  const badge=document.querySelector('.page-heading .demo-chip');
  if(badge)badge.innerHTML=`<i></i>${d.latitude!=null&&d.longitude!=null?'GPS FIX':'WAITING FOR FIX'}`;
}
function usbOverviewPage() {
 const d=state.serial,has=Boolean(d.updatedAt),fix=d.latitude!=null&&d.longitude!=null;
 const values=[['Device status',state.usbConnected?'Connected':'Offline',d.mpuConnected?'MPU6050 ready':'Sensor status from last report','▣','green'],['Safety status',d.sos==='ACTIVE'?'SOS active':d.freeFall==='YES'?'Fall detected':d.updatedAt?'Monitoring':'Waiting for report',d.sos==='ACTIVE'?'Check emergency response':`Fall detection ${d.fallDetection||'not reported'}`,'⌁',d.sos==='ACTIVE'?'pink':'purple'],['GPS status',fix?'Location available':'No GPS fix',fix?`${d.satellites??'—'} satellites · HDOP ${d.hdop??'—'}`:'Waiting for a device fix','◎','green'],['Connection',state.usbConnected?'USB serial active':'USB disconnected',state.usbConnected?'Direct ESP32 connection':'Showing the last locally saved report','⌁','blue']];
 const recent=state.readingHistory.slice(-3).reverse();
 return `<div class="command-heading"><div><div class="eyebrow">SAFE HER / COMMAND CENTER</div><h1>Overview</h1></div><div class="heading-actions"><span class="badge ${state.usbConnected?'success':''}"><i class="status-dot"></i>${state.usbConnected?'DEVICE ONLINE':'DEVICE OFFLINE'}</span><span class="command-time">${nowTime(new Date())}<small>${fullDate(new Date())}</small></span></div></div><div class="hello-row"><div><div class="eyebrow">${fullDate(new Date()).toUpperCase()}</div><h2>${d.sos==='ACTIVE'?'Safety alert active':has?'Your device is monitoring':'Welcome to Safe Her'}</h2><p>${state.usbConnected?'Live readings are streaming directly from your ESP32.':has?'Device is offline. Showing its last locally saved readings.':'Connect your ESP32 to see real sensor readings.'}</p></div><div class="system-banner ${d.sos==='ACTIVE'?'system-banner-alert':''}"><i></i>${d.sos==='ACTIVE'?'SOS ACTIVE':state.usbConnected?'Device connected':has?'Last readings saved':'Device not connected'}</div></div><div class="status-grid command-status-grid">${values.map(([k,v,sub,icon,color])=>`<article class="status-card"><div class="status-card-icon ${color}">${icon}</div><div class="status-card-copy"><div class="status-top">${k}</div><div class="status-main">${esc(v)}</div><div class="status-sub">${esc(sub)}</div></div><span class="status-live ${state.usbConnected?'':'status-live-muted'}">${state.usbConnected?'LIVE':has?'SAVED':'WAITING'}</span></article>`).join('')}</div><div class="section-row"><div class="section-header"><div><span class="section-title">LIVE SENSOR OVERVIEW</span><small class="section-caption">ACTUAL ESP32 READINGS</small></div><a class="footer-link" href="#live" data-navigate="live">View monitoring&nbsp; →</a></div><div class="sensor-grid command-sensor-grid">${has?metricCards():'<div class="panel empty-state" style="grid-column:1/-1">No readings yet. Connect the device to populate sensor cards and charts.</div>'}</div></div><div class="section-row charts-grid command-overview-grid">${has?chartMarkup():'<div class="panel empty-state">Motion chart will appear after the first device report.</div>'}<div class="panel overview-location"><div class="section-header"><div><span class="section-title">GPS LOCATION PREVIEW</span><small class="section-caption">LATEST DEVICE FIX</small></div><a class="icon-button panel-arrow" href="#location" data-navigate="location" aria-label="Open location tracking">↗</a></div><div class="map-preview">${fix?'<div id="overview-osm-map" class="overview-osm-map" role="application" aria-label="Stable map preview of the ESP32 location"></div>':'<div class="empty-state">No GPS fix has been received.</div>'}</div>${fix?`<div class="location-summary"><span>Current coordinates<strong>${Number(d.latitude).toFixed(6)}, ${Number(d.longitude).toFixed(6)}</strong></span><a class="badge success" target="_blank" rel="noreferrer" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(d.latitude)}&mlon=${encodeURIComponent(d.longitude)}#map=16/${encodeURIComponent(d.latitude)}/${encodeURIComponent(d.longitude)}">${state.usbConnected?'LIVE · OPEN MAP ↗':'LAST SAVED · OPEN MAP ↗'}</a></div>`:''}</div></div><div class="section-row bottom-grid command-bottom-grid"><div class="panel emergency-panel"><div><div class="section-title">EMERGENCY STATUS</div><div class="safe-mark" style="margin-top:13px"><span class="safe-icon ${d.sos==='ACTIVE'?'safe-icon-alert':''}">${d.sos==='ACTIVE'?'!':'✓'}</span><span><strong>${d.sos==='ACTIVE'?'SOS is active':has?'No active emergency':'Waiting for device status'}</strong><small>${d.sos==='ACTIVE'?'Emergency signal received from the ESP32.':d.updatedAt?`Touch ${d.touch||'—'} · Fall detection ${d.fallDetection||'—'}`:'Device status will appear when connected.'}</small></span></div></div><a class="button" href="#emergency" data-navigate="emergency">Open emergency center →</a></div><div class="panel"><div class="section-header"><div><span class="section-title">RECENT DEVICE READINGS</span><small class="section-caption">SAVED LOCALLY IN THIS BROWSER</small></div><a class="footer-link" href="#history" data-navigate="history">View all&nbsp; →</a></div><div class="activity-list">${recent.map(r=>`<div class="activity-row"><span class="activity-icon">${r.sos==='ACTIVE'?'!':'▣'}</span><span class="activity-copy"><strong>${r.sos==='ACTIVE'?'SOS active':'Device status received'}</strong><small>${r.latitude==null?'No GPS fix':`${r.latitude}, ${r.longitude}`} · ${r.touch||'Touch not reported'}</small></span><time class="activity-time">${nowTime(new Date(r.time))}</time></div>`).join('')||'<div class="empty-state">New device reports will appear here.</div>'}</div></div></div>`;
}
function refreshOverviewWithoutReloadingMap() {
  const template=document.createElement('template');
  template.innerHTML=usbOverviewPage();
  for(const selector of ['.command-heading','.hello-row','.command-status-grid','.command-sensor-grid','.command-bottom-grid .emergency-panel','.command-bottom-grid .panel:last-child .activity-list']){
    const current=content.querySelector(selector),next=template.content.querySelector(selector);
    if(current&&next)current.innerHTML=next.innerHTML;
  }
  const currentMap=content.querySelector('.overview-location .map-preview');
  const nextMap=template.content.querySelector('.overview-location .map-preview');
  if(currentMap&&nextMap){
    if(!currentMap.querySelector('#overview-osm-map')&&nextMap.querySelector('#overview-osm-map'))currentMap.innerHTML=nextMap.innerHTML;
  }
  const currentSummary=content.querySelector('.overview-location .location-summary');
  const nextSummary=template.content.querySelector('.overview-location .location-summary');
  if(currentSummary&&nextSummary)currentSummary.innerHTML=nextSummary.innerHTML;
  else if(currentMap&&nextSummary)currentMap.after(nextSummary.cloneNode(true));
  else currentSummary?.remove();
  initializeOverviewMap();
  drawChart();
}
function usbContactsPage() {
 const editing=state.contacts.find(c=>c.id===state.contactEditingId)||null;
 const mailUrl=email=>`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Safe Her emergency contact')}`;
 return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / TRUSTED PEOPLE</div><h1>Emergency Contacts</h1><p>Contact information is saved in this browser. Email links open your mail app; the dashboard does not send mail.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">SAVED CONTACTS (${state.contacts.length})</div>${state.contacts.map(c=>`<div class="detail-card contact-card"><span class="contact-avatar">${esc(c.name.slice(0,2).toUpperCase())}</span><span class="contact-info"><strong>${esc(c.name)} ${c.primary?'<span class="badge success">PRIMARY</span>':''}</strong><small>${esc(c.relationship)} · ${esc(c.phone)} · ${esc(c.email||'Email not added')}</small></span><span class="contact-actions">${c.email?`<a class="button" href="${esc(mailUrl(c.email))}">Email</a>`:''}<button class="button" data-action="contact-primary" data-id="${c.id}" ${c.primary?'disabled':''}>${c.primary?'Primary':'Set primary'}</button><button class="button" data-action="contact-edit" data-id="${c.id}">Edit</button><button class="button" data-action="contact-delete" data-id="${c.id}">Remove</button></span></div>`).join('')||'<div class="empty-state">No contacts saved. Add a trusted contact using the form.</div>'}</div><form class="panel" id="contact-form"><div class="section-header"><span class="section-title">${editing?'EDIT CONTACT':'ADD CONTACT'}</span>${editing?'<button type="button" class="button" data-action="contact-cancel-edit">Cancel edit</button>':''}</div><div class="form-grid"><div class="form-field"><label for="contact-name">Name</label><input id="contact-name" name="name" value="${esc(editing?.name||'')}" required maxlength="60" autocomplete="name"></div><div class="form-field"><label for="contact-phone">Phone</label><input id="contact-phone" name="phone" value="${esc(editing?.phone||'')}" required inputmode="tel" placeholder="+91 98765 43210" autocomplete="tel"></div><div class="form-field"><label for="contact-email">Emergency email</label><input id="contact-email" name="email" value="${esc(editing?.email||'')}" type="email" required maxlength="254" placeholder="name@example.com" autocomplete="email"></div><div class="form-field"><label for="contact-relationship">Relationship</label><input id="contact-relationship" name="relationship" value="${esc(editing?.relationship||'')}" required maxlength="40" placeholder="Family, friend…"></div><div class="form-field"><label for="contact-priority">Priority</label><select id="contact-priority" name="priority">${[1,2,3,4,5].map(n=>`<option value="${n}" ${(editing?.priority||1)===n?'selected':''}>${n}</option>`).join('')}</select></div></div><button class="button button-primary" style="margin-top:13px" type="submit">${editing?'Save contact changes':'Save contact locally'}</button></form></div>`;
}
function usbSettingsPage() {
 return `<div class="page-heading"><div><div class="eyebrow">MANAGE / PREFERENCES</div><h1>Settings</h1><p>USB connection, appearance, and local browser storage.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">DEVICE CONNECTION</div><div class="detail-row"><span>Connection</span><strong>${state.usbConnected?'USB connected':'Disconnected; showing last saved report'}</strong></div><div class="detail-row"><span>Serial speed</span><strong>115200 baud</strong></div><button class="button button-primary" style="margin-top:12px" data-action="usb-toggle">${state.usbConnected?'Disconnect ESP32':'Connect ESP32 USB'}</button></div><div class="panel"><div class="section-title">LOCAL DATA</div><div class="detail-row"><span>Saved sensor reports</span><strong>${state.readingHistory.length}</strong></div><div class="detail-row"><span>Reading archive</span><strong>${state.indexedDbReady?'IndexedDB':'Local browser storage'}</strong></div><div class="detail-row"><span>CSV recording</span><strong>${state.csvRecording?'Recording to selected CSV':'Not recording'}</strong></div><div class="detail-row"><span>Storage location</span><strong>This browser on this computer</strong></div><p class="field-help">There is no 2,000-report app limit. The browser still applies its storage quota. Choose a CSV file to copy saved reports into it and append every new ESP32 report while recording.</p><div class="local-data-actions"><button class="button button-primary" data-action="toggle-csv-recording">${state.csvRecording?'Stop CSV recording':'Start CSV recording'}</button><button class="button" data-action="export-local-backup">Download complete data backup</button><button class="button button-danger" data-action="clear-local-history">Clear saved readings</button></div></div><div class="panel"><div class="section-title">APPEARANCE</div><div class="detail-row"><span>Theme</span><strong>${state.theme==='light'?'Light':'Dark'}</strong></div><button class="button" data-action="theme-toggle">Switch to ${state.theme==='light'?'dark':'light'} mode</button></div></div>`;
}
function usbHistoryPage() {
 const filtered=deviceHistoryRows();
 return `<div class="page-heading history-page-heading"><div><div class="eyebrow">SAFE HER / SYSTEM ACTIVITY LOG</div><h1>Event History</h1><p>Search, filter, and inspect actual device and safety reports saved in this browser.</p></div><div class="history-export-actions"><button class="button export-history-button" data-action="export-csv"><span aria-hidden="true">↓</span> Export CSV</button><button class="button" data-action="export-local-backup">Download complete data</button></div></div><section class="panel history-browser-panel"><div class="history-filter-bar"><label class="history-search-box"><span aria-hidden="true">⌕</span><input id="history-search" value="${esc(state.historySearch)}" type="search" placeholder="Search reports, readings, or location" aria-label="Search reports, readings, or location"></label><select id="history-filter" class="select-control" aria-label="Filter report category"><option value="all" ${state.historyFilter==='all'?'selected':''}>All categories</option><option value="emergency" ${state.historyFilter==='emergency'?'selected':''}>Emergency</option><option value="fall" ${state.historyFilter==='fall'?'selected':''}>Fall detection</option><option value="gps" ${state.historyFilter==='gps'?'selected':''}>GPS update</option><option value="sensor" ${state.historyFilter==='sensor'?'selected':''}>Sensor report</option></select><select id="history-date-range" class="select-control" aria-label="Filter report date"><option value="7d" ${state.historyDateRange==='7d'?'selected':''}>Last 7 days</option><option value="30d" ${state.historyDateRange==='30d'?'selected':''}>Last 30 days</option><option value="90d" ${state.historyDateRange==='90d'?'selected':''}>Last 90 days</option><option value="all" ${state.historyDateRange==='all'?'selected':''}>All time</option></select><select id="history-sort" class="select-control" aria-label="Sort report history"><option value="newest" ${state.historySort==='newest'?'selected':''}>Latest first</option><option value="oldest" ${state.historySort==='oldest'?'selected':''}>Oldest first</option></select></div><div class="table-wrap history-table-wrap"><table><thead><tr><th>LOCAL REPORT ID</th><th>CATEGORY</th><th>DESCRIPTION</th><th>TIMESTAMP</th><th>SOURCE / LOCATION</th><th>STATUS</th></tr></thead><tbody id="history-table-body">${historyRowsMarkup(filtered.pageRows)}</tbody></table></div><div class="history-table-footer"><span id="history-count">${filtered.start?`Showing ${filtered.start}–${filtered.end} of ${filtered.total} reports`:'No reports match these filters.'} · Local browser archive</span><nav id="history-pagination" class="history-pagination" aria-label="History pages">${historyPaginationMarkup(filtered.pages,state.historyPage)}</nav></div></section>`;
}
function deviceHistoryEvents() {
 const rows=state.readingHistory.slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
 return rows.map((row,index)=>{
  const previous=rows[index-1];
  const hasGps=row.latitude!=null&&row.longitude!=null;
  const moved=hasGps&&(!previous||previous.latitude==null||previous.longitude==null||Math.abs(Number(row.latitude)-Number(previous.latitude))>.00001||Math.abs(Number(row.longitude)-Number(previous.longitude))>.00001);
  let category='sensor',description=`MPU report · ${row.accelMagnitude==null?'acceleration unavailable':`${row.accelMagnitude} g`} · Touch ${row.touch||'not reported'}`,status='Recorded';
  if(row.sos==='ACTIVE'){category='emergency';description=`SOS active · Freefall ${row.freeFall||'not reported'}`;status='Active in report';}
  else if(row.freeFall==='YES'){category='fall';description=`Freefall detected · Acceleration ${row.accelMagnitude==null?'not reported':`${row.accelMagnitude} g`}`;status='Detected in report';}
  else if(moved){category='gps';description='GPS position reported by the device';status='Fix reported';}
  const coordinates=hasGps?`${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)}`:'Ananya';
  const timestamp=new Date(row.time).getTime();
  return {id:`RPT-${timestamp}`,category,description,time:timestamp,location:coordinates,status,row};
 });
}
function filteredDeviceHistoryEvents() {
 const q=state.historySearch.trim().toLowerCase(),filter=state.historyFilter;
 const days=state.historyDateRange==='all'?null:Number(state.historyDateRange.replace('d',''));
 const cutoff=days==null?0:Date.now()-days*24*60*60*1000;
 return deviceHistoryEvents().filter(event=>{
  const text=[event.id,event.category,event.description,event.time,event.location,event.status,event.row.sos,event.row.freeFall,event.row.buzzer,event.row.led].join(' ').toLowerCase();
  return event.time>=cutoff&&(!q||text.includes(q))&&(filter==='all'||event.category===filter);
 }).sort((a,b)=>state.historySort==='oldest'?a.time-b.time:b.time-a.time);
}
function historyRowsMarkup(rows) {
 return rows.map(event=>`<tr><td><strong class="history-report-id">${esc(event.id)}</strong></td><td><span class="history-category-badge ${event.category}"><i></i>${event.category==='emergency'?'Emergency':event.category==='fall'?'Fall Detection':event.category==='gps'?'GPS Update':'Sensor Report'}</span></td><td>${esc(event.description)}</td><td>${new Date(event.time).toLocaleString()}</td><td>${esc(event.location)}</td><td><span class="badge ${event.category==='emergency'?'danger':event.category==='fall'?'warning':event.category==='gps'?'success':''}">${esc(event.status)}</span></td></tr>`).join('')||'<tr><td colspan="6" class="muted">No saved device reports match these filters.</td></tr>';
}
function deviceHistoryRows() {
 const rows=filteredDeviceHistoryEvents(),pageSize=state.historyPageSize,total=rows.length,pages=Math.max(1,Math.ceil(total/pageSize));
 state.historyPage=Math.max(1,Math.min(state.historyPage,pages));
 const start=total?(state.historyPage-1)*pageSize+1:0,end=total?Math.min(state.historyPage*pageSize,total):0;
 return {pageRows:rows.slice(start?start-1:0,end),total,pages,start,end};
}
function historyPaginationMarkup(pages,current) {
 if(pages<=1)return '';
 const first=Math.max(1,current-1),last=Math.min(pages,first+2);
 return `<button type="button" data-history-page="${Math.max(1,current-1)}" aria-label="Previous page" ${current===1?'disabled':''}>‹</button>${Array.from({length:last-first+1},(_,i)=>first+i).map(page=>`<button type="button" data-history-page="${page}" class="${page===current?'active':''}" aria-current="${page===current?'page':'false'}">${page}</button>`).join('')}<button type="button" data-history-page="${Math.min(pages,current+1)}" aria-label="Next page" ${current===pages?'disabled':''}>›</button>`;
}

function usbDevicePage() {
 const d=state.serial;
 return `<div class="page-heading"><div><div class="eyebrow">MANAGE / CONNECTED HARDWARE</div><h1>Device Management</h1><p>${state.usbConnected?'ESP32 connected directly by USB.':'Showing last serial readings; USB is disconnected.'}</p></div><button class="button button-primary" data-action="usb-toggle">${state.usbConnected?'Disconnect ESP32':'Connect ESP32 USB'}</button></div><div class="wide-grid"><div class="panel"><div class="section-title">SAFE HER DEVICE</div>${[['Device name','Ananya'],['Connection',state.usbConnected?'USB serial':'Disconnected'],['Baud rate','115200'],['MPU sensor',d.mpuConnected?'Connected':d.mpuConnected===false?'Disconnected':'Not reported'],['MPU identity',d.whoAmI],['Latest serial report',d.updatedAt?new Date(d.updatedAt).toLocaleString():'None']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}<div style="display:flex;gap:8px;margin-top:12px"><a class="button" href="#live" data-navigate="live">Live readings</a><a class="button" href="#settings" data-navigate="settings">Connection settings</a></div></div><div class="panel"><div class="section-title">DEVICE OUTPUTS</div>${[['Touch',d.touch],['Buzzer',d.buzzer],['LED',d.led],['SOS',d.sos],['Fall detection',d.fallDetection],['Freefall',d.freeFall]].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}</div></div>`;
}
function usbEmergencyPage() {
 const d=state.serial,active=d.sos==='ACTIVE',location=latestKnownEmergencyLocation(),episodes=savedSosEpisodes(),delivery=state.sosDelivery;
 const deliveryLabel=value=>value==='accepted'?'Accepted by provider':value==='sending'?'Sending…':value==='failed'?'Failed':value==='not_configured'?'Not configured':value==='no_recipients'?'No recipient configured':value==='partial'?'Partially accepted':value?'Unknown':'Waiting for SOS';
 const latestEpisode=episodes[0];
 const activeTime=latestEpisode?.active?new Date(latestEpisode.time):state.emergency?.time;
 const timeline=active?[
  ['SOS activated',activeTime?new Date(activeTime).toLocaleString():'Time unavailable','ACTIVE','success'],
  ['GPS location',location?`${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`:'No GPS fix in saved reports',location?'ATTACHED':'WAITING',location?'success':'warning'],
  ['Email notification',deliveryLabel(delivery?.email?.status),delivery?.email?.status==='accepted'?'ACCEPTED':delivery?.email?.status==='failed'?'FAILED':delivery?.email?.status==='sending'?'SENDING':'PENDING',delivery?.email?.status==='accepted'?'success':delivery?.email?.status==='failed'?'danger':'warning'],
  ['SMS notification',deliveryLabel(delivery?.sms?.status),delivery?.sms?.status==='accepted'?'ACCEPTED':delivery?.sms?.status==='failed'?'FAILED':delivery?.sms?.status==='sending'?'SENDING':'PENDING',delivery?.sms?.status==='accepted'?'success':delivery?.sms?.status==='failed'?'danger':'warning'],
  ['Device resolution','Cancel using the ESP32 touch control','AWAITING','warning'],
 ]:[
  ['SOS signal','Waiting for an active ESP32 emergency','STANDBY',''],
  ['GPS location',location?`${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`:'No saved GPS fix',location?'AVAILABLE':'WAITING',location?'success':''],
  ['Email notification','Attempted only when SOS activates','STANDBY',''],
  ['SMS notification','Attempted only when SOS activates','STANDBY',''],
  ['Device resolution','Handled by the ESP32 touch control','STANDBY',''],
 ];
 const episodeRows=episodes.map((event,index)=>{
   const eventDelivery=index===0&&delivery?`${deliveryLabel(delivery.email?.status)} / ${deliveryLabel(delivery.sms?.status)}`:'Not stored';
   const coords=Number.isFinite(event.latitude)&&Number.isFinite(event.longitude)?`${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)}`:'No GPS fix';
   return `<tr><td>${new Date(event.time).toLocaleString()}</td><td>Device SOS</td><td>${esc(coords)}</td><td>${eventDelivery}</td><td><span class="badge ${event.active?'danger':'success'}">${event.active?'Active':event.resolvedAt?'Ended on device':'No end report'}</span></td></tr>`;
 }).join('');
 const mapBlock=location?'<div id="emergency-osm-map" class="emergency-osm-map" role="application" aria-label="Map showing the latest saved ESP32 emergency location"></div>':'<div class="emergency-map-empty">No GPS position has been saved by the ESP32 yet.</div>';
 const mapLink=location?`<a class="button" target="_blank" rel="noreferrer" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(location.latitude)}&mlon=${encodeURIComponent(location.longitude)}#map=16/${encodeURIComponent(location.latitude)}/${encodeURIComponent(location.longitude)}">Open full map ↗</a>`:'';
 const currentStatus=active?'SOS ACTIVE':d.updatedAt?'NO ACTIVE SOS':'WAITING FOR DEVICE';
 const statusCopy=active?'The ESP32 reports an active emergency. Stop SOS here or use the device touch control.':d.updatedAt?`No active SOS in the ${state.usbConnected?'current USB report':'last saved device report'}.`:'Connect the ESP32 by USB to monitor and manually control SOS.';
 const mapCoordinates=location?`${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`:'No active coordinates';
 const mapFreshness=location?(location.live?'Live GPS fix':'Last saved GPS fix'):'Waiting for device GPS';
 return `<div class="page-heading emergency-page-heading"><div><div class="eyebrow">SAFE HER / RESPONSE COORDINATION</div><h1>Emergency Response Center</h1><p>Device-reported SOS state, GPS location, and provider notification results.</p></div><span class="badge ${active?'danger':d.updatedAt?'success':''}">${currentStatus}</span></div><section class="panel emergency-hero ${active?'emergency-hero-active':''}"><span class="emergency-hero-icon">${active?'!':'✓'}</span><div class="emergency-hero-copy"><small>${active?'EMERGENCY STATUS':'SYSTEM STATUS'}</small><h2>${active?'SOS is active':d.updatedAt?'No active emergency':'Waiting for device'}</h2><p>${esc(statusCopy)}</p></div><div class="emergency-hero-actions"><button type="button" class="button ${active?'button-danger':'button-primary'}" data-manual-sos ${state.usbConnected?'':'disabled'}>${active?'Turn SOS off':'Activate SOS manually'}</button><a class="button ${active?'':'button-quiet'}" href="#location" data-navigate="location">${location?'Open device location':'View location status'}</a><a class="button" href="#contacts" data-navigate="contacts">Emergency contacts</a></div></section><div class="emergency-center-grid"><section class="panel emergency-timeline-panel"><div class="section-header"><div><span class="section-title">EMERGENCY EVENT TIMELINE</span><small class="section-caption">${active?'CURRENT DEVICE SOS':'LIVE DEVICE WORKFLOW'}</small></div><span class="badge ${active?'danger':'success'}">${active?'SOS ACTIVE':'STANDBY'}</span></div><div class="emergency-timeline">${timeline.map(([title,detail,status,tone],index)=>`<div class="emergency-timeline-item"><span class="emergency-step ${tone}">${index+1}</span><span class="emergency-step-copy"><strong>${title}</strong><small>${esc(detail)}</small></span><span class="badge ${tone}">${status}</span></div>`).join('')}</div><div class="emergency-delivery-summary"><div class="section-title">ALERT DELIVERY</div><div class="detail-row"><span>Email</span><strong>${delivery?deliveryLabel(delivery.email?.status):'Waiting for SOS'}</strong></div><div class="detail-row"><span>SMS</span><strong>${delivery?deliveryLabel(delivery.sms?.status):'Waiting for SOS'}</strong></div>${delivery?.email?.detail?`<p class="field-help">Email: ${esc(delivery.email.detail)}</p>`:''}${delivery?.sms?.detail?`<p class="field-help">SMS: ${esc(delivery.sms.detail)}</p>`:''}</div></section><section class="panel emergency-location-panel"><div class="section-header"><div><span class="section-title">EMERGENCY LOCATION</span><small class="section-caption emergency-location-status">${mapFreshness.toUpperCase()}</small></div><a class="icon-button panel-arrow" href="#location" data-navigate="location" aria-label="Open location tracking">↗</a></div><div class="emergency-map-frame">${mapBlock}</div><div class="emergency-location-summary"><div class="detail-row"><span>Coordinates</span><strong>${esc(mapCoordinates)}</strong></div><div class="detail-row"><span>Location status</span><strong>${esc(mapFreshness)}</strong></div>${mapLink}</div></section></div><section class="panel emergency-history-panel"><div class="section-header"><div><span class="section-title">EMERGENCY HISTORY</span><small class="section-caption">SOS EPISODES FROM SAVED ESP32 REPORTS</small></div><a class="footer-link" href="#history" data-navigate="history">View device history →</a></div><div class="table-wrap"><table><thead><tr><th>TIME</th><th>TRIGGER TYPE</th><th>LOCATION</th><th>ALERT STATUS</th><th>RESOLUTION</th></tr></thead><tbody>${episodeRows||'<tr><td colspan="5" class="muted">No SOS activation appears in saved ESP32 reports.</td></tr>'}</tbody></table></div></section>`;
}
function latestKnownEmergencyLocation() {
 const current=state.serial;
 if(Number.isFinite(Number(current.latitude))&&Number.isFinite(Number(current.longitude))&&current.latitude!=null&&current.longitude!=null)return {latitude:Number(current.latitude),longitude:Number(current.longitude),observedAt:current.updatedAt,live:state.usbConnected};
 const last=state.readingHistory.slice().reverse().find(row=>row.latitude!=null&&row.longitude!=null);
 return last?{latitude:Number(last.latitude),longitude:Number(last.longitude),observedAt:last.time,live:false}:null;
}
function savedSosEpisodes() {
 const reports=state.readingHistory.slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
 const episodes=[];let current=null;
 for(const row of reports){
  if(row.sos==='ACTIVE'&&!current){current={time:row.time,latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),active:true,resolvedAt:null};episodes.push(current);}
  else if(row.sos!=='ACTIVE'&&current){current.active=false;current.resolvedAt=row.time;current=null;}
  if(current&&row.latitude!=null&&row.longitude!=null){current.latitude=Number(row.latitude);current.longitude=Number(row.longitude);}
 }
 if(state.serial.sos==='ACTIVE'){
  if(!current){current={time:state.emergency?.time||state.serial.updatedAt||Date.now(),latitude:state.serial.latitude==null?null:Number(state.serial.latitude),longitude:state.serial.longitude==null?null:Number(state.serial.longitude),active:true,resolvedAt:null};episodes.push(current);}
  else{current.active=true;current.resolvedAt=null;if(state.serial.latitude!=null&&state.serial.longitude!=null){current.latitude=Number(state.serial.latitude);current.longitude=Number(state.serial.longitude);}}
 }
 return episodes.reverse();
}
function initializeEmergencyLocationMap() {
 const frame=document.querySelector('.emergency-map-frame');if(!frame)return;
 const location=latestKnownEmergencyLocation();
 if(!location){frame.innerHTML='<div class="emergency-map-empty">No GPS position has been saved by the ESP32 yet.</div>';return;}
 let element=frame.querySelector('#emergency-osm-map');
 if(!element){frame.innerHTML='<div id="emergency-osm-map" class="emergency-osm-map" role="application" aria-label="Map showing the latest saved ESP32 emergency location"></div>';element=frame.querySelector('#emergency-osm-map');}
 if(!window.L){if(!element.dataset.fallback)element.innerHTML='<div class="emergency-map-empty">Map tiles are unavailable. Open Location Tracking to view the fix.</div>';element.dataset.fallback='true';return;}
 const position=[location.latitude,location.longitude];
 if(state.emergencyLocationMap&&state.emergencyLocationMap.getContainer()!==element){state.emergencyLocationMap.remove();state.emergencyLocationMap=null;state.emergencyLocationMarker=null;}
 if(!state.emergencyLocationMap){state.emergencyLocationMap=window.L.map(element,{zoomControl:false,scrollWheelZoom:false,doubleClickZoom:false,keyboard:false}).setView(position,15,{animate:false});window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(state.emergencyLocationMap);state.emergencyLocationMarker=window.L.marker(position).addTo(state.emergencyLocationMap);state.emergencyMapCoords=position;setTimeout(()=>state.emergencyLocationMap?.invalidateSize({animate:false}),80);return;}
 const previous=state.emergencyMapCoords,moved=!previous||Math.abs(position[0]-previous[0])>.00001||Math.abs(position[1]-previous[1])>.00001;
 if(moved){state.emergencyLocationMarker?.setLatLng(position);if(!state.emergencyLocationMap.getBounds().pad(-.2).contains(position))state.emergencyLocationMap.setView(position,15,{animate:false});state.emergencyMapCoords=position;}
}
function refreshEmergencyCenter() {
 const template=document.createElement('template');template.innerHTML=usbEmergencyPage();
 for(const selector of ['.emergency-hero','.emergency-timeline-panel','.emergency-history-panel tbody']){const current=content.querySelector(selector),next=template.content.querySelector(selector);if(current&&next)current.innerHTML=next.innerHTML;}
 const currentFrame=content.querySelector('.emergency-map-frame'),nextFrame=template.content.querySelector('.emergency-map-frame');
 if(currentFrame&&nextFrame&&!currentFrame.querySelector('#emergency-osm-map')&&nextFrame.querySelector('#emergency-osm-map'))currentFrame.innerHTML=nextFrame.innerHTML;
 const currentSummary=content.querySelector('.emergency-location-summary'),nextSummary=template.content.querySelector('.emergency-location-summary');
 if(currentSummary&&nextSummary)currentSummary.innerHTML=nextSummary.innerHTML;
 const status=content.querySelector('.emergency-location-status'),nextStatus=template.content.querySelector('.emergency-location-status');if(status&&nextStatus)status.textContent=nextStatus.textContent;
 initializeEmergencyLocationMap();
 bindManualSosAction();
}
function bindManualSosAction() {
 if(content.dataset.manualSosBound)return;
 content.dataset.manualSosBound='true';
 content.addEventListener('click',event=>{
  if(event.target.closest('[data-manual-sos]')) requestManualSosToggle();
 });
}
async function writeDeviceCommand(command) {
 if(!state.usbConnected||!state.serialPort?.writable){toast('Connect the ESP32 by USB before changing its SOS state.','error');return false;}
 let writer;
 try {writer=state.serialPort.writable.getWriter();await writer.write(new TextEncoder().encode(command));return true;}
 catch(error){toast(`Could not send command to ESP32: ${error.message}`,'error');return false;}
 finally {writer?.releaseLock();}
}
function requestManualSosToggle() {
 if(!state.usbConnected){toast('Connect the ESP32 by USB to control SOS.','error');return;}
 const active=state.serial.sos==='ACTIVE',dialog=document.querySelector('#confirm-dialog');
 document.querySelector('#dialog-title').textContent=active?'Turn off SOS on the ESP32?':'Activate SOS on the ESP32?';
 document.querySelector('#dialog-copy').textContent=active?'This sends the stop command to the connected device and turns off its buzzer and LED.':'This activates the connected device alarm and starts its configured SOS notifications.';
 const confirm=document.querySelector('#dialog-confirm');confirm.textContent=active?'Turn off SOS':'Activate SOS';
 confirm.classList.toggle('button-danger',!active);confirm.classList.toggle('button-primary',active);
 confirm.onclick=async()=>{const sent=await writeDeviceCommand(active?'R':'S');if(sent)toast(`SOS ${active?'stop':'activation'} command sent. Waiting for the ESP32 status report.`);};
 dialog.showModal();
}
function usbActivityPage() {
  const d=state.serial,active=d.freeFall==='YES',has=Boolean(d.updatedAt);
  const magnitude=d.accelMagnitude==null?null:Number(d.accelMagnitude);
  const scale=magnitude==null?0:Math.max(0,Math.min(100,magnitude/3*100));
  const history=state.readingHistory.slice(-8).reverse();
  const lastFall=state.readingHistory.slice().reverse().find(r=>r.freeFall==='YES');
  const stamp=d.updatedAt?new Date(d.updatedAt).toLocaleTimeString():null;
  return `<div class="page-heading"><div><div class="eyebrow">SAFE HER / DEVICE SAFETY LOGIC</div><h1>Activity Detection</h1><p>Review live fall signals and the motion readings reported by your ESP32.</p></div><span class="badge ${state.usbConnected?'success':''}">${state.usbConnected?'LIVE USB DATA':has?'LAST SAVED DATA':'WAITING FOR DEVICE'}</span></div><div class="activity-notice"><span class="activity-notice-icon">⌁</span><span><strong>On-device fall detection</strong><small>This firmware reports acceleration, freefall, and SOS state. It does not provide walking/running classifications or ML confidence.</small></span><span class="badge ${d.fallDetection==='ENABLED'?'success':''}">${esc(d.fallDetection||'WAITING')}</span></div><div class="activity-intelligence-grid"><section class="panel activity-primary-panel"><div class="activity-primary-top"><span class="activity-big-icon ${active?'activity-alert-icon':''}">${active?'!':'⌁'}</span><span class="badge ${active?'danger':state.usbConnected?'success':''}">${active?'FREEFALL SIGNAL':state.usbConnected?'MONITORING':'LAST DEVICE STATE'}</span></div><div class="eyebrow activity-current-label">CURRENT DEVICE SAFETY STATE</div><h2>${active?'Freefall signal detected':d.fallDetection==='ENABLED'?'Monitoring for a fall':'Waiting for device status'}</h2><p>${active?'The ESP32 reports a freefall condition. Check the Emergency Center and device location.':has?`No freefall is reported in the latest sample. ${state.usbConnected?'Sensor reports arrive about every 2 seconds.':'Showing the last saved report.'}`:'Connect the ESP32 over USB to start receiving safety signals.'}</p><div class="activity-progress-heading"><span>Acceleration magnitude</span><strong>${magnitude==null?'—':`${magnitude.toFixed(3)} g`}</strong></div><div class="threshold-track" role="img" aria-label="Current acceleration compared with firmware freefall and impact thresholds"><span class="threshold-current" style="width:${scale}%"></span><i class="threshold-mark freefall-mark" title="Freefall threshold 0.65 g"></i><i class="threshold-mark impact-mark" title="Impact threshold 2.5 g"></i></div><div class="threshold-labels"><span>0 g</span><span>Freefall &lt; 0.65 g</span><span>Impact &gt; 2.5 g</span><span>3 g</span></div><div class="activity-facts"><div><small>MPU6050</small><strong>${d.mpuConnected?'Connected':d.mpuConnected===false?'Disconnected':'—'}</strong></div><div><small>Latest report</small><strong>${stamp||'No report yet'}</strong></div><div><small>SOS state</small><strong class="${d.sos==='ACTIVE'?'activity-danger-text':''}">${esc(d.sos||'—')}</strong></div></div><div class="activity-action-links"><a class="button" href="#live" data-navigate="live">Live sensor readings →</a><a class="button" href="#emergency" data-navigate="emergency">Emergency center →</a></div></section><aside class="activity-side-stack"><section class="panel"><div class="section-header"><div><span class="section-title">FALL SIGNALS</span><small class="section-caption">REAL DEVICE STATE</small></div><span class="badge ${active?'danger':d.fallDetection==='ENABLED'?'success':''}">${active?'REVIEW':d.fallDetection==='ENABLED'?'ARMED':'WAITING'}</span></div><div class="fall-signal-state ${active?'fall-signal-active':''}"><span class="fall-signal-icon">${active?'!':'✓'}</span><span><strong>${active?'Freefall detected':'No active fall signal'}</strong><small>${active?'Latest ESP32 sample reports freefall.':'Threshold monitoring from the MPU6050.'}</small></span></div><div class="detail-row"><span>Fall detection</span><strong>${esc(d.fallDetection||'—')}</strong></div><div class="detail-row"><span>Freefall reading</span><strong>${esc(d.freeFall||'—')}</strong></div><div class="detail-row"><span>Last saved fall signal</span><strong>${lastFall?new Date(lastFall.time).toLocaleString():'None recorded'}</strong></div></section><section class="panel"><div class="section-header"><div><span class="section-title">MOTION READINGS</span><small class="section-caption">ACTUAL ACCELERATION HISTORY</small></div><span class="badge">${history.length} samples</span></div><canvas id="fall-chart" class="chart-canvas activity-chart" aria-label="ESP32 acceleration magnitude over time"></canvas><div class="detail-row"><span>Freefall threshold</span><strong>&lt; 0.65 g</strong></div><div class="detail-row"><span>Impact threshold</span><strong>&gt; 2.5 g</strong></div><div class="detail-row"><span>Temperature</span><strong>${d.temperature==null?'—':`${esc(d.temperature)} °C`}</strong></div></section></aside></div><section class="panel activity-history-panel"><div class="section-header"><div><span class="section-title">RECENT DEVICE CLASSIFICATION SIGNALS</span><small class="section-caption">SAVED LOCALLY IN THIS BROWSER</small></div><a class="footer-link" href="#history" data-navigate="history">View event history →</a></div><div class="table-wrap"><table><thead><tr><th>DEVICE REPORT</th><th>ACCELERATION</th><th>FALL DETECTION</th><th>FREEFALL</th><th>SOS</th></tr></thead><tbody>${history.map(r=>`<tr><td>${new Date(r.time).toLocaleString()}</td><td>${r.accelMagnitude==null?'—':`${esc(r.accelMagnitude)} g`}</td><td>${esc(r.fallDetection||'—')}</td><td><span class="badge ${r.freeFall==='YES'?'danger':'success'}">${esc(r.freeFall||'—')}</span></td><td><span class="badge ${r.sos==='ACTIVE'?'danger':''}">${esc(r.sos||'—')}</span></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Device reports will appear after the ESP32 sends its first complete status block.</td></tr>'}</tbody></table></div></section>`;
}
function activityDistributionMarkup() {
  const reports=state.readingHistory;
  const categories=[
    {name:'Normal',color:'#8d63ff',count:reports.filter(r=>r.sos!=='ACTIVE'&&r.freeFall==='NO').length},
    {name:'Freefall',color:'#3b82f6',count:reports.filter(r=>r.sos!=='ACTIVE'&&r.freeFall==='YES').length},
    {name:'SOS active',color:'#16b88a',count:reports.filter(r=>r.sos==='ACTIVE').length},
    {name:'Unclassified',color:'#ec4899',count:reports.filter(r=>r.sos!=='ACTIVE'&&r.freeFall!=='NO'&&r.freeFall!=='YES').length},
  ];
  const total=categories.reduce((sum,item)=>sum+item.count,0);
  let offset=0;
  const segments=categories.map(item=>{const start=offset;offset+=total?item.count/total*100:0;return `${item.color} ${start}% ${offset}%`;}).join(', ');
  const leading=categories.slice().sort((a,b)=>b.count-a.count)[0];
  const dominantPercent=total?Math.round(leading.count/total*100):0;
  return `<section class="panel activity-distribution-panel"><div class="section-header"><div><span class="section-title">ACTIVITY DISTRIBUTION</span><small class="section-caption">SHARE OF SAVED ESP32 REPORTS</small></div><span class="badge">${total} reports</span></div>${total?`<div class="activity-distribution-content"><div class="activity-donut" style="--activity-segments:conic-gradient(from -90deg,${segments})"><div class="activity-donut-center"><strong>${dominantPercent}%</strong><small>${esc(leading.name)}</small></div></div><div class="activity-distribution-legend">${categories.map(item=>`<div class="activity-legend-row"><span><i style="--legend-color:${item.color}"></i>${item.name}</span><strong>${Math.round(item.count/total*100)}%<small>${item.count}</small></strong></div>`).join('')}</div></div>`:'<div class="activity-distribution-empty">The chart will populate from saved device reports. No sample classifications are generated.</div>'}<p class="activity-distribution-note">Counts are report samples, not unique fall events or ML predictions.</p></section>`;
}
async function sendSosNotifications() {
  const eventId=crypto.randomUUID();
  state.sosDelivery={eventId,occurredAt:new Date().toISOString(),email:{status:'sending'},sms:{status:'sending'}};
  persistLocalState();render({preserveInputs:true});
  const d=state.serial;
  const body={event_id:eventId,occurred_at:state.sosDelivery.occurredAt,emails:state.contacts.filter(c=>c.email).sort((a,b)=>Number(b.primary)-Number(a.primary)).map(c=>c.email),phones:state.contacts.filter(c=>c.phone).sort((a,b)=>Number(b.primary)-Number(a.primary)).map(c=>String(c.phone).replace(/[\s()-]/g,'')),latitude:d.latitude,longitude:d.longitude,sensor:{accelMagnitude:d.accelMagnitude,temperature:d.temperature},safety:{touch:d.touch,fallDetection:d.fallDetection,freeFall:d.freeFall}};
  try {
    const response=await fetch('/api/notifications/sos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw new Error(result?.error?.message||`Notification endpoint returned HTTP ${response.status}.`);
    state.sosDelivery={...state.sosDelivery,...result};persistLocalState();
    const email=result.email?.status==='accepted'?'Email submitted':`Email ${result.email?.status||'status unknown'}`;
    const sms=result.sms?.status==='accepted'?'SMS submitted':`SMS ${result.sms?.status||'status unknown'}`;
    toast(`SOS alert result — ${email}; ${sms}.`,result.email?.status==='accepted'||result.sms?.status==='accepted'?'success':'error');
  } catch(error) {state.sosDelivery={...state.sosDelivery,email:{status:'failed',detail:error.message},sms:{status:'failed',detail:'Notification request failed before provider delivery.'}};persistLocalState();toast(`SOS notification failed: ${error.message}`,'error');}
  render({preserveInputs:true});
}
function openEmergencyEmailDraft() {
  const emails=state.contacts.filter(c=>c.email).map(c=>c.email);if(!emails.length){toast('Add an emergency contact with an email address first.','error');return;}
  const d=state.serial,locationText=d.latitude==null?'GPS fix unavailable':`https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=16/${d.latitude}/${d.longitude}`;
  const body=`Safe Her reports SOS ACTIVE at ${new Date().toLocaleString()}.\nLocation: ${locationText}\nPlease check on the user.`;
  window.location.href=`mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent('Safe Her emergency alert')}&body=${encodeURIComponent(body)}`;
}
function parseSerialLine(source) {
  const line=source.trim(); if(!line)return;
  const d=state.serial;
  d.logs.push(line); if(d.logs.length>18)d.logs.shift();
  const value=(label)=>{const m=line.match(new RegExp('^'+label+':\\s*(.*)$','i'));return m?.[1]?.trim()??null;};
  let m;
  if((m=line.match(/^Connected:\s*(YES|NO)/i)))d.mpuConnected=m[1].toUpperCase()==='YES';
  if((m=line.match(/^WHO_AM_I:\s*(0x[0-9a-f]+)/i)))d.whoAmI=m[1];
  if((m=line.match(/^Accel X:\s*([-+\d.]+)\s*\|\s*Y:\s*([-+\d.]+)\s*\|\s*Z:\s*([-+\d.]+)/i))){[d.accelX,d.accelY,d.accelZ]=m.slice(1).map(Number);state.series.push({x:d.accelX,y:d.accelY,z:d.accelZ,t:Date.now()});if(state.series.length>600)state.series.shift();}
  if((m=line.match(/^Acceleration magnitude:\s*([-+\d.]+)/i)))d.accelMagnitude=Number(m[1]);
  if((m=line.match(/^Gyro X:\s*([-+\d.]+)\s*\|\s*Y:\s*([-+\d.]+)\s*\|\s*Z:\s*([-+\d.]+)/i)))[d.gyroX,d.gyroY,d.gyroZ]=m.slice(1).map(Number);
  if((m=line.match(/^Temperature:\s*([-+\d.]+)/i)))d.temperature=Number(m[1]);
  if((m=line.match(/^Characters processed:\s*(\d+)/i)))d.gpsCharacters=Number(m[1]);
  if((m=line.match(/^Satellites:\s*(\d+)/i)))d.satellites=Number(m[1]);
  if((m=line.match(/^HDOP:\s*([-+\d.]+)/i)))d.hdop=Number(m[1]);
  if((m=line.match(/^Location:\s*([-+\d.]+)\s*,\s*([-+\d.]+)/i))){d.latitude=Number(m[1]);d.longitude=Number(m[2]);d.locationStatus='GPS fix available';state.coords={lat:d.latitude,lon:d.longitude,accuracy:0};}
  else if(/^Location:\s*Waiting/i.test(line)){d.latitude=null;d.longitude=null;d.locationStatus='Waiting for GPS fix';}
  if((m=line.match(/^Location age:\s*(\d+)/i)))d.locationAge=Number(m[1]);
  if((m=line.match(/^Altitude:\s*([-+\d.]+)/i)))d.altitude=Number(m[1]);
  if((m=line.match(/^Speed:\s*([-+\d.]+)/i)))d.speed=Number(m[1]);
  if((m=line.match(/^GPS date\/time:\s*(.*)$/i)))d.gpsDateTime=m[1];
  if((m=line.match(/^Touch state:\s*(.*)$/i)))d.touch=m[1];
  if((m=line.match(/^Buzzer:\s*(.*)$/i)))d.buzzer=m[1];
  if((m=line.match(/^LED:\s*(.*)$/i)))d.led=m[1];
  if((m=line.match(/^SOS:\s*(.*)$/i))){const wasActive=d.sos==='ACTIVE',isActive=m[1].trim().toUpperCase()==='ACTIVE';d.sos=isActive?'ACTIVE':m[1];if(isActive&&!wasActive){state.emergency={type:'ESP32 SOS',source:'Device safety logic',time:new Date()};setSharedSos(true,{announce:true});void sendSosNotifications();}else if(isActive){state.emergency??={type:'ESP32 SOS',source:'Device safety logic',time:new Date(d.updatedAt||Date.now())};}else{state.emergency=null;setSharedSos(false);}}
  if((m=line.match(/^Fall detection:\s*(.*)$/i)))d.fallDetection=m[1];
  if((m=line.match(/^Freefall detected:\s*(.*)$/i)))d.freeFall=m[1];
  if((m=line.match(/^Fall model:\s*(.*)$/i)))d.fallModelReady=m[1].trim().toUpperCase()==='READY';
  if((m=line.match(/^Fall probability:\s*([-+\d.]+)/i)))d.fallProbability=Number(m[1]);
  if((m=line.match(/^Fall prediction:\s*(.*)$/i)))d.fallPrediction=m[1].trim().toUpperCase();
  if((m=line.match(/^Cancel hold:\s*(.*)$/i)))d.cancelHold=m[1];
  if(line.includes('[ SYSTEM STATUS ]'))d.inSystemStatus=true;
  if(d.inSystemStatus&&/^=+/.test(line)){d.inSystemStatus=false;d.updatedAt=Date.now();const report={...d,time:d.updatedAt,id:globalThis.crypto?.randomUUID?.()||`${d.updatedAt}-${Math.random().toString(36).slice(2)}`,logs:undefined};state.readingHistory.push(report);appendCsvReading(report);saveReadingReport(report);persistLocalState();applySosVisual();if(state.page==='location'&&document.querySelector('#osm-location-map'))updateLocationValues();else if(state.page==='overview'&&content.querySelector('.overview-location .map-preview'))refreshOverviewWithoutReloadingMap();else if(state.page==='emergency'&&content.querySelector('.emergency-location-map'))refreshEmergencyCenter();else render({preserveInputs:true});}
}
async function connectUsb() {
  if(state.usbConnected){await state.serialReader?.cancel();return;}
  if(!('serial' in navigator)){toast('USB serial is supported in Chrome or Edge. Open this dashboard on localhost.','error');return;}
  try {
    const port=await navigator.serial.requestPort(); await port.open({baudRate:115200});
    state.serialPort=port;state.usbConnected=true;state.demo=false;state.serialBuffer='';state.serial.logs=[];state.serial.inSystemStatus=false;applySosVisual();
    document.querySelector('#usb-connect').textContent='Disconnect USB';render();
    const decoder=new TextDecoderStream();void port.readable.pipeTo(decoder.writable).catch(()=>{});const reader=decoder.readable.getReader();state.serialReader=reader;
    while(true){const {value,done}=await reader.read();if(done)break;state.serialBuffer+=value;const lines=state.serialBuffer.split(/\r?\n/);state.serialBuffer=lines.pop()||'';for(const line of lines)parseSerialLine(line);}
    reader.releaseLock();
  } catch(error) { if(error.name!=='NotFoundError')toast(`USB serial: ${error.message}`,'error'); }
  finally {try{await state.serialPort?.close();}catch{}state.serialPort=null;state.serialReader=null;state.usbConnected=false;document.querySelector('#usb-connect').textContent='Connect ESP32 USB';render();}
}
function bindPageActions() {
  bindManualSosAction();
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action, button.dataset.id)));
  document.querySelectorAll('[data-navigate]').forEach(a => a.addEventListener('click', event => { event.preventDefault(); location.hash = a.dataset.navigate; }));
  document.querySelectorAll('[data-range]').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b === btn)); state.chartRangeMins=Number(btn.dataset.range);drawChart(); }));
  document.querySelector('#contact-form')?.addEventListener('submit', addContact);
  document.querySelector('#settings-form')?.addEventListener('submit', saveSettings);
  document.querySelector('#history-search')?.addEventListener('input', () => { state.historyPage=1; updateDeviceHistoryRows(); });
  document.querySelector('#history-filter')?.addEventListener('change', updateDeviceHistoryRows);
  document.querySelector('#history-date-range')?.addEventListener('change', event=>{state.historyDateRange=event.currentTarget.value;state.historyPage=1;updateDeviceHistoryRows();});
  document.querySelector('#history-sort')?.addEventListener('change', event=>{state.historySort=event.currentTarget.value;state.historyPage=1;updateDeviceHistoryRows();});
  document.querySelector('#history-pagination')?.addEventListener('click',event=>{const button=event.target.closest('[data-history-page]');if(!button)return;state.historyPage=Number(button.dataset.historyPage);updateDeviceHistoryRows();});
}
function action(name, id) {
  if (name === 'sos') {
    if (!state.demoAllowed || !state.demo) { toast('Demo SOS is unavailable while live mode is selected.', 'error'); return; }
    const dialog = document.querySelector('#confirm-dialog');
    document.querySelector('#dialog-title').textContent = 'Trigger a demo SOS?';
    document.querySelector('#dialog-copy').textContent = 'This creates a local demo event only. No calls or SMS messages will be sent.';
    const confirm = document.querySelector('#dialog-confirm'); confirm.textContent = 'Trigger demo SOS';
    confirm.classList.remove('button-primary'); confirm.classList.add('button-danger');
    confirm.onclick = () => { state.emergency = { type: 'Manual SOS', source: 'Demo touch sensor', time: new Date() }; setSharedSos(true,{announce:true}); logEvent('Demo SOS triggered', 'Local preview · no notifications sent', 'alert'); toast('Demo SOS created. No one was contacted.'); setTimeout(render, 0); };
    dialog.showModal(); return;
  }
  if (name === 'resolve-emergency') {
    if (!state.emergency) return;
    const dialog = document.querySelector('#confirm-dialog'); document.querySelector('#dialog-title').textContent = 'Resolve this demo event?'; document.querySelector('#dialog-copy').textContent = 'The event will be marked resolved in this page preview. No external alerts are affected.';
    const confirm = document.querySelector('#dialog-confirm'); confirm.textContent = 'Resolve demo event'; confirm.classList.add('button-primary');
    confirm.onclick = () => { logEvent('Demo emergency resolved', 'Resolved in local preview', 'alert'); state.emergency = null; setSharedSos(false); toast('Demo event resolved.'); setTimeout(render, 0); };
    dialog.showModal(); return;
  }
  if (name === 'acknowledge') { logEvent('Demo alert acknowledged', 'Acknowledged in local preview', 'alert'); toast('Demo alert acknowledged.'); render(); return; }
  if (name === 'toggle-mode') {
    if (!state.demoAllowed) { toast('Demo mode is disabled by the server configuration.', 'error'); return; }
    state.demo = !state.demo;
    if (!state.demo) { state.events = []; state.contacts = []; state.emergency = null; }
    toast(state.demo ? 'Demo mode enabled. Readings are illustrative.' : 'Live mode selected. Sign in to view saved device data.'); render(); return;
  }
  if (name === 'contact-edit') {state.contactEditingId=Number(id);render();return;}
  if (name === 'contact-cancel-edit') {state.contactEditingId=null;render();return;}
  if (name === 'email-emergency') {openEmergencyEmailDraft();return;}
  if (name === 'contact-delete') { state.contacts = state.contacts.filter(c => c.id !== Number(id)); persistLocalState(); toast('Contact removed from this browser.'); render(); return; }
  if (name === 'contact-primary') { state.contacts.forEach(c => c.primary = c.id === Number(id)); persistLocalState(); render(); return; }
  if (name === 'theme-toggle') { setTheme(state.theme==='light'?'dark':'light'); render(); return; }
  if (name === 'usb-toggle') { void connectUsb(); return; }
  if (name === 'refresh-map') {if(state.locationMap&&state.serial.latitude!=null){const point=[Number(state.serial.latitude),Number(state.serial.longitude)];state.locationMap.setView(point,16);state.locationMarker?.setLatLng(point).openPopup();state.lastMapUpdatedAt=Date.now();state.lastMapCoords=point;}else toast('The ESP32 has not reported a GPS fix yet.','error');return;}
  if (name === 'clear-local-history') {if(confirm('Clear saved sensor history and the last device report from this browser?')){void clearLocalReadings();}return;}
  if (name === 'export-csv') { exportCsv(); return; }
  if (name === 'export-local-backup') { exportLocalBackup(); return; }
  if (name === 'toggle-csv-recording') { void toggleCsvRecording(); return; }
  if (name === 'help') { toast('Support resources will be available when account services are connected.'); return; }
}
function addContact(event) {
  event.preventDefault();const data=new FormData(event.currentTarget),phone=String(data.get('phone')).replace(/[\s()-]/g,'').replace(/^\+91/,''),email=String(data.get('email')).trim().toLowerCase();
  if(!/^[6-9]\d{9}$/.test(phone)){toast('Enter a valid 10-digit Indian mobile number.','error');document.querySelector('#contact-phone').focus();return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast('Enter a valid emergency email address.','error');document.querySelector('#contact-email').focus();return;}
  const current=state.contacts.find(c=>c.id===state.contactEditingId);
  const contact={id:current?.id||Date.now(),name:String(data.get('name')).trim(),relationship:String(data.get('relationship')).trim(),phone:`+91 ${phone}`,email,priority:Number(data.get('priority')),active:true,primary:current?.primary??state.contacts.length===0};
  if(current){state.contacts=state.contacts.map(c=>c.id===current.id?contact:c);state.contactEditingId=null;toast('Emergency contact updated locally.');}
  else{state.contacts.push(contact);toast('Emergency contact saved locally.');}
  persistLocalState();render();
}
function saveSettings(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget); state.demo = state.demoAllowed && data.get('demo') === 'on';
  if (!state.demo) { state.events = []; state.contacts = []; state.emergency = null; }
  toast('Dashboard preferences updated for this session.'); render();
}
function exportCsv() {
  if(state.page==='history'){
    const rows=[['report_id','category','description','timestamp','source_or_location','status'],...filteredDeviceHistoryEvents().map(event=>[event.id,event.category,event.description,new Date(event.time).toISOString(),event.location,event.status])];
    const csv=rows.map(row=>row.map(cell=>`"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='safeher-event-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);toast('Filtered ESP32 history exported as CSV.');return;
  }
  const rows = [['timestamp','mpu_connected','accel_magnitude_g','latitude','longitude','satellites','touch','sos','buzzer','led'], ...state.readingHistory.map(r => [new Date(r.time).toISOString(),r.mpuConnected,r.accelMagnitude,r.latitude,r.longitude,r.satellites,r.touch,r.sos,r.buzzer,r.led])];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' })); link.download = 'safeher-device-history.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast('Saved device history exported as CSV.');
}
function exportLocalBackup() {
  let saved={};
  try { saved=JSON.parse(localStorage.getItem('safeher-local-device')||'{}'); } catch {}
  const backup={...saved,readingHistory:state.readingHistory,exportedAt:new Date().toISOString(),format:'Safe Her local browser backup'};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`safeher-local-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);
  toast(`Downloaded backup with ${state.readingHistory.length} saved ESP32 reports.`);
}
function csvCell(value) {
  const text=value==null?'':String(value);
  return `"${text.replaceAll('"','""')}"`;
}
function csvLine(report) {
  return csvReadingFields.map(field=>csvCell(field==='time'?new Date(report.time).toISOString():report[field])).join(',');
}
async function toggleCsvRecording() {
  if(state.csvRecording){
    await csvWriteQueue;
    state.csvRecording=false;
    state.csvFileHandle=null;
    toast('CSV recording stopped.');
    render();
    return;
  }
  if(typeof window.showSaveFilePicker!=='function'){
    toast('CSV recording needs Chrome or Edge on localhost or HTTPS.','error');
    return;
  }
  try {
    const handle=await window.showSaveFilePicker({suggestedName:'safeher-readings.csv',types:[{description:'CSV file',accept:{'text/csv':['.csv']}}]});
    const file=await handle.getFile(),existing=await file.text(),header=csvReadingFields.map(csvCell).join(',');
    if(existing.trim()){
      const lines=existing.trimEnd().split(/\r?\n/),existingHeader=lines[0];
      if(existingHeader!==header){
        if(!window.confirm('This file is not a Safe Her CSV with the current columns. Replace it with your saved readings?'))return;
        const writable=await handle.createWritable();
        await writable.write(`${header}\r\n${state.readingHistory.map(csvLine).join('\r\n')}${state.readingHistory.length?'\r\n':''}`);
        await writable.close();
      }else{
        const lastLine=lines.at(-1)||'',lastTimestamp=Date.parse(lastLine.split(',')[0]?.replace(/^"|"$/g,''));
        const newRows=state.readingHistory.filter(report=>Number.isFinite(lastTimestamp)?Number(report.time)>lastTimestamp:true);
        if(newRows.length){const writable=await handle.createWritable({keepExistingData:true});await writable.seek(file.size);await writable.write(`${file.size?'\r\n':''}${newRows.map(csvLine).join('\r\n')}\r\n`);await writable.close();}
      }
    }else{
      const writable=await handle.createWritable();
      await writable.write(`${header}\r\n${state.readingHistory.map(csvLine).join('\r\n')}${state.readingHistory.length?'\r\n':''}`);
      await writable.close();
    }
    state.csvFileHandle=handle;
    state.csvRecording=true;
    toast(`CSV recording started with ${state.readingHistory.length} saved reports.`);
    render();
  }catch(error){
    if(error.name!=='AbortError')toast(`Could not start CSV recording: ${error.message}`,'error');
  }
}
function appendCsvReading(report) {
  if(!state.csvRecording||!state.csvFileHandle)return;
  const handle=state.csvFileHandle;
  csvWriteQueue=csvWriteQueue.then(async()=>{
    if(!state.csvRecording||state.csvFileHandle!==handle)return;
    const file=await handle.getFile(),writable=await handle.createWritable({keepExistingData:true});
    await writable.seek(file.size);
    await writable.write(`${file.size?'\r\n':''}${csvLine(report)}\r\n`);
    await writable.close();
  }).catch(error=>{
    state.csvRecording=false;
    state.csvFileHandle=null;
    toast(`CSV recording stopped: ${error.message}`,'error');
    if(state.page==='settings')render();
  });
}
function updateHistoryRows() {
  const body = document.querySelector('.table-wrap tbody'); if (!body) return;
  const q = document.querySelector('#event-search').value.toLowerCase(), type = document.querySelector('#event-filter').value;
  const rows = state.events.filter(e => (type === 'all' || e.category === type) && `${e.type} ${e.detail}`.toLowerCase().includes(q));
  body.innerHTML = rows.map(e=>`<tr><td>${esc(e.type)}</td><td class="muted">${esc(e.detail)}</td><td><span class="badge ${e.category==='alert'?'danger':''}">${esc(e.category)}</span></td><td>${nowTime(e.time)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No events match these filters.</td></tr>';
}
function updateDeviceHistoryRows() {
  const body=document.querySelector('#history-table-body');if(!body)return;
  state.historySearch=document.querySelector('#history-search')?.value||'';
  state.historyFilter=document.querySelector('#history-filter')?.value||'all';
  state.historyDateRange=document.querySelector('#history-date-range')?.value||'7d';
  state.historySort=document.querySelector('#history-sort')?.value||'newest';
  const result=deviceHistoryRows();
  body.innerHTML=historyRowsMarkup(result.pageRows);
  const count=document.querySelector('#history-count');if(count)count.textContent=result.start?`Showing ${result.start}–${result.end} of ${result.total} reports · Local browser archive`:'No reports match these filters. · Local browser archive';
  const pagination=document.querySelector('#history-pagination');if(pagination)pagination.innerHTML=historyPaginationMarkup(result.pages,state.historyPage);
}
function drawFallChart() {
  const canvas=document.querySelector('#fall-chart');if(!canvas)return;
  const rect=canvas.getBoundingClientRect();if(!rect.width)return;
  const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const h=rect.height,w=rect.width,pad=20;
  ctx.strokeStyle=state.theme==='light'?'#d8dfeb':'#253043';ctx.beginPath();ctx.moveTo(pad,h-pad);ctx.lineTo(w-8,h-pad);ctx.stroke();
  const points=state.readingHistory.slice(-120).filter(r=>Number.isFinite(Number(r.accelMagnitude)));
  if(!points.length){ctx.fillStyle=state.theme==='light'?'#68758a':'#9ba6b9';ctx.font='11px DM Sans';ctx.fillText('Waiting for ESP32 samples',pad,h/2);return;}
  const vals=points.map(r=>Number(r.accelMagnitude)),min=Math.min(0,...vals),max=Math.max(2,...vals),span=max-min||1;
  ctx.beginPath();points.forEach((r,i)=>{const x=pad+i*(w-pad-8)/Math.max(1,points.length-1),y=h-pad-(Number(r.accelMagnitude)-min)/span*(h-2*pad);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  ctx.strokeStyle='#d95691';ctx.lineWidth=2;ctx.stroke();
}
function safeHerAnswer(question){
  const q=question.toLowerCase().replace(/[^a-z0-9@.+ -]/g,' '),d=state.serial||{};
  if(/\b(hi|hello|hey)\b/.test(q))return {text:'Hello! I can help with Safe Her SOS, device status, fall detection, emergency contacts, and the latest GPS location.'};
  if(/\b(map|where|location|gps|coordinates|address)\b/.test(q)){
    const loc=state.live?.latest_location;
    const lat=Number(d.latitude??loc?.latitude),lon=Number(d.longitude??loc?.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&((d.latitude!=null&&d.longitude!=null)||loc))return {text:`Latest device coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}. Open the point in Google Maps:`,link:`https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}`,label:'Open device location ↗'};
    return {text:'There is no GPS fix available yet, so I can’t provide a reliable map link. Connect the ESP32 and wait for a GPS fix, then ask me again.'};
  }
  if(/\b(update|change|edit|add|number|phone|contact|mobile)\b/.test(q)){
    const contacts=state.contacts||[];
    if(/\b(my|saved|current|what is|what's)\b/.test(q)&&contacts.length){return {text:`Emergency contacts saved in this browser:\n${contacts.map(c=>`${c.name}: ${c.phone||'no phone saved'}`).join('\n')}\nYou can edit a contact from the Emergency Contacts page.` ,link:'#contacts',label:'Open emergency contacts →'};}
    return {text:'You can add or change an emergency contact from Emergency Contacts. Open the page, choose Edit on the contact, update the phone number, and save. Changes are stored in this browser.',link:'#contacts',label:'Manage emergency contacts →'};
  }
  if(/\b(fall|freefall|impact|detect)\b/.test(q))return {text:'The ESP32 firmware detects a possible fall when acceleration drops below 0.65 g, then rises above 2.5 g within 1.5 seconds. That sequence activates SOS. This is threshold-based detection.'};
  if(/\b(sos|emergency|alert|buzzer|alarm)\b/.test(q))return {text:`${d.sos==='ACTIVE'||state.sharedSosActive?'SOS is currently ACTIVE. Check on the user now.':'No active SOS is currently reported.'} The ESP32 touch control activates SOS; a 3-second hold cancels an active SOS. The dashboard can notify configured contacts when the live device reports SOS.`};
  if(/\b(device|usb|connect|sensor|mpu|status|online|offline)\b/.test(q))return {text:`ESP32 USB is ${state.usbConnected?'connected':'not connected'}${d.mpuConnected===true?', and the MPU6050 is reported connected':d.mpuConnected===false?', but the MPU6050 is reported disconnected': ''}. ${d.updatedAt?`Latest device report: ${new Date(d.updatedAt).toLocaleString()}.`:'No device report has been received in this session.'} Use “Connect ESP32 USB” in the top bar to connect.`};
  if(/\b(help|what can|feature|how to)\b/.test(q))return {text:'I can explain SOS and fall detection, report connection status, show saved emergency contacts, and provide a Google Maps link when the device has a GPS fix. Ask a specific question, such as “Where is my device?”'};
  return {text:'I can answer questions using Safe Her’s current dashboard data and documented device behavior. Try asking about SOS, fall detection, emergency contacts, USB status, or the device map. I don’t have access to information outside this system.'};
}
function addChatMessage(text,who='assistant',link=null,label=''){
  const messages=document.querySelector('#chat-messages');if(!messages)return;
  const bubble=document.createElement('div');bubble.className=`chat-message ${who}-message`;bubble.textContent=text;
  if(link){const anchor=document.createElement('a');anchor.href=link;anchor.textContent=label;if(link.startsWith('http')){anchor.target='_blank';anchor.rel='noopener noreferrer';}else anchor.addEventListener('click',()=>{document.querySelector('#chat-panel').hidden=true;document.querySelector('#chat-launcher').setAttribute('aria-expanded','false');});bubble.append(document.createElement('br'),anchor);}
  messages.append(bubble);messages.scrollTop=messages.scrollHeight;
}
function submitChatQuestion(question){const text=question.trim();if(!text)return;addChatMessage(text,'user');const answer=safeHerAnswer(text);addChatMessage(answer.text,'assistant',answer.link,answer.label);}
function initializeChat(){
  const launcher=document.querySelector('#chat-launcher'),panel=document.querySelector('#chat-panel'),input=document.querySelector('#chat-input');
  launcher.addEventListener('click',()=>{panel.hidden=!panel.hidden;launcher.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)input.focus();});
  document.querySelector('#chat-close').addEventListener('click',()=>{panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus();});
  document.querySelector('#chat-form').addEventListener('submit',event=>{event.preventDefault();submitChatQuestion(input.value);input.value='';input.focus();});
  document.querySelectorAll('[data-chat-prompt]').forEach(button=>button.addEventListener('click',()=>submitChatQuestion(button.dataset.chatPrompt)));
}
function navigate() { const page = location.hash.slice(1); state.page = renderers[page] ? page : 'overview'; render(); document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); }
window.addEventListener('hashchange', navigate);
window.addEventListener('resize', () => { drawChart(); drawFallChart(); });
document.querySelector('#menu-toggle').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#mobile-overlay').classList.add('show'); });
document.querySelector('#mobile-overlay').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); });
document.querySelector('#theme-toggle').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
document.querySelector('#usb-connect').addEventListener('click', () => void connectUsb());
document.querySelector('#notification-button').addEventListener('click', () => toast(state.emergency ? 'The ESP32 reports an active SOS.' : 'No active SOS reported by the ESP32.'));
initializeChat();
window.addEventListener('storage',event=>{
  if(event.key!=='safeher-sos-status')return;
  try{const status=JSON.parse(event.newValue||'null');if(!status||typeof status.active!=='boolean')return;state.sharedSosActive=status.active;applySosVisual();if(status.active)playSosAlarm();}
  catch{}
});
try{const status=JSON.parse(localStorage.getItem('safeher-sos-status')||'null');state.sharedSosActive=Boolean(status?.active);}catch{}
setTheme(state.theme);
async function initialize() {
  await restoreLocalState(); state.demo=false; state.authenticated=false; state.page=location.hash.slice(1)||'overview';
  render();
}
void initialize();
window.setInterval(updateReportAge,1000);
