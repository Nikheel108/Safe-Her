import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, store } from './storage.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const sessionDuration = 8 * 60 * 60;
const singleDeviceId = 'WSD_001';
const loginAttempts = new Map();
const sosNotificationResults = new Map();
const sosNotificationInFlight = new Map();
const activityLabels = new Set(['normal', 'walking', 'running', 'sudden_movement', 'potential_fall', 'confirmed_emergency']);
const deviceStatuses = {
  wifi_status: new Set(['connected', 'disconnected', 'unknown']),
  gsm_status: new Set(['registered', 'unregistered', 'active', 'unknown']),
  communication_method: new Set(['wifi', 'gsm', 'offline', 'unknown']),
  gps_status: new Set(['fix', 'no_fix', 'unknown']),
  mpu6050_status: new Set(['connected', 'disconnected', 'unknown']),
};

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
}
function fail(response, status, code, message) { sendJson(response, status, { error: { code, message } }); }
function readString(value, field, { min = 1, max = 120, optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw Object.assign(new Error(`${field} must be a string between ${min} and ${max} characters.`), { status: 400, code: 'invalid_field' });
  return value.trim();
}
function readFinite(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Object.assign(new Error(`${field} must be a number between ${min} and ${max}.`), { status: 400, code: 'invalid_field' });
  return value;
}
function readInteger(value, field, { min = 0, max = 1000, optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Object.assign(new Error(`${field} must be an integer between ${min} and ${max}.`), { status: 400, code: 'invalid_field' });
  return value;
}
function readTimestamp(value, field = 'timestamp') {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw Object.assign(new Error(`${field} must be an ISO 8601 timestamp with a timezone.`), { status: 400, code: 'invalid_timestamp' });
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch < Date.UTC(2000, 0, 1) || epoch > Date.now() + 5 * 60_000) throw Object.assign(new Error(`${field} is outside the accepted time range.`), { status: 400, code: 'invalid_timestamp' });
  return new Date(epoch).toISOString();
}
function readDeviceId(value) {
  const id = readString(value, 'device_id', { min: 3, max: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Object.assign(new Error('device_id may contain only letters, numbers, underscores, and hyphens.'), { status: 400, code: 'invalid_device_id' });
  if (id !== singleDeviceId) throw Object.assign(new Error(`This Safe Her server is configured for device ${singleDeviceId} only.`), { status: 403, code: 'device_not_allowed' });
  return id;
}
function secureCompare(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}
async function readJson(request, maxBytes = 32 * 1024) {
  if (!request.headers['content-type']?.toLowerCase().includes('application/json')) throw Object.assign(new Error('Content-Type must be application/json.'), { status: 415, code: 'unsupported_media_type' });
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'payload_too_large' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400, code: 'invalid_json' }); }
}
function cookieValue(request, name) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const entry of cookies) {
    const [key, ...parts] = entry.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}
