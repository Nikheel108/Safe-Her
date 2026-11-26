const content = document.querySelector('#content');
const state = {
  page: location.hash.slice(1) || 'overview',
  theme: 'light',
  demo: false,
  demoAllowed: false,
  emergency: null,
  activity: 'Walking',
  confidence: 0.94,
  coords: { lat: 12.9716, lon: 77.5946, accuracy: 8 },
  series: Array.from({ length: 34 }, (_, i) => ({ x: Math.sin(i * .43) * .22, y: Math.cos(i * .31) * .2, z: .94 + Math.sin(i * .35) * .08 })),
  events: [
    { type: 'Device connected', detail: 'ESP32 · WSD_001', time: new Date(Date.now() - 1000 * 15), category: 'device' },
    { type: 'Normal activity detected', detail: 'Walking · 94% confidence', time: new Date(Date.now() - 1000 * 31), category: 'activity' },
    { type: 'GPS location updated', detail: 'Accuracy ±8 meters', time: new Date(Date.now() - 1000 * 46), category: 'location' },
  ],
  contacts: [
    { id: 1, name: 'Primary contact', relationship: 'Family', phone: '+91 ••••• •• 2468', priority: 1, active: true, primary: true },
    { id: 2, name: 'Secondary contact', relationship: 'Friend', phone: '+91 ••••• •• 1357', priority: 2, active: true, primary: false },
  ],
};

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
function metricCards() {
  return sensorDefs.map(([name, value, unit, delta, tone], i) => `<article class="sensor-card"><div class="sensor-label">${name}</div><div class="sensor-value">${value} <em>${unit}</em></div><div class="sensor-foot"><span>● Demo stream</span><span>${delta}</span></div>${sparkline(tone === 'pink' ? '#ed78b2' : tone === 'green' ? '#43cf9b' : '#a18cff', i * .9)}</article>`).join('');
}
function statusCards() {
  const online = state.demo;
  const rows = [
    ['Device Status', online ? 'Online' : 'Awaiting device', online ? 'ESP32 · heartbeat 8s ago' : 'No live heartbeat received', icons.device, 'blue'],
    ['Activity Status', online ? state.activity : 'Unavailable', online ? `Incoming prediction · ${Math.round(state.confidence * 100)}%` : 'ML inference not connected', icons.activity, 'purple'],
    ['GPS Status', online ? 'Location available' : 'No GPS fix', online ? 'Updated just now' : 'Waiting for GPS coordinates', icons.location, 'pink'],
    ['Communication', online ? 'Wi-Fi active' : 'Unknown', online ? 'GSM fallback ready' : 'No device telemetry', icons.communication, 'green'],
  ];
  return rows.map(([title, value, sub, icon, color]) => `<article class="status-card"><div class="status-top"><span>${title}</span><span class="status-icon ${color}">${icon}</span></div><div class="status-main">${value}</div><div class="status-sub">${sub}<span class="status-live">${online ? 'Demo' : 'Waiting'}</span></div></article>`).join('');
}
function chartMarkup() {
  return `<div class="panel"><div class="panel-title-row"><div><div class="chart-heading">MOTION ACTIVITY</div><div class="chart-sub">MPU6050 · accelerometer readings in g</div></div><div class="range-group" role="group" aria-label="Chart time range"><button class="active" data-range="1">1 min</button><button data-range="5">5 min</button><button data-range="15">15 min</button></div></div><div class="chart-legend"><span><i class="legend-dot" style="background:#a18cff"></i>X-axis</span><span><i class="legend-dot" style="background:#ed78b2"></i>Y-axis</span><span><i class="legend-dot" style="background:#54cda2"></i>Z-axis</span><span style="margin-left:auto;color:#6fdbac">● Demo</span></div><canvas class="chart-canvas" id="motion-chart" aria-label="Illustrative accelerometer motion chart"></canvas><div class="chart-foot"><span>10:23:00</span><span>10:23:20</span><span>10:23:40</span><span>Now</span></div></div>`;
}
function mapSvg() {
  return `<svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid slice" aria-label="Illustrative Bengaluru street map"><rect width="420" height="220" fill="#17212b"/><path d="M-20 27 94 66l58-16 70 32 72-43 147 24M-15 180l118-56 68 15 81-44 183 48M75-15l18 88 54 30-12 127M260-10l-31 82 41 47-19 113M397-5l-48 78 34 65-14 98" fill="none" stroke="#293947" stroke-width="12"/><path d="M-18 27 94 66l58-16 70 32 72-43 147 24M-15 180l118-56 68 15 81-44 183 48M75-15l18 88 54 30-12 127M260-10l-31 82 41 47-19 113M397-5l-48 78 34 65-14 98" fill="none" stroke="#465460" stroke-width="1.4"/><path d="M-20 98 131 88l68 37 75-52 159 17M-10 149l124-46 93 74 112-53 120 20" fill="none" stroke="#33453e" stroke-width="5"/><path d="M-20 98 131 88l68 37 75-52 159 17M-10 149l124-46 93 74 112-53 120 20" fill="none" stroke="#6a8270" stroke-width="1"/><text x="36" y="52" fill="#bdc7c7" font-size="10">Vasant Nagar</text><text x="172" y="38" fill="#bdc7c7" font-size="9">Cubbon Road</text><text x="305" y="118" fill="#bdc7c7" font-size="10">MG Road</text><text x="120" y="194" fill="#93a19e" font-size="9">Residency Road</text><circle cx="236" cy="104" r="25" fill="#8d72ff" opacity=".13"/><circle cx="236" cy="104" r="13" fill="#8d72ff" opacity=".22"/></svg><div class="map-pin" aria-hidden="true"></div><div class="map-controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div><div class="map-caption"><div><strong>Current coordinates</strong><small>${state.demo ? coordsText() : 'Location unavailable'}</small></div><small>${state.demo ? `Accuracy ±${state.coords.accuracy} m` : 'Waiting for a device fix'}</small></div>`;
}
function activityRows(limit = 3) {
  return state.events.slice(0, limit).map(event => `<div class="activity-row"><span class="activity-icon">${event.category === 'alert' ? '!' : event.category === 'location' ? '◎' : event.category === 'activity' ? '⌁' : '▣'}</span><span class="activity-copy"><strong>${esc(event.type)}</strong><small>${esc(event.detail)}</small></span><time class="activity-time">${nowTime(event.time)}</time></div>`).join('') || '<div class="empty-state">No events recorded.</div>';
}
function overviewPage() {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour:'numeric', hour12:false, timeZone:'Asia/Kolkata' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="page-heading"><div><div class="eyebrow">SAFENET / COMMAND CENTER</div><h1>Overview</h1><p>Your connected safety device at a glance.</p></div><div class="heading-actions"><span class="demo-chip"><i></i>${state.demo ? 'Normal demo' : 'Live device mode'}</span><button class="button" data-action="toggle-mode">${state.demo ? 'Switch to live device' : 'Switch to demo'}</button></div></div><div class="hello-row"><div><h2>${greeting}, Ananya</h2><p>Monitor your safety device and stay informed.</p></div><div class="system-banner"><i></i>${state.emergency ? 'Emergency active — attention needed' : state.demo ? 'All demo systems operational' : 'Waiting for device connection'}</div></div><div class="status-grid">${statusCards()}</div><div class="section-row"><div class="section-header"><span class="section-title">LIVE SENSOR OVERVIEW</span><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : 'NO LIVE DATA'}</span><a class="footer-link" href="#live" data-navigate="live">View monitoring&nbsp; →</a></div><div class="sensor-grid">${state.demo ? metricCards() : '<div class="empty-state" style="grid-column:1/-1">Live sensor readings will appear when a device is connected.</div>'}</div></div><div class="section-row charts-grid">${state.demo ? chartMarkup() : '<div class="panel empty-state">Motion charts are unavailable until live sensor data arrives.</div>'}<div class="panel"><div class="panel-title-row"><div><div class="chart-heading">GPS LOCATION PREVIEW</div><div class="chart-sub">Most recent device location</div></div><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : 'NO GPS FIX'}</span></div><div class="map-preview">${state.demo ? mapSvg() : '<div class="empty-state">No GPS coordinates received yet.</div>'}</div></div></div><div class="section-row bottom-grid"><div class="panel emergency-panel"><div><div class="section-title">EMERGENCY STATUS</div><div class="safe-mark" style="margin-top:13px"><span class="safe-icon">${state.emergency ? '!' : '✓'}</span><span><strong>${state.emergency ? 'Emergency active' : state.demo ? 'Demo state: Safe' : 'Status unavailable'}</strong><small>${state.emergency ? `${state.emergency.type} · ${nowTime(state.emergency.time)}` : (state.demo ? 'No demo emergency is active.' : 'No device emergency status received.')}</small></span></div></div><button class="button ${state.emergency ? 'button-danger' : ''}" data-action="${state.emergency ? 'resolve-emergency' : 'sos'}">${state.emergency ? 'Resolve demo event' : 'Test demo SOS'}</button></div><div class="panel"><div class="section-header"><span class="section-title">RECENT ACTIVITY</span><span class="badge">DEMO EVENT LOG</span><a class="footer-link" href="#history" data-navigate="history">View all&nbsp; →</a></div><div class="activity-list">${activityRows(3)}</div></div></div>`;
}

function livePage() {
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / SENSOR STREAM</div><h1>Live Monitoring</h1><p>Motion data and device signals, refreshed every 3 seconds in demo mode.</p></div><div class="heading-actions"><span class="demo-chip"><i></i>${state.demo ? 'ILLUSTRATIVE DEMO DATA' : 'LIVE DEVICE MODE'}</span><button class="button ${state.emergency ? 'button-danger' : ''}" data-action="${state.emergency ? 'resolve-emergency' : 'sos'}">${state.emergency ? 'Resolve demo SOS' : 'Test demo SOS'}</button></div></div><div class="status-grid">${statusCards()}</div><div class="section-row"><div class="section-header"><span class="section-title">MPU6050 SENSOR READINGS</span><span class="section-meta">${state.demo ? 'Values below are illustrative only' : 'Waiting for the device to send telemetry'}</span></div><div class="sensor-grid">${state.demo ? metricCards() : '<div class="empty-state" style="grid-column:1/-1">No sensor readings have been received.</div>'}</div></div><div class="section-row charts-grid">${state.demo ? chartMarkup() : '<div class="panel empty-state">No accelerometer data yet.</div>'}<div class="panel"><div class="section-header"><span class="section-title">DEVICE SIGNALS</span><span class="badge">DEMO</span></div>${[['Touch sensor','Released'],['Buzzer','Off'],['Red LED','Off'],['GPS fix',state.demo?'Available':'Unavailable'],['ML prediction',state.demo?`${state.activity} · ${Math.round(state.confidence*100)}%`:'Not connected']].map(([a,b])=>`<div class="detail-row"><span>${a}</span><strong>${b}</strong></div>`).join('')}</div></div><div class="section-row panel"><div class="section-header"><span class="section-title">CLASSIFICATION</span><span class="badge success">${state.demo?'DEMO PREDICTION':'AWAITING DEVICE'}</span></div><div class="activity-big"><span class="status-icon purple">⌁</span><span><strong>${state.demo?esc(state.activity):'No prediction'}</strong><small>${state.demo?`Illustrative model confidence · ${Math.round(state.confidence*100)}% · Not an actual ML inference`:'Connect an inference source to show activity predictions.'}</small></span></div></div>`;
}
function locationPage() {
  return `<div class="page-heading"><div><div class="eyebrow">MONITORING / GPS</div><h1>Location Tracking</h1><p>Review the latest GPS fix reported by the safety device.</p></div><span class="demo-chip"><i></i>${state.demo?'ILLUSTRATIVE DEMO LOCATION':'NO LIVE LOCATION'}</span></div><div class="wide-grid"><div class="panel"><div class="section-header"><span class="section-title">CURRENT LOCATION</span><span class="badge ${state.demo?'success':''}">${state.demo?'GPS FIX':'UNAVAILABLE'}</span></div><div class="map-preview" style="min-height:350px">${state.demo?mapSvg():'<div class="empty-state">GPS coordinates are unavailable. The map will update when the device sends a valid fix.</div>'}</div><div class="detail-row"><span>Latitude / longitude</span><strong>${state.demo?coordsText():'Unavailable'}</strong></div><div class="detail-row"><span>Accuracy</span><strong>${state.demo?`±${state.coords.accuracy} m`:'Unavailable'}</strong></div><div class="detail-row"><span>Last updated</span><strong>${state.demo?'Just now':'No update received'}</strong></div>${state.demo?`<a class="button" style="display:inline-block;margin-top:12px;text-decoration:none" target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${state.coords.lat},${state.coords.lon}">Open in Google Maps ↗</a>`:''}</div><div class="card-stack"><div class="detail-card"><h3>Location details</h3><div class="detail-row"><span>Data source</span><strong>${state.demo?'Demonstration coordinates':'No device data'}</strong></div><div class="detail-row"><span>Coordinates</span><strong>${state.demo?coordsText():'—'}</strong></div><div class="detail-row"><span>Accuracy</span><strong>${state.demo?`±${state.coords.accuracy} meters`:'—'}</strong></div></div><div class="detail-card"><h3>Location history</h3>${state.demo?`<div class="activity-row"><span class="activity-icon">◎</span><span class="activity-copy"><strong>Vasant Nagar, Bengaluru</strong><small>${coordsText()}</small></span><time class="activity-time">Now</time></div>`:'<div class="empty-state">No location history received.</div>'}</div></div></div>`;
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
  const online = state.demo;
  return `<div class="page-heading"><div><div class="eyebrow">MANAGE / CONNECTED HARDWARE</div><h1>Device Management</h1><p>Hardware capabilities are shown as reported; unsupported telemetry stays unavailable.</p></div><span class="demo-chip"><i></i>${online?'ILLUSTRATIVE DEMO STATUS':'NO DEVICE CONNECTED'}</span></div><div class="wide-grid"><div class="card-stack">${[['ESP32 DevKit','WSD_001',online?'Online':'Offline','Wi-Fi connection',online?'Connected':'Unavailable','Firmware version','Not reported'],['SIM800L GSM','Emergency fallback',online?'Ready (demo)':'Unavailable','Network registration','Not reported','Signal strength','Not reported'],['NEO-6M GPS','Location module',online?'Fix available (demo)':'No fix','Latitude / longitude',online?coordsText():'Unavailable','Satellites','Not reported'],['MPU6050','Motion sensor',online?'Connected (demo)':'Unavailable','Last reading',online?'Illustrative only':'Unavailable','Sample interval','3 seconds (demo)']].map(([name,id,status,l1,v1,l2,v2])=>`<div class="detail-card"><div class="section-header"><h3 style="margin:0">${name}</h3><span class="badge ${online?'success':''}">${status}</span></div><div class="detail-row"><span>Module / ID</span><strong>${id}</strong></div><div class="detail-row"><span>${l1}</span><strong>${v1}</strong></div><div class="detail-row"><span>${l2}</span><strong>${v2}</strong></div></div>`).join('')}</div><div class="card-stack"><div class="detail-card"><h3>Device configuration</h3><div class="form-field"><label for="device-id">Device ID</label><input id="device-id" value="WSD_001" readonly /></div><div class="form-field" style="margin-top:10px"><label for="sensor-interval">Sensor update interval</label><select id="sensor-interval"><option>3 seconds</option><option>5 seconds</option><option>10 seconds</option></select></div><div class="form-field" style="margin-top:10px"><label for="gps-interval">GPS update interval</label><select id="gps-interval"><option>5 seconds</option><option>10 seconds</option><option>30 seconds</option></select></div><p class="field-help">Settings are a UI preview and are not sent to hardware.</p></div><div class="detail-card"><h3>Integration status</h3><div class="empty-state">No ESP32 integration endpoint is configured in this first dashboard phase.</div></div></div></div>`;
}
function settingsPage() {
  return `<div class="page-heading"><div><div class="eyebrow">MANAGE / PREFERENCES</div><h1>Settings</h1><p>Dashboard preferences and safety workflow configuration.</p></div><span class="demo-chip"><i></i>LOCAL PREVIEW</span></div><div class="wide-grid"><form class="panel" id="settings-form"><div class="section-header"><span class="section-title">SAFETY PREFERENCES</span></div><div class="form-field"><label for="helpline">Emergency helpline number</label><input id="helpline" name="helpline" inputmode="tel" placeholder="Enter a number" /><div class="field-help">This prototype does not place calls or send messages.</div></div><div class="form-field" style="margin-top:12px"><label for="update-interval">Sensor update interval</label><select id="update-interval" name="interval"><option>3 seconds</option><option>5 seconds</option><option>10 seconds</option></select></div><div class="toggle-row"><span><strong>Show demo sensor data</strong><small>Mark the dashboard as illustrative demo mode.</small></span><input class="switch" type="checkbox" name="demo" ${state.demo?'checked':''} /></div><div class="toggle-row"><span><strong>Activity notifications</strong><small>Preference preview only; no messages are sent.</small></span><input class="switch" type="checkbox" name="notifications" checked /></div><button class="button button-primary" type="submit">Save preferences</button></form><div class="card-stack"><div class="detail-card"><h3>Communication preference</h3><div class="detail-row"><span>Wi-Fi</span><strong>Preferred on ESP32</strong></div><div class="detail-row"><span>GSM fallback</span><strong>Handled by device firmware</strong></div><p class="field-help">The dashboard reports communication status from device telemetry. It does not detect GSM availability or perform message fallback.</p></div><div class="detail-card"><h3>Account</h3><div class="detail-row"><span>Profile</span><strong>Ananya Khadakabhavi</strong></div><div class="detail-row"><span>Role</span><strong>Administrator</strong></div><div class="detail-row"><span>Authentication</span><strong>Not connected</strong></div></div></div></div>`;
}
const renderers = { overview: overviewPage, live: livePage, location: locationPage, emergency: emergencyPage, activity: activityPage, contacts: contactsPage, history: historyPage, device: devicePage, settings: settingsPage };

