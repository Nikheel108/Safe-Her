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
  lastMapUpdatedAt: 0,
  locationMap: null,
  locationMarker: null,
  chartRangeMins: 1,
  historySearch: '',
  historyFilter: 'all',
  contactEditingId: null,
  emergency: null,
  activity: '—',
  confidence: 0,
  coords: { lat: null, lon: null, accuracy: null },
  series: [],
  events: [],
  contacts: [],
};

function restoreLocalState() {
  try {
    const saved=JSON.parse(localStorage.getItem('safeher-local-device')||'null');
    if(!saved)return;
    if(saved.serial&&typeof saved.serial==='object')state.serial={...state.serial,...saved.serial};
    if(Array.isArray(saved.series))state.series=saved.series.slice(-600);
    if(!state.series.length&&Array.isArray(saved.readingHistory))state.series=saved.readingHistory.map(r=>({x:Number(r.accelX),y:Number(r.accelY),z:Number(r.accelZ),t:Number(r.time)})).filter(r=>Number.isFinite(r.x)&&Number.isFinite(r.y)&&Number.isFinite(r.z)).slice(-120);
    if(Array.isArray(saved.readingHistory))state.readingHistory=saved.readingHistory.slice(-2000);
    if(Array.isArray(saved.contacts))state.contacts=saved.contacts;
    state.events=[];
    state.demo=false;
    if(state.serial.latitude!=null&&state.serial.longitude!=null)state.coords={lat:Number(state.serial.latitude),lon:Number(state.serial.longitude),accuracy:state.serial.hdop==null?null:Number(state.serial.hdop)*5};
    state.emergency=state.serial.sos==='ACTIVE'?{type:'ESP32 SOS',source:'Device safety logic',time:new Date(state.serial.updatedAt||Date.now())}:null;
  } catch { /* Ignore a damaged or unavailable local browser cache. */ }
}
function persistLocalState() {
  try { localStorage.setItem('safeher-local-device',JSON.stringify({serial:state.serial,series:state.series.slice(-600),readingHistory:state.readingHistory.slice(-2000),contacts:state.contacts,events:state.events.slice(-200)})); }
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
  return `<div class="page-heading"><div><div class="eyebrow">MANAGE / CONNECTED HARDWARE</div><h1>Device Management</h1><p>Hardware capabilities are shown as reported; unsupported telemetry stays unavailable.</p></div><span class="demo-chip"><i></i>${online?'ILLUSTRATIVE DEMO STATUS':'NO DEVICE CONNECTED'}</span></div><div class="wide-grid"><div class="card-stack">${[['ESP32 DevKit','WSD_001',online?'Online':'Offline','Wi-Fi connection',online?'Connected':'Unavailable','Firmware version','Not reported'],['SIM800L GSM','Emergency fallback',online?'Ready (demo)':'Unavailable','Network registration','Not reported','Signal strength','Not reported'],['NEO-6M GPS','Location module',online?'Fix available (demo)':'No fix','Latitude / longitude',online?coordsText():'Unavailable','Satellites','Not reported'],['MPU6050','Motion sensor',online?'Connected (demo)':'Unavailable','Last reading',online?'Illustrative only':'Unavailable','Sample interval','3 seconds (demo)']].map(([name,id,status,l1,v1,l2,v2])=>`<div class="detail-card"><div class="section-header"><h3 style="margin:0">${name}</h3><span class="badge ${online?'success':''}">${status}</span></div><div class="detail-row"><span>Module / ID</span><strong>${id}</strong></div><div class="detail-row"><span>${l1}</span><strong>${v1}</strong></div><div class="detail-row"><span>${l2}</span><strong>${v2}</strong></div></div>`).join('')}</div><div class="card-stack"><div class="detail-card"><h3>Device configuration</h3><div class="form-field"><label for="device-id">Device ID</label><input id="device-id" value="WSD_001" readonly /></div><div class="form-field" style="margin-top:10px"><label for="sensor-interval">Sensor update interval</label><select id="sensor-interval"><option>3 seconds</option><option>5 seconds</option><option>10 seconds</option></select></div><div class="form-field" style="margin-top:10px"><label for="gps-interval">GPS update interval</label><select id="gps-interval"><option>5 seconds</option><option>10 seconds</option><option>30 seconds</option></select></div><p class="field-help">Settings are a UI preview and are not sent to hardware.</p></div><div class="detail-card"><h3>Integration status</h3><div class="empty-state">No ESP32 integration endpoint is configured in this first dashboard phase.</div></div></div></div>`;
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
  const active=state.serial.sos==='ACTIVE';
  document.documentElement.classList.toggle('sos-active',active);
  const banner=document.querySelector('#sos-alert-banner');
  if(banner){banner.hidden=!active;banner.textContent=active?'SOS ACTIVE · The ESP32 reports an active emergency. Use the device touch control to cancel.':'';}
}
function render({preserveInputs=false}={}) {
  const focusedId=preserveInputs&&content.contains(document.activeElement)?document.activeElement.id:null;
  const inputState=preserveInputs?Array.from(content.querySelectorAll('input,select,textarea')).map(el=>({id:el.id,value:el.value,checked:el.checked,start:typeof el.selectionStart==='number'?el.selectionStart:null,end:typeof el.selectionEnd==='number'?el.selectionEnd:null})):[];
  if (!renderers[state.page]) state.page = 'overview';
  const usbPages={overview:usbOverviewPage,live:serialDashboardPage,location:usbLocationPage,emergency:usbEmergencyPage,activity:usbActivityPage,contacts:usbContactsPage,history:usbHistoryPage,device:usbDevicePage,settings:usbSettingsPage};
  content.innerHTML = usbPages[state.page]();
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
  if(d.latitude!=null&&d.longitude!=null){state.lastMapCoords=[Number(d.latitude),Number(d.longitude)];state.lastMapUpdatedAt=Date.now();}
  const row=(name,value)=>`<div class="detail-row"><span>${name}</span><strong>${v(value)}</strong></div>`;
  return `<div class="page-heading"><div><div class="eyebrow">SAFE HER / USB SERIAL MONITOR</div><h1>Live device readings</h1><p>${state.usbConnected?'Reading directly from the ESP32 USB serial stream.':'Connect the ESP32 by USB, then select its serial port.'}</p></div><span class="demo-chip"><i></i>${state.usbConnected?'USB CONNECTED':'WAITING FOR USB'}</span></div>${!state.usbConnected?'<div class="panel" style="margin-bottom:16px"><strong>Before connecting</strong><p>Close Arduino Serial Monitor so the dashboard can use the USB port. Open this page in Chrome or Edge on localhost, then select the ESP32 port.</p></div>':''}<div class="status-grid">${[['MPU SENSOR',d.mpuConnected?'Connected':'Waiting',d.whoAmI?`WHO_AM_I ${d.whoAmI}`:''],['GPS',gps?'Fix available':'No fix',d.satellites!=null?`${d.satellites} satellites`:''],['SOS',v(d.sos||'—'),d.fallDetection?`Fall detection ${d.fallDetection}`:''],['OUTPUTS',`Buzzer ${v(d.buzzer)}`,`LED ${v(d.led)}`]].map(([title,value,sub])=>`<article class="status-card"><div class="status-top"><span>${title}</span></div><div class="status-main">${value}</div><div class="status-sub">${sub||'Waiting for serial data'}</div></article>`).join('')}</div><div class="section-row"><div class="section-header"><span class="section-title">MPU6050 SENSOR</span><span class="section-meta">${d.updatedAt?`Updated ${new Date(d.updatedAt).toLocaleTimeString()}`:'Waiting for first status report'}</span></div><div class="sensor-grid">${[['Accel X',d.accelX,'g'],['Accel Y',d.accelY,'g'],['Accel Z',d.accelZ,'g'],['Acceleration magnitude',d.accelMagnitude,'g'],['Gyro X',d.gyroX,'°/s'],['Gyro Y',d.gyroY,'°/s'],['Gyro Z',d.gyroZ,'°/s'],['Temperature',d.temperature,'°C']].map(([label,value,unit])=>`<article class="sensor-card"><div class="sensor-label">${label}</div><div class="sensor-value">${v(value)} <em>${value==null?'':unit}</em></div><div class="sensor-foot"><span>USB serial</span></div></article>`).join('')}</div></div><div class="section-row charts-grid">${chartMarkup()}<div class="panel"><div class="section-title">GPS SENSOR</div>${row('Location',gps?`${d.latitude}, ${d.longitude}`:d.locationStatus||'Waiting for GPS fix')}${row('Satellites',d.satellites)}${row('HDOP',d.hdop)}${row('Location age',d.locationAge==null?null:`${d.locationAge} ms`)}${row('Altitude',d.altitude==null?null:`${d.altitude} m`)}${row('Speed',d.speed==null?null:`${d.speed} km/h`)}${row('GPS date/time',d.gpsDateTime)}${gps?`<a class="button" style="display:inline-block;margin-top:12px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${encodeURIComponent(`${d.latitude},${d.longitude}`)}">Open location in Maps ↗</a>`:''}</div><div class="panel"><div class="section-title">TOUCH & OUTPUTS</div>${row('Touch state',d.touch)}${row('Buzzer',d.buzzer)}${row('LED',d.led)}<div class="section-title" style="margin-top:18px">SAFETY LOGIC</div>${row('SOS',d.sos)}${row('Fall detection',d.fallDetection)}${row('Freefall detected',d.freeFall)}${row('Cancel hold',d.cancelHold)}${row('MPU identity',d.whoAmI)}${row('GPS characters processed',d.gpsCharacters)}</div></div><div class="section-row panel"><div class="section-header"><span class="section-title">SERIAL OUTPUT</span><span class="section-meta">115200 baud</span></div><pre style="max-height:220px;overflow:auto;white-space:pre-wrap;font:12px monospace">${d.logs.map(esc).join('\n')||'Waiting for USB serial output…'}</pre><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="button" href="#activity" data-navigate="activity">Activity and fall graph</a><a class="button" href="#emergency" data-navigate="emergency">Emergency status</a><a class="button" href="#history" data-navigate="history">Saved history</a></div></div>`;
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
 const values=[['MPU sensor',d.mpuConnected==null?'—':d.mpuConnected?'Connected':'Disconnected'],['Acceleration magnitude',d.accelMagnitude==null?'—':`${d.accelMagnitude} g`],['GPS',fix?`${d.latitude}, ${d.longitude}`:'No fix'],['Touch',d.touch||'—'],['SOS',d.sos||'—'],['Buzzer / LED',`${d.buzzer||'—'} / ${d.led||'—'}`]];
 return `<div class="page-heading"><div><div class="eyebrow">SAFE HER / DEVICE DASHBOARD</div><h1>Overview</h1><p>Actual values from the ESP32 USB serial report. No sample data is generated.</p></div><span class="badge ${state.usbConnected?'success':''}">${state.usbConnected?'USB LIVE':'USB DISCONNECTED'}</span></div><div class="status-grid">${values.map(([k,v])=>`<article class="status-card"><div class="status-top">${k}</div><div class="status-main">${esc(v)}</div><div class="status-sub">${state.usbConnected?'Current device report':'Last saved device report'}</div></article>`).join('')}</div>${has?`<div class="section-row charts-grid">${chartMarkup()}<div class="panel"><div class="section-title">LATEST SENSOR READINGS</div>${[['Accel X',d.accelX,'g'],['Accel Y',d.accelY,'g'],['Accel Z',d.accelZ,'g'],['Gyro X',d.gyroX,'°/s'],['Gyro Y',d.gyroY,'°/s'],['Gyro Z',d.gyroZ,'°/s'],['Temperature',d.temperature,'°C']].map(([k,v,u])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':`${esc(v)} ${u}`}</strong></div>`).join('')}</div></div>`:'<div class="panel empty-state section-row">No ESP32 status report yet. Connect the device to populate the overview and graphs.</div>'}<div class="section-row"><a class="button" href="#live" data-navigate="live">Open Live Monitoring →</a> <a class="button" href="#location" data-navigate="location">Open GPS location →</a> <a class="button" href="#history" data-navigate="history">Review local history →</a></div>`;
}
function usbContactsPage() {
 const editing=state.contacts.find(c=>c.id===state.contactEditingId)||null;
 const mailUrl=email=>`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Safe Her emergency contact')}`;
 return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / TRUSTED PEOPLE</div><h1>Emergency Contacts</h1><p>Contact information is saved in this browser. Email links open your mail app; the dashboard does not send mail.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">SAVED CONTACTS (${state.contacts.length})</div>${state.contacts.map(c=>`<div class="detail-card contact-card"><span class="contact-avatar">${esc(c.name.slice(0,2).toUpperCase())}</span><span class="contact-info"><strong>${esc(c.name)} ${c.primary?'<span class="badge success">PRIMARY</span>':''}</strong><small>${esc(c.relationship)} · ${esc(c.phone)} · ${esc(c.email||'Email not added')}</small></span><span class="contact-actions">${c.email?`<a class="button" href="${esc(mailUrl(c.email))}">Email</a>`:''}<button class="button" data-action="contact-primary" data-id="${c.id}" ${c.primary?'disabled':''}>${c.primary?'Primary':'Set primary'}</button><button class="button" data-action="contact-edit" data-id="${c.id}">Edit</button><button class="button" data-action="contact-delete" data-id="${c.id}">Remove</button></span></div>`).join('')||'<div class="empty-state">No contacts saved. Add a trusted contact using the form.</div>'}</div><form class="panel" id="contact-form"><div class="section-header"><span class="section-title">${editing?'EDIT CONTACT':'ADD CONTACT'}</span>${editing?'<button type="button" class="button" data-action="contact-cancel-edit">Cancel edit</button>':''}</div><div class="form-grid"><div class="form-field"><label for="contact-name">Name</label><input id="contact-name" name="name" value="${esc(editing?.name||'')}" required maxlength="60" autocomplete="name"></div><div class="form-field"><label for="contact-phone">Phone</label><input id="contact-phone" name="phone" value="${esc(editing?.phone||'')}" required inputmode="tel" placeholder="+91 98765 43210" autocomplete="tel"></div><div class="form-field"><label for="contact-email">Emergency email</label><input id="contact-email" name="email" value="${esc(editing?.email||'')}" type="email" required maxlength="254" placeholder="name@example.com" autocomplete="email"></div><div class="form-field"><label for="contact-relationship">Relationship</label><input id="contact-relationship" name="relationship" value="${esc(editing?.relationship||'')}" required maxlength="40" placeholder="Family, friend…"></div><div class="form-field"><label for="contact-priority">Priority</label><select id="contact-priority" name="priority">${[1,2,3,4,5].map(n=>`<option value="${n}" ${(editing?.priority||1)===n?'selected':''}>${n}</option>`).join('')}</select></div></div><button class="button button-primary" style="margin-top:13px" type="submit">${editing?'Save contact changes':'Save contact locally'}</button></form></div>`;
}
function usbSettingsPage() {
 const size=new Blob([localStorage.getItem('safeher-local-device')||'']).size;
 return `<div class="page-heading"><div><div class="eyebrow">MANAGE / PREFERENCES</div><h1>Settings</h1><p>USB connection, appearance, and local browser storage.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">DEVICE CONNECTION</div><div class="detail-row"><span>Connection</span><strong>${state.usbConnected?'USB connected':'Disconnected; showing last saved report'}</strong></div><div class="detail-row"><span>Serial speed</span><strong>115200 baud</strong></div><button class="button button-primary" style="margin-top:12px" data-action="usb-toggle">${state.usbConnected?'Disconnect ESP32':'Connect ESP32 USB'}</button></div><div class="panel"><div class="section-title">LOCAL DATA</div><div class="detail-row"><span>Saved sensor reports</span><strong>${state.readingHistory.length}</strong></div><div class="detail-row"><span>Browser storage used</span><strong>${size} bytes</strong></div><div class="detail-row"><span>Storage location</span><strong>This browser on this computer</strong></div><p class="field-help">Readings stay on this browser and are not uploaded. Clearing browser site data removes them.</p><button class="button button-danger" data-action="clear-local-history">Clear saved readings</button></div><div class="panel"><div class="section-title">APPEARANCE</div><div class="detail-row"><span>Theme</span><strong>${state.theme==='light'?'Light':'Dark'}</strong></div><button class="button" data-action="theme-toggle">Switch to ${state.theme==='light'?'dark':'light'} mode</button></div></div>`;
}
function usbHistoryPage() {
 const q=state.historySearch.toLowerCase(),filter=state.historyFilter;
 const rows=state.readingHistory.slice().reverse().filter(r=>{const text=[r.time,r.mpuConnected,r.accelMagnitude,r.latitude,r.longitude,r.touch,r.sos,r.fallDetection,r.freeFall,r.buzzer,r.led].join(' ').toLowerCase();return(!q||text.includes(q))&&(filter==='all'||filter==='sos'&&r.sos==='ACTIVE'||filter==='gps'&&r.latitude!=null||filter==='fall'&&r.freeFall==='YES');});
 return `<div class="page-heading"><div><div class="eyebrow">DEVICE / LOCAL ARCHIVE</div><h1>Event History</h1><p>ESP32 status reports saved only in this browser.</p></div><button class="button" data-action="export-csv">Export CSV ↓</button></div><div class="panel"><div class="heading-actions" style="justify-content:flex-start;margin-bottom:12px"><input id="history-search" value="${esc(state.historySearch)}" class="select-control" type="search" placeholder="Search saved readings" aria-label="Search saved readings"><select id="history-filter" class="select-control" aria-label="Filter saved readings"><option value="all" ${state.historyFilter==='all'?'selected':''}>All reports</option><option value="sos" ${state.historyFilter==='sos'?'selected':''}>SOS active</option><option value="gps" ${state.historyFilter==='gps'?'selected':''}>GPS fixes</option><option value="fall" ${state.historyFilter==='fall'?'selected':''}>Freefall</option></select></div><div class="table-wrap"><table><thead><tr><th>TIME</th><th>MPU</th><th>ACCELERATION</th><th>GPS</th><th>TOUCH</th><th>SOS</th><th>BUZZER / LED</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.time).toLocaleString()}</td><td>${esc(r.mpuConnected??'—')}</td><td>${esc(r.accelMagnitude??'—')} g</td><td>${r.latitude==null?'No fix':`${esc(r.latitude)}, ${esc(r.longitude)}`}</td><td>${esc(r.touch||'—')}</td><td>${esc(r.sos||'—')}</td><td>${esc(r.buzzer||'—')} / ${esc(r.led||'—')}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No ESP32 reports have been saved.</td></tr>'}</tbody></table></div></div>`;
}

function usbDevicePage() {
 const d=state.serial;
 return `<div class="page-heading"><div><div class="eyebrow">MANAGE / CONNECTED HARDWARE</div><h1>Device Management</h1><p>${state.usbConnected?'ESP32 connected directly by USB.':'Showing last serial readings; USB is disconnected.'}</p></div><button class="button button-primary" data-action="usb-toggle">${state.usbConnected?'Disconnect ESP32':'Connect ESP32 USB'}</button></div><div class="wide-grid"><div class="panel"><div class="section-title">SAFE HER DEVICE</div>${[['Device ID','WSD_001'],['Connection',state.usbConnected?'USB serial':'Disconnected'],['Baud rate','115200'],['MPU sensor',d.mpuConnected?'Connected':d.mpuConnected===false?'Disconnected':'Not reported'],['MPU identity',d.whoAmI],['Latest serial report',d.updatedAt?new Date(d.updatedAt).toLocaleString():'None']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}<div style="display:flex;gap:8px;margin-top:12px"><a class="button" href="#live" data-navigate="live">Live readings</a><a class="button" href="#settings" data-navigate="settings">Connection settings</a></div></div><div class="panel"><div class="section-title">DEVICE OUTPUTS</div>${[['Touch',d.touch],['Buzzer',d.buzzer],['LED',d.led],['SOS',d.sos],['Fall detection',d.fallDetection],['Freefall',d.freeFall]].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}</div></div>`;
}
function usbEmergencyPage() {
 const d=state.serial,active=d.sos==='ACTIVE';
 return `<div class="page-heading"><div><div class="eyebrow">RESPONSE / SAFETY STATUS</div><h1>Emergency Center</h1><p>This page reflects the ESP32 touch and SOS logic; controls on the device activate and cancel SOS.</p></div><span class="badge ${active?'danger':'success'}">${active?'SOS ACTIVE':'NORMAL'}</span></div><div class="panel"><div class="section-title">CURRENT DEVICE SAFETY STATE</div><div class="safe-mark" style="margin-top:13px"><span class="safe-icon">${active?'!':'✓'}</span><span><strong>${active?'SOS activated on device':'No active SOS'}</strong><small>${state.usbConnected?'Live status from USB serial':'Last saved device status'} · Use the ESP32 touch sensor to activate or cancel.</small></span></div>${[['SOS',d.sos],['Touch sensor',d.touch],['Fall detection',d.fallDetection],['Freefall detected',d.freeFall],['Acceleration magnitude',d.accelMagnitude==null?null:`${d.accelMagnitude} g`],['GPS',d.latitude==null?'No fix':`${d.latitude}, ${d.longitude}`]].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${active?'<button class="button button-danger" data-action="email-emergency">Prepare emergency email</button>':''}<a class="button" href="#location" data-navigate="location">Open device location →</a><a class="button" href="#activity" data-navigate="activity">Review fall signals →</a><a class="button" href="#history" data-navigate="history">SOS event history →</a></div></div>`;
}
function usbActivityPage() {
  const d=state.serial;
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / DEVICE LOGIC</div><h1>Activity Detection</h1><p>The current firmware reports freefall and impact detection; it does not classify walking or running.</p></div></div><div class="wide-grid"><div class="panel"><div class="section-title">LIVE SAFETY SIGNALS</div>${[['Acceleration magnitude',d.accelMagnitude==null?null:`${d.accelMagnitude} g`],['Fall detection',d.fallDetection],['Freefall detected',d.freeFall],['SOS',d.sos],['MPU sensor',d.mpuConnected?'Connected':'Disconnected']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><strong>${v==null?'—':esc(v)}</strong></div>`).join('')}</div><div class="panel"><div class="section-title">ACCELERATION HISTORY</div><p class="chart-sub">Actual acceleration magnitude reported by the MPU sensor.</p><canvas id="fall-chart" class="chart-canvas" aria-label="ESP32 acceleration magnitude over time"></canvas><div class="detail-row"><span>Current magnitude</span><strong>${d.accelMagnitude==null?'—':`${esc(d.accelMagnitude)} g`}</strong></div><div class="detail-row"><span>Temperature</span><strong>${d.temperature==null?'—':`${esc(d.temperature)} °C`}</strong></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="button" href="#emergency" data-navigate="emergency">Emergency center</a><a class="button" href="#history" data-navigate="history">Device history</a></div></div></div>`;
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
  if((m=line.match(/^SOS:\s*(.*)$/i))){d.sos=m[1];state.emergency=m[1].toUpperCase()==='ACTIVE'?{type:'ESP32 SOS',source:'Device safety logic',time:new Date()}:null;}
  if((m=line.match(/^Fall detection:\s*(.*)$/i)))d.fallDetection=m[1];
  if((m=line.match(/^Freefall detected:\s*(.*)$/i)))d.freeFall=m[1];
  if((m=line.match(/^Cancel hold:\s*(.*)$/i)))d.cancelHold=m[1];
  if(line.includes('[ SYSTEM STATUS ]'))d.inSystemStatus=true;
  if(d.inSystemStatus&&/^=+/.test(line)){d.inSystemStatus=false;d.updatedAt=Date.now();state.readingHistory.push({...d,time:d.updatedAt,logs:undefined});if(state.readingHistory.length>2000)state.readingHistory.shift();persistLocalState();applySosVisual();if(state.page==='location'&&document.querySelector('#osm-location-map'))updateLocationValues();else render({preserveInputs:true});}
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
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action, button.dataset.id)));
  document.querySelectorAll('[data-navigate]').forEach(a => a.addEventListener('click', event => { event.preventDefault(); location.hash = a.dataset.navigate; }));
  document.querySelectorAll('[data-range]').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b === btn)); state.chartRangeMins=Number(btn.dataset.range);drawChart(); }));
  document.querySelector('#contact-form')?.addEventListener('submit', addContact);
  document.querySelector('#settings-form')?.addEventListener('submit', saveSettings);
  document.querySelector('#history-search')?.addEventListener('input', updateDeviceHistoryRows);
  document.querySelector('#history-filter')?.addEventListener('change', updateDeviceHistoryRows);
}
function action(name, id) {
  if (name === 'sos') {
    if (!state.demoAllowed || !state.demo) { toast('Demo SOS is unavailable while live mode is selected.', 'error'); return; }
    const dialog = document.querySelector('#confirm-dialog');
    document.querySelector('#dialog-title').textContent = 'Trigger a demo SOS?';
    document.querySelector('#dialog-copy').textContent = 'This creates a local demo event only. No calls or SMS messages will be sent.';
    const confirm = document.querySelector('#dialog-confirm'); confirm.textContent = 'Trigger demo SOS';
    confirm.classList.remove('button-primary'); confirm.classList.add('button-danger');
    confirm.onclick = () => { state.emergency = { type: 'Manual SOS', source: 'Demo touch sensor', time: new Date() }; logEvent('Demo SOS triggered', 'Local preview · no notifications sent', 'alert'); toast('Demo SOS created. No one was contacted.'); setTimeout(render, 0); };
    dialog.showModal(); return;
  }
  if (name === 'resolve-emergency') {
    if (!state.emergency) return;
    const dialog = document.querySelector('#confirm-dialog'); document.querySelector('#dialog-title').textContent = 'Resolve this demo event?'; document.querySelector('#dialog-copy').textContent = 'The event will be marked resolved in this page preview. No external alerts are affected.';
    const confirm = document.querySelector('#dialog-confirm'); confirm.textContent = 'Resolve demo event'; confirm.classList.add('button-primary');
    confirm.onclick = () => { logEvent('Demo emergency resolved', 'Resolved in local preview', 'alert'); state.emergency = null; toast('Demo event resolved.'); setTimeout(render, 0); };
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
  if (name === 'email-emergency') {const emails=state.contacts.filter(c=>c.email).sort((a,b)=>Number(b.primary)-Number(a.primary)).map(c=>c.email);if(!emails.length){toast('Add an emergency contact with an email address first.','error');return;}const gps=state.serial.latitude!=null?`\nGPS: https://www.openstreetmap.org/?mlat=${state.serial.latitude}&mlon=${state.serial.longitude}#map=16/${state.serial.latitude}/${state.serial.longitude}`:'';const body=`Safe Her reports SOS ACTIVE at ${new Date().toLocaleString()}.${gps}\n\nPlease check in now.`;location.href=`mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent('Safe Her emergency alert')}&body=${encodeURIComponent(body)}`;return;}
  if (name === 'contact-delete') { state.contacts = state.contacts.filter(c => c.id !== Number(id)); persistLocalState(); toast('Contact removed from this browser.'); render(); return; }
  if (name === 'contact-primary') { state.contacts.forEach(c => c.primary = c.id === Number(id)); persistLocalState(); render(); return; }
  if (name === 'theme-toggle') { setTheme(state.theme==='light'?'dark':'light'); render(); return; }
  if (name === 'usb-toggle') { void connectUsb(); return; }
  if (name === 'refresh-map') {if(state.locationMap&&state.serial.latitude!=null){const point=[Number(state.serial.latitude),Number(state.serial.longitude)];state.locationMap.setView(point,16);state.locationMarker?.setLatLng(point).openPopup();state.lastMapUpdatedAt=Date.now();state.lastMapCoords=point;}else toast('The ESP32 has not reported a GPS fix yet.','error');return;}
  if (name === 'clear-local-history') {if(confirm('Clear saved sensor history and the last device report from this browser?')){state.readingHistory=[];state.series=[];state.serial={logs:[],inSystemStatus:false};persistLocalState();toast('Local sensor history cleared.');render();}return;}
  if (name === 'export-csv') { exportCsv(); return; }
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
  const rows = [['timestamp','mpu_connected','accel_magnitude_g','latitude','longitude','satellites','touch','sos','buzzer','led'], ...state.readingHistory.map(r => [new Date(r.time).toISOString(),r.mpuConnected,r.accelMagnitude,r.latitude,r.longitude,r.satellites,r.touch,r.sos,r.buzzer,r.led])];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' })); link.download = 'safeher-device-history.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast('Saved device history exported as CSV.');
}
function updateHistoryRows() {
  const body = document.querySelector('.table-wrap tbody'); if (!body) return;
  const q = document.querySelector('#event-search').value.toLowerCase(), type = document.querySelector('#event-filter').value;
  const rows = state.events.filter(e => (type === 'all' || e.category === type) && `${e.type} ${e.detail}`.toLowerCase().includes(q));
  body.innerHTML = rows.map(e=>`<tr><td>${esc(e.type)}</td><td class="muted">${esc(e.detail)}</td><td><span class="badge ${e.category==='alert'?'danger':''}">${esc(e.category)}</span></td><td>${nowTime(e.time)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No events match these filters.</td></tr>';
}
function updateDeviceHistoryRows() {
  const body=document.querySelector('.table-wrap tbody');if(!body)return;
  state.historySearch=document.querySelector('#history-search')?.value||'';state.historyFilter=document.querySelector('#history-filter')?.value||'all';
  const q=state.historySearch.toLowerCase(),filter=state.historyFilter;
  const rows=state.readingHistory.slice().reverse().filter(r=>{
    const text=[r.time,r.mpuConnected,r.accelMagnitude,r.latitude,r.longitude,r.touch,r.sos,r.fallDetection,r.freeFall,r.buzzer,r.led].join(' ').toLowerCase();
    return (!q||text.includes(q))&&(filter==='all'||filter==='sos'&&r.sos==='ACTIVE'||filter==='gps'&&r.latitude!=null||filter==='fall'&&r.freeFall==='YES');
  });
  body.innerHTML=rows.map(r=>`<tr><td>${new Date(r.time).toLocaleString()}</td><td>${esc(r.mpuConnected??'—')}</td><td>${esc(r.accelMagnitude??'—')} g</td><td>${r.latitude==null?'No fix':`${esc(r.latitude)}, ${esc(r.longitude)}`}</td><td>${esc(r.touch||'—')}</td><td><span class="badge ${r.sos==='ACTIVE'?'danger':''}">${esc(r.sos||'—')}</span></td><td>${esc(r.buzzer||'—')} / ${esc(r.led||'—')}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No saved device reports match this filter.</td></tr>';
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
function navigate() { const page = location.hash.slice(1); state.page = renderers[page] ? page : 'overview'; render(); document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); }
window.addEventListener('hashchange', navigate);
window.addEventListener('resize', () => { drawChart(); drawFallChart(); });
document.querySelector('#menu-toggle').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#mobile-overlay').classList.add('show'); });
document.querySelector('#mobile-overlay').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); });
document.querySelector('#theme-toggle').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
document.querySelector('#usb-connect').addEventListener('click', () => void connectUsb());
document.querySelector('#notification-button').addEventListener('click', () => toast(state.emergency ? 'The ESP32 reports an active SOS.' : 'No active SOS reported by the ESP32.'));
setTheme(state.theme);
async function initialize() {
  restoreLocalState(); state.demo=false; state.authenticated=false; state.page=location.hash.slice(1)||'overview';
  render();
}
void initialize();