function sessionToken(sessionId) { return createHmac('sha256', process.env.SESSION_SECRET).update(sessionId).digest('base64url'); }
async function dashboardSession(request) {
  const token = cookieValue(request, 'safeher_session');
  if (!token) return false;
  const [id, signature, extra] = token.split('.');
  if (!id || !signature || extra) return false;
  if (!secureCompare(signature, sessionToken(id))) return false;
  const session = await store.one('dashboard_sessions', { filters: { id } });
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    if (session) await store.remove('dashboard_sessions', { id });
    return false;
  }
  return id;
}
async function requireDashboardSession(request, response) {
  // Single-device local installation: dashboard routes are intentionally open on the local server.
  return true;
}
function requireDeviceKey(request, response) {
  // Ingestion is open on this local server; readDeviceId restricts it to WSD_001.
  return true;
}
function sameOriginIfProvided(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  let parsed;
  try { parsed = new URL(origin); } catch { throw Object.assign(new Error('Invalid Origin header.'), { status: 403, code: 'origin_denied' }); }
  if (parsed.host !== host) throw Object.assign(new Error('Cross-origin dashboard requests are not allowed.'), { status: 403, code: 'origin_denied' });
}
async function ensureDevice(deviceId, firmwareVersion = null, observedAt = new Date().toISOString()) {
  const device = { id: deviceId, name: 'Ananya', last_seen_at: observedAt };
  if (firmwareVersion) device.firmware_version = firmwareVersion;
  await store.upsert('devices', device, 'id');
}
async function logSystem(deviceId, category, eventType, detail, observedAt) {
  await store.insert('system_logs', { device_id: deviceId, category, event_type: eventType, detail: detail ?? '', observed_at: observedAt ?? new Date().toISOString() });
}
function clampLimit(value, fallback = 100, maximum = 1000) {
  if (value === null || value === '') return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw Object.assign(new Error('limit must be a positive integer.'), { status: 400, code: 'invalid_limit' });
  return Math.min(limit, maximum);
}
function normalizeIndianPhone(value) {
  const digits = String(value ?? '').replace(/[\s()-]/g, '');
  const number = digits.startsWith('+91') ? digits.slice(3) : digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(number)) throw Object.assign(new Error('phone must be a valid Indian mobile number.'), { status: 400, code: 'invalid_phone' });
  return `+91${number}`;
}
function mapContact(row) {
  return { id: row.id, name: row.name, phone: row.phone, relationship: row.relationship, priority: row.priority, active: Boolean(row.active), primary: Boolean(row.is_primary), created_at: row.created_at, updated_at: row.updated_at };
}
function setCookie(response, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('set-cookie', `safeher_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
}
function clearCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('set-cookie', `safeher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
function eventId() { return randomBytes(16).toString('hex'); }
function validateAlertRecipients(value, field, pattern) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 10).filter(item => typeof item === 'string' && item.length <= 254 && pattern.test(item)).map(item => item.trim()))];
}
async function sendEmergencyEmail(payload) {
  const recipients=payload.emails;
  if(!recipients.length)return {status:'no_recipients',detail:'No emergency email addresses are saved.'};
  if(!process.env.EMERGENCY_WEBHOOK_URL||!process.env.EMERGENCY_WEBHOOK_SECRET)return {status:'not_configured',detail:'Configure the Google Apps Script webhook in the server .env.'};
  let webhook;
  try{webhook=new URL(process.env.EMERGENCY_WEBHOOK_URL);}catch{return {status:'failed',detail:'The configured webhook URL is invalid.'};}
  if(webhook.protocol!=='https:')return {status:'failed',detail:'The emergency webhook must use HTTPS.'};
  try{
    const response=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,secret:process.env.EMERGENCY_WEBHOOK_SECRET}),signal:AbortSignal.timeout(20_000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.ok!==true||data?.email?.status!=='accepted')return {status:'failed',detail:data?.error||`Webhook returned HTTP ${response.status}.`};
    return {status:'accepted',detail:'Google Apps Script accepted the email request.'};
  }catch(error){return {status:'failed',detail:error.name==='TimeoutError'?'Email webhook timed out.':`Email webhook failed: ${error.message}`};}
}
async function sendEmergencySms(payload) {
  const {TWILIO_ACCOUNT_SID:sid,TWILIO_AUTH_TOKEN:token,TWILIO_FROM_NUMBER:from}=process.env;
  if(!sid&&!token&&!from)return {status:'not_configured',detail:'Set up an SMS provider in .env to send SMS alerts.'};
  if(!sid||!token||!from)return {status:'not_configured',detail:'Twilio setup is incomplete; provide SID, auth token, and sending number.'};
  if(!payload.phones.length)return {status:'no_recipients',detail:'No emergency phone numbers are saved.'};
  const results=await Promise.all(payload.phones.map(async to=>{
    try{
      const form=new URLSearchParams({To:to,From:from,Body:payload.smsText});
      const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15_000)});
      const data=await response.json().catch(()=>null);
      return response.ok?{to,status:'accepted',sid:data?.sid??null}:{to,status:'failed',detail:data?.message||`Twilio returned HTTP ${response.status}.`};
    }catch(error){return {to,status:'failed',detail:error.name==='TimeoutError'?'SMS request timed out.':`SMS request failed: ${error.message}`};}
  }));
  const accepted=results.filter(item=>item.status==='accepted').length;
  return {status:accepted===results.length?'accepted':accepted?'partial':'failed',detail:`SMS provider accepted ${accepted} of ${results.length} message(s).`,results};
}