function drawChart() {
  const canvas = document.querySelector('#motion-chart'); if (!canvas || !state.demo) return;
  const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height, pad = { left: 20, right: 8, top: 7, bottom: 13 };
  ctx.strokeStyle = state.theme === 'light' ? '#d8dfeb' : '#253043'; ctx.lineWidth = 1; ctx.font = '8px DM Sans'; ctx.fillStyle = state.theme === 'light' ? '#68758a' : '#78849a';
  for (let i = 0; i < 4; i++) { const y = pad.top + i * (h - pad.top - pad.bottom) / 3; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke(); ctx.fillText((1.5 - i).toFixed(1), 0, y + 3); }
  const colors = ['#a18cff', '#ed78b2', '#54cda2'];
  colors.forEach((color, line) => { ctx.beginPath(); state.series.forEach((point, i) => { const value = [point.x, point.y, point.z - .94][line]; const x = pad.left + i * (w - pad.left - pad.right) / (state.series.length - 1); const y = pad.top + (1 - (value + .35) / .7) * (h - pad.top - pad.bottom); if (!i) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke(); });
}
function render() {
  if (!renderers[state.page]) state.page = 'overview';
  content.innerHTML = renderers[state.page]();
  document.querySelector('#breadcrumb-current').textContent = pageNames[state.page];
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === state.page));
  const count = document.querySelector('#nav-emergency-count'); count.hidden = !state.emergency;
  document.querySelector('#top-date').textContent = fullDate(new Date());
  const connection = document.querySelector('.connection-pill');
  connection.classList.toggle('offline', !state.demo);
  connection.querySelector('span').textContent = state.demo ? 'Demo device online' : 'Device offline';
  drawChart(); bindPageActions();
}
function bindPageActions() {
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action, button.dataset.id)));
  document.querySelectorAll('[data-navigate]').forEach(a => a.addEventListener('click', event => { event.preventDefault(); location.hash = a.dataset.navigate; }));
  document.querySelectorAll('[data-range]').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b === btn)); toast(`Showing the last ${btn.dataset.range} minutes of illustrative demo data.`); }));
  document.querySelector('#contact-form')?.addEventListener('submit', addContact);
  document.querySelector('#settings-form')?.addEventListener('submit', saveSettings);
  document.querySelector('#event-search')?.addEventListener('input', updateHistoryRows);
  document.querySelector('#event-filter')?.addEventListener('change', updateHistoryRows);
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
    toast(state.demo ? 'Demo mode enabled. Readings are illustrative.' : 'Live mode selected. No device is connected.'); render(); return;
  }
  if (name === 'contact-delete') { state.contacts = state.contacts.filter(c => c.id !== Number(id)); toast('Demo contact removed.'); render(); return; }
  if (name === 'contact-primary') { state.contacts.forEach(c => c.primary = c.id === Number(id)); toast('Primary demo contact updated.'); render(); return; }
  if (name === 'export-csv') { exportCsv(); return; }
  if (name === 'help') { toast('Support resources will be available when account services are connected.'); return; }
}
function addContact(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget), phone = String(data.get('phone')).replace(/[\s()-]/g, '').replace(/^\+91/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) { toast('Enter a valid 10-digit Indian mobile number.', 'error'); document.querySelector('#contact-phone').focus(); return; }
  const contact = { id: Date.now(), name: String(data.get('name')).trim(), relationship: String(data.get('relationship')).trim(), phone: `+91 ${phone}`, priority: Number(data.get('priority')), active: true, primary: state.contacts.length === 0 };
  state.contacts.push(contact); toast('Demo contact added in this page session.'); render();
}
function saveSettings(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget); state.demo = state.demoAllowed && data.get('demo') === 'on';
  if (!state.demo) { state.events = []; state.contacts = []; state.emergency = null; }
  toast('Dashboard preferences updated for this session.'); render();
}
function exportCsv() {
  const rows = [['event','detail','category','timestamp'], ...state.events.map(e => [e.type,e.detail,e.category,e.time.toISOString()])];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' })); link.download = 'safeher-demo-events.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast('Demo event history exported as CSV.');
}
function updateHistoryRows() {
  const body = document.querySelector('.table-wrap tbody'); if (!body) return;
  const q = document.querySelector('#event-search').value.toLowerCase(), type = document.querySelector('#event-filter').value;
  const rows = state.events.filter(e => (type === 'all' || e.category === type) && `${e.type} ${e.detail}`.toLowerCase().includes(q));
  body.innerHTML = rows.map(e=>`<tr><td>${esc(e.type)}</td><td class="muted">${esc(e.detail)}</td><td><span class="badge ${e.category==='alert'?'danger':''}">${esc(e.category)}</span></td><td>${nowTime(e.time)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No events match these filters.</td></tr>';
}
function navigate() { const page = location.hash.slice(1); state.page = renderers[page] ? page : 'overview'; render(); document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); }
window.addEventListener('hashchange', navigate);
window.addEventListener('resize', drawChart);
document.querySelector('#menu-toggle').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#mobile-overlay').classList.add('show'); });
document.querySelector('#mobile-overlay').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#mobile-overlay').classList.remove('show'); });
document.querySelector('#notification-button').addEventListener('click', () => toast(state.emergency ? 'There is an active demo SOS event.' : 'No new notifications.'));
document.querySelector('#theme-toggle').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
setTheme(state.theme);
async function initialize() {
  try {
    const response = await fetch('/api/config', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('configuration unavailable');
    const config = await response.json();
    state.demoAllowed = config.demo_enabled === true;
    state.demo = state.demoAllowed;
    if (!state.demoAllowed) { state.events = []; state.contacts = []; }
  } catch {
    state.demoAllowed = false; state.demo = false; state.events = []; state.contacts = [];
  }
  render();
}
void initialize();
setInterval(() => {
  if (!state.demo) return;
  const t = Date.now() / 1000;
  state.series.push({ x: Math.sin(t * .7) * .22, y: Math.cos(t * .54) * .2, z: .94 + Math.sin(t * .4) * .08 });
  state.series.shift();
  if (state.page === 'overview' || state.page === 'live') drawChart();
}, 3000);