function payloadSafety(body,key){return body.safety?.[key]??'Not reported';}
function payloadSensor(body,key){return body.sensor?.[key]??'Not reported';}
async function api(request, response, url) {
  const method = request.method ?? 'GET';
  const path = url.pathname;

  if(method==='POST'&&path==='/api/notifications/sos'){
    sameOriginIfProvided(request);
    const body=await readJson(request,16*1024);
    const id=readString(body.event_id,'event_id',{min:8,max:80});
    if(!/^[A-Za-z0-9_-]+$/.test(id))throw Object.assign(new Error('event_id has an invalid format.'),{status:400,code:'invalid_event_id'});
    if(sosNotificationResults.has(id)){sendJson(response,200,{...sosNotificationResults.get(id),duplicate:true});return;}
    if(sosNotificationInFlight.has(id)){const prior=await sosNotificationInFlight.get(id);sendJson(response,200,{...prior,duplicate:true});return;}
    const lat=readFinite(body.latitude,'latitude',{min:-90,max:90,optional:true});
    const lon=readFinite(body.longitude,'longitude',{min:-180,max:180,optional:true});
    if((lat===null)!==(lon===null))throw Object.assign(new Error('latitude and longitude must be provided together.'),{status:400,code:'incomplete_location'});
    const emails=validateAlertRecipients(body.emails,'emails',/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    const phones=validateAlertRecipients(body.phones,'phones',/^\+[1-9]\d{7,14}$/);
    const coords=lat===null?'GPS fix unavailable':`${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const mapsUrl=lat===null?'':`\nMap: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    const occurredAt=readTimestamp(body.occurred_at,'occurred_at');
    const smsText=`SAFE HER SOS: Ananya's device activated at ${occurredAt}. Location: ${coords}.${lat===null?'':` https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`} Please check on Ananya.`.slice(0,1500);
    const payload={event_id:id,device_id:'WSD_001',occurred_at:occurredAt,emails,phones,latitude:lat,longitude:lon,location_text:coords,map_url:lat===null?'':`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,sensor:body.sensor&&typeof body.sensor==='object'?body.sensor:{},safety:body.safety&&typeof body.safety==='object'?body.safety:{},email_subject:'🚨 SAFE HER SOS ALERT',email_text:`SAFE HER EMERGENCY ALERT\n\nSOS has been activated on Ananya's device.\nTime: ${occurredAt}\nLocation: ${coords}${mapsUrl}\n\nTouch: ${String(payloadSafety(body,'touch'))}\nFall detection: ${String(payloadSafety(body,'fallDetection'))}\nFreefall: ${String(payloadSafety(body,'freeFall'))}\nAcceleration: ${String(payloadSensor(body,'accelMagnitude'))} g\nTemperature: ${String(payloadSensor(body,'temperature'))} °C\n\nPlease contact Ananya and follow your emergency plan.`};
    const delivery=Promise.all([sendEmergencyEmail(payload),sendEmergencySms({...payload,smsText})]).then(([email,sms])=>({event_id:id,email,sms}));
    sosNotificationInFlight.set(id,delivery);
    try{const result=await delivery;sosNotificationResults.set(id,result);if(sosNotificationResults.size>500)sosNotificationResults.delete(sosNotificationResults.keys().next().value);sendJson(response,200,result);}finally{sosNotificationInFlight.delete(id);}
    return;
  }

  if (method === 'GET' && path === '/api/config') {
    sendJson(response, 200, {
      demo_enabled: process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false',
      dashboard_auth_configured: true,
      device_ingestion_configured: true,
      storage: store.mode,
    });
    return;
  }
  if (method === 'GET' && path === '/api/auth/status') {
    sendJson(response, 200, { authenticated: true, auth_configured: true });
    return;
  }
  if (method === 'POST' && path === '/api/auth/login') {
    if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return fail(response, 503, 'dashboard_auth_not_configured', 'Dashboard access is disabled until ADMIN_PASSWORD and SESSION_SECRET are configured.');
    sameOriginIfProvided(request);
    const ip = request.socket.remoteAddress ?? 'unknown'; const now = Date.now(); const attempts = loginAttempts.get(ip);
    if (attempts && attempts.resetAt > now && attempts.count >= 10) return fail(response, 429, 'login_rate_limited', 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const body = await readJson(request, 4 * 1024);
    const password = readString(body.password, 'password', { min: 1, max: 256 });
    if (!secureCompare(password, process.env.ADMIN_PASSWORD)) {
      const next = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 15 * 60_000 };
      next.count += 1; loginAttempts.set(ip, next);
      return fail(response, 401, 'invalid_credentials', 'Password did not match.');
    }
    loginAttempts.delete(ip);
    const id = randomBytes(24).toString('base64url'); const expiresAt = Math.floor(Date.now() / 1000) + sessionDuration;
    await store.remove('dashboard_sessions', { expires_at: ['lte', Math.floor(Date.now() / 1000)] });
    await store.insert('dashboard_sessions', { id, expires_at: expiresAt });
    setCookie(response, `${id}.${sessionToken(id)}`, sessionDuration);
    sendJson(response, 200, { authenticated: true, expires_at: new Date(expiresAt * 1000).toISOString() });
    return;
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    sameOriginIfProvided(request);
    const id = process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET ? await dashboardSession(request) : false;
    if (id) await store.remove('dashboard_sessions', { id });
    clearCookie(response); sendJson(response, 200, { authenticated: false }); return;
  }

  if (['/api/device/sensor-data','/api/device/gps','/api/device/emergency','/api/device/emergency/cancel','/api/device/heartbeat','/api/device/notification-status'].includes(path)) {
    if (method !== 'POST') return fail(response, 405, 'method_not_allowed', 'Use POST for device ingestion endpoints.');
    if (!requireDeviceKey(request, response)) return;
    const body = await readJson(request);
    const deviceId = readDeviceId(body.device_id);

    if (path === '/api/device/sensor-data') {
      const timestamp = readTimestamp(body.timestamp);
      if (!body.sensor || typeof body.sensor !== 'object' || Array.isArray(body.sensor)) throw Object.assign(new Error('sensor must be an object containing all six MPU6050 axes.'), { status: 400, code: 'invalid_sensor' });
      const sensor = {
        accel_x: readFinite(body.sensor.accel_x, 'sensor.accel_x', { min: -64, max: 64 }),
        accel_y: readFinite(body.sensor.accel_y, 'sensor.accel_y', { min: -64, max: 64 }),
        accel_z: readFinite(body.sensor.accel_z, 'sensor.accel_z', { min: -64, max: 64 }),
        gyro_x: readFinite(body.sensor.gyro_x, 'sensor.gyro_x', { min: -4000, max: 4000 }),
        gyro_y: readFinite(body.sensor.gyro_y, 'sensor.gyro_y', { min: -4000, max: 4000 }),
        gyro_z: readFinite(body.sensor.gyro_z, 'sensor.gyro_z', { min: -4000, max: 4000 }),
      };
      let prediction = null;
      if (body.activity !== undefined) {
        if (!body.activity || typeof body.activity !== 'object' || !activityLabels.has(body.activity.label)) throw Object.assign(new Error('activity.label must be one of the documented classification labels.'), { status: 400, code: 'invalid_activity' });
        prediction = { label: body.activity.label, confidence: readFinite(body.activity.confidence, 'activity.confidence', { min: 0, max: 1 }) };
      }
      await ensureDevice(deviceId, null, timestamp);
      const result = await store.insert('sensor_readings', { device_id: deviceId, observed_at: timestamp, ...sensor });
      if (prediction) await store.insert('activity_predictions', { device_id: deviceId, observed_at: timestamp, label: prediction.label, confidence: prediction.confidence, source: 'device' });
      await logSystem(deviceId, 'sensor', 'sensor_reading_received', 'MPU6050 sample received from device.', timestamp);
      sendJson(response, 201, { accepted: true, reading_id: result.id, observed_at: timestamp }); return;
    }

    if (path === '/api/device/gps') {
      const timestamp = readTimestamp(body.timestamp);
      const latitude = readFinite(body.latitude, 'latitude', { min: -90, max: 90 });
      const longitude = readFinite(body.longitude, 'longitude', { min: -180, max: 180 });
      const accuracy = readFinite(body.accuracy_m, 'accuracy_m', { min: 0, max: 100_000, optional: true });
      const satellites = readInteger(body.satellites, 'satellites', { min: 0, max: 128, optional: true });
      await ensureDevice(deviceId, null, timestamp);
      const result = await store.insert('gps_locations', { device_id: deviceId, observed_at: timestamp, latitude, longitude, accuracy_m: accuracy, satellites });
      await logSystem(deviceId, 'location', 'gps_location_received', 'GPS coordinates received from device.', timestamp);
      sendJson(response, 201, { accepted: true, location_id: result.id, observed_at: timestamp }); return;
    }

    if (path === '/api/device/emergency') {
      const timestamp = readTimestamp(body.timestamp);
      const type = readString(body.event_type, 'event_type', { min: 1, max: 32 });
      if (!['manual_sos', 'automatic_fall'].includes(type)) throw Object.assign(new Error('event_type must be manual_sos or automatic_fall.'), { status: 400, code: 'invalid_event_type' });
      const source = readString(body.trigger_source, 'trigger_source', { min: 1, max: 40 });
      if (!['touch_sensor', 'fall_detection', 'other'].includes(source)) throw Object.assign(new Error('trigger_source must be touch_sensor, fall_detection, or other.'), { status: 400, code: 'invalid_trigger_source' });
      const hasLat = body.latitude !== undefined && body.latitude !== null; const hasLon = body.longitude !== undefined && body.longitude !== null;
      if (hasLat !== hasLon) throw Object.assign(new Error('latitude and longitude must be provided together.'), { status: 400, code: 'incomplete_location' });
      const latitude = hasLat ? readFinite(body.latitude, 'latitude', { min: -90, max: 90 }) : null;
      const longitude = hasLon ? readFinite(body.longitude, 'longitude', { min: -180, max: 180 }) : null;
      const label = body.activity_label === undefined ? null : readString(body.activity_label, 'activity_label', { min: 1, max: 32 });
      const id = eventId(); await ensureDevice(deviceId, null, timestamp);
      await store.insert('emergency_events', { id, device_id: deviceId, event_type: type, trigger_source: source, observed_at: timestamp, latitude, longitude, activity_label: label, alert_status: 'queued', resolution_status: 'active' });
      await logSystem(deviceId, 'emergency', 'emergency_event_received', `${type} event received; notification delivery is unconfirmed.`, timestamp);
      sendJson(response, 201, { accepted: true, event_id: id, alert_status: 'queued', resolution_status: 'active' }); return;
    }

    if (path === '/api/device/emergency/cancel') {
      const timestamp = readTimestamp(body.timestamp);
      const active = await store.one('emergency_events', { filters: { device_id: deviceId, resolution_status: 'active' }, order: [['observed_at','desc']] });
      if (!active) { sendJson(response, 200, { accepted: true, resolved: false, reason: 'no_active_event' }); return; }
      await store.update('emergency_events', { id: active.id, resolution_status: 'active' }, { resolution_status: 'resolved', resolved_at: timestamp });
      await logSystem(deviceId, 'emergency', 'emergency_cancelled_on_device', 'SOS was cancelled on the device.', timestamp);
      sendJson(response, 200, { accepted: true, resolved: true, event_id: active.id }); return;
    }

    if (path === '/api/device/heartbeat') {
      const timestamp = readTimestamp(body.timestamp);
      const firmware = readString(body.firmware_version, 'firmware_version', { min: 1, max: 64, optional: true });
      const fields = {};
      for (const [field, allowed] of Object.entries(deviceStatuses)) {
        const value = body[field] ?? 'unknown';
        if (!allowed.has(value)) throw Object.assign(new Error(`${field} has an unsupported value.`), { status: 400, code: 'invalid_device_status' });
        fields[field] = value;
      }
      fields.gsm_signal = readInteger(body.gsm_signal, 'gsm_signal', { min: 0, max: 31, optional: true });
      fields.battery_percent = readInteger(body.battery_percent, 'battery_percent', { min: 0, max: 100, optional: true });
      fields.battery_voltage = readFinite(body.battery_voltage, 'battery_voltage', { min: 0, max: 30, optional: true });
      for (const field of ['touch_active', 'buzzer_active', 'red_led_active']) {
        if (body[field] !== undefined && typeof body[field] !== 'boolean') throw Object.assign(new Error(`${field} must be a boolean.`), { status: 400, code: 'invalid_device_status' });
        fields[field] = body[field] === undefined ? null : body[field];
      }
      await ensureDevice(deviceId, firmware, timestamp);
      await store.upsert('device_status', { device_id: deviceId, heartbeat_at: timestamp, ...fields }, 'device_id');
      await logSystem(deviceId, 'device', 'heartbeat_received', `Heartbeat received via ${fields.communication_method}.`, timestamp);
      sendJson(response, 200, { accepted: true, device_id: deviceId, heartbeat_at: timestamp }); return;
    }

    if (path === '/api/device/notification-status') {
      const timestamp = readTimestamp(body.timestamp);
      const emergencyId = readString(body.event_id, 'event_id', { min: 8, max: 64 });
      const channel = readString(body.channel, 'channel', { min: 1, max: 16 });
      if (!['wifi','gsm','sms','call','unknown'].includes(channel)) throw Object.assign(new Error('channel is unsupported.'), { status: 400, code: 'invalid_channel' });
      const status = readString(body.status, 'status', { min: 1, max: 16 });
      if (!['queued','sent','delivered','failed','unknown'].includes(status)) throw Object.assign(new Error('status is unsupported.'), { status: 400, code: 'invalid_delivery_status' });
      const event = await store.one('emergency_events', { filters: { id: emergencyId, device_id: deviceId }, select: 'id' });
      if (!event) throw Object.assign(new Error('Emergency event was not found for this device.'), { status: 404, code: 'event_not_found' });
      const recipientRef = readString(body.recipient_ref, 'recipient_ref', { min: 1, max: 80, optional: true });
      const providerRef = readString(body.provider_ref, 'provider_ref', { min: 1, max: 120, optional: true });
      await store.insert('notification_logs', { event_id: emergencyId, channel, status, recipient_ref: recipientRef, provider_ref: providerRef, observed_at: timestamp });
      if (['queued','sent','delivered','failed'].includes(status)) await store.update('emergency_events', { id: emergencyId }, { alert_status: status });
      await logSystem(deviceId, 'notification', 'notification_status_received', `Device reported ${status} via ${channel}.`, timestamp);
      sendJson(response, 201, { accepted: true, event_id: emergencyId, status, observed_at: timestamp }); return;
    }
    return fail(response, 404, 'device_endpoint_not_found', 'Device endpoint was not found.');
  }

  if (path.startsWith('/api/')) {
    if (!await requireDashboardSession(request, response)) return;
    if (['POST','PUT','PATCH','DELETE'].includes(method)) sameOriginIfProvided(request);

    if (method === 'GET' && path === '/api/dashboard/overview') {
      const deviceId = url.searchParams.get('device_id');
      const device = await store.one('devices', { filters: { id: deviceId ? readDeviceId(deviceId) : singleDeviceId } });
      if (!device) { sendJson(response, 200, { device: null, status: null, latest_sensor: null, latest_location: null, latest_activity: null, active_emergency: null }); return; }
      const id = device.id;
      sendJson(response, 200, {
        device,
        status: await store.one('device_status', { filters: { device_id: id } }),
        latest_sensor: await store.one('sensor_readings', { filters: { device_id: id }, order: [['observed_at','desc'],['id','desc']] }),
        latest_location: await store.one('gps_locations', { filters: { device_id: id }, order: [['observed_at','desc'],['id','desc']] }),
        latest_activity: await store.one('activity_predictions', { filters: { device_id: id }, order: [['observed_at','desc'],['id','desc']] }),
        active_emergency: await store.one('emergency_events', { filters: { device_id: id, resolution_status: 'active' }, order: [['observed_at','desc']] }),
      }); return;
    }
    if (method === 'GET' && path === '/api/device/status') {
      const deviceId = url.searchParams.get('device_id');
      const device = await store.one('devices', { filters: { id: deviceId ? readDeviceId(deviceId) : singleDeviceId } });
      const status = device ? await store.one('device_status', { filters: { device_id: device.id } }) : null;
      sendJson(response, 200, device ? { ...device, ...status } : null); return;
    }
    if (method === 'GET' && path === '/api/dashboard/sensor-history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const deviceId = url.searchParams.get('device_id');
      const rows = await store.many('sensor_readings', { filters: { device_id: deviceId ? readDeviceId(deviceId) : singleDeviceId }, order: [['observed_at','desc'],['id','desc']], limit });
      sendJson(response, 200, { readings: rows.reverse() }); return;
    }
    if (method === 'GET' && path === '/api/dashboard/location-history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const deviceId = url.searchParams.get('device_id');
      const rows = await store.many('gps_locations', { filters: { device_id: deviceId ? readDeviceId(deviceId) : singleDeviceId }, order: [['observed_at','desc'],['id','desc']], limit });
      sendJson(response, 200, { locations: rows.reverse() }); return;
    }
    if (method === 'GET' && path === '/api/emergency/events') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 500); const status = url.searchParams.get('status');
      if (status && !['active','resolved'].includes(status)) throw Object.assign(new Error('status must be active or resolved.'), { status: 400, code: 'invalid_status' });
      const rows = await store.many('emergency_events', { filters: { device_id: singleDeviceId, ...(status ? { resolution_status: status } : {}) }, order: [['observed_at','desc']], limit });
      const events = await Promise.all(rows.map(async row => ({ ...row, notifications: await store.many('notification_logs', { filters: { event_id: row.id }, order: [['observed_at','asc']] }) })));
      sendJson(response, 200, { events }); return;
    }
    if (method === 'GET' && path === '/api/events/history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const category = url.searchParams.get('category'); const q = url.searchParams.get('q')?.slice(0, 100);
      const rows = await store.many('system_logs', { filters: { device_id: singleDeviceId, ...(category ? { category } : {}) }, order: [['observed_at','desc']], limit: q ? 1000 : limit });
      const events = q ? rows.filter(row => row.event_type.includes(q) || row.detail.includes(q)).slice(0, limit) : rows;
      sendJson(response, 200, { events }); return;
    }
    if (path === '/api/emergency/contacts' && method === 'GET') {
      const contacts = (await store.many('emergency_contacts', { order: [['priority','asc'],['id','asc']] })).map(mapContact); sendJson(response, 200, { contacts }); return;
    }
    if (path === '/api/emergency/contacts' && method === 'POST') {
      const body = await readJson(request, 8 * 1024);
      const name = readString(body.name, 'name', { min: 1, max: 80 }); const phone = normalizeIndianPhone(body.phone);
      const relationship = readString(body.relationship ?? '', 'relationship', { min: 0, max: 40 });
      const priority = readInteger(body.priority, 'priority', { min: 1, max: 20 }); const active = body.active === undefined ? true : body.active;
      const primary = body.primary === undefined ? false : body.primary;
      if (typeof active !== 'boolean' || typeof primary !== 'boolean') throw Object.assign(new Error('active and primary must be booleans.'), { status: 400, code: 'invalid_contact' });
      const id = randomBytes(12).toString('hex');
      const saved = await store.rpc('save_emergency_contact', { p_id: id, p_name: name, p_phone: phone, p_relationship: relationship, p_priority: priority, p_active: active, p_primary: primary, p_update: false });
      const contact = mapContact(saved);
      sendJson(response, 201, { contact }); return;
    }
    const contactMatch = path.match(/^\/api\/emergency\/contacts\/([a-f0-9]{24})$/);
    if (contactMatch && ['PUT','DELETE'].includes(method)) {
      const id = contactMatch[1]; const existing = await store.one('emergency_contacts', { filters: { id } });
      if (!existing) return fail(response, 404, 'contact_not_found', 'Contact was not found.');
      if (method === 'DELETE') { await store.remove('emergency_contacts', { id }); sendJson(response, 200, { deleted: true, id }); return; }
      const body = await readJson(request, 8 * 1024);
      const name = body.name === undefined ? existing.name : readString(body.name,'name',{min:1,max:80});
      const phone = body.phone === undefined ? existing.phone : normalizeIndianPhone(body.phone);
      const relationship = body.relationship === undefined ? existing.relationship : readString(body.relationship,'relationship',{min:0,max:40});
      const priority = body.priority === undefined ? existing.priority : readInteger(body.priority,'priority',{min:1,max:20});
      const active = body.active === undefined ? Boolean(existing.active) : body.active;
      const primary = body.primary === undefined ? Boolean(existing.is_primary) : body.primary;
      if (typeof active !== 'boolean' || typeof primary !== 'boolean') throw Object.assign(new Error('active and primary must be booleans.'), { status: 400, code: 'invalid_contact' });
      const saved = await store.rpc('save_emergency_contact', { p_id: id, p_name: name, p_phone: phone, p_relationship: relationship, p_priority: priority, p_active: active, p_primary: primary, p_update: true });
      sendJson(response, 200, { contact: mapContact(saved) }); return;
    }
    const emergencyAction = path.match(/^\/api\/emergency\/events\/([a-f0-9]{32})\/(acknowledge|resolve)$/);
    if (emergencyAction && method === 'POST') {
      const [, id, action] = emergencyAction; const timestamp = new Date().toISOString();
      const activeEvent = await store.one('emergency_events', { filters: { id, resolution_status: 'active' } });
      if (!activeEvent) return fail(response, 404, 'active_event_not_found', 'Active emergency event was not found.');
      const result = await store.update('emergency_events', { id, resolution_status: 'active' }, action === 'acknowledge' ? { acknowledged_at: activeEvent.acknowledged_at ?? timestamp } : { resolution_status: 'resolved', resolved_at: timestamp });
      if (!result.changes) return fail(response, 404, 'active_event_not_found', 'Active emergency event was not found.');
      const event = await store.one('emergency_events', { filters: { id } });
      await logSystem(event.device_id,'emergency',action === 'acknowledge' ? 'emergency_acknowledged' : 'emergency_resolved',action === 'acknowledge' ? 'Emergency acknowledged in dashboard.' : 'Emergency resolved in dashboard.',timestamp);
      sendJson(response, 200, { event }); return;
    }
    return fail(response, 404, 'route_not_found', 'API route was not found.');
  }

  return false;
}

async function handle(request, response) {
  response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { return fail(response, 400, 'invalid_url', 'Request URL is invalid.'); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(request, response, url);
    if (url.pathname === '/health' && request.method === 'GET') {
      const storage = await store.health(); sendJson(response, 200, { status: 'ok', storage, mode: process.env.NODE_ENV === 'production' ? 'production' : 'development' }); return;
    }
    if (!['GET','HEAD'].includes(request.method ?? 'GET')) return fail(response, 405, 'method_not_allowed', 'Static assets only accept GET or HEAD.');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return fail(response, 400, 'invalid_path', 'Request path encoding is invalid.'); }
    const asset = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = resolve(root, asset); const rel = relative(root, target);
    if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(target) === resolve(root)) return fail(response, 403, 'forbidden_path', 'Asset path is not allowed.');
    try {
      const body = await readFile(target);
      const extension = extname(target);
      const revalidate = ['.html', '.js', '.css'].includes(extension);
      response.writeHead(200, { 'content-type': mimeTypes[extension] ?? 'application/octet-stream', 'cache-control': revalidate ? 'no-cache' : 'public, max-age=300' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { fail(response, 404, 'not_found', 'Asset was not found.'); }
  } catch (error) {
    if (error?.status) return fail(response, error.status, error.code ?? 'request_failed', error.message);
    if (error?.code === 'SQLITE_CONSTRAINT_CHECK' || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(response, 400, 'constraint_violation', 'The requested data violates a database constraint.');
    console.error('Request failed:', error?.message ?? error);
    fail(response, 500, 'internal_error', 'The request could not be completed.');
  }
}

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const server = createServer((request,response) => void handle(request,response));
server.listen(port,host,() => console.log(`Safe Her API listening on http://${host}:${port}`));
function shutdown() { server.close(async () => { await closeDatabase(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
