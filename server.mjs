import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from './db.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const sessionDuration = 8 * 60 * 60;
const loginAttempts = new Map();
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
function dashboardSession(request) {
  const token = cookieValue(request, 'safeher_session');
  if (!token) return false;
  const [id, signature, extra] = token.split('.');
  if (!id || !signature || extra) return false;
  if (!secureCompare(signature, sessionToken(id))) return false;
  const session = db.prepare('SELECT expires_at FROM dashboard_sessions WHERE id = ?').get(id);
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    if (session) db.prepare('DELETE FROM dashboard_sessions WHERE id = ?').run(id);
    return false;
  }
  return id;
}
function requireDashboardSession(request, response) {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    fail(response, 503, 'dashboard_auth_not_configured', 'Dashboard access is disabled until ADMIN_PASSWORD and SESSION_SECRET are configured.');
    return false;
  }
  if (!dashboardSession(request)) {
    fail(response, 401, 'authentication_required', 'Sign in to view dashboard data.');
    return false;
  }
  return true;
}
function requireDeviceKey(request, response) {
  if (!process.env.DEVICE_API_KEY) {
    fail(response, 503, 'device_auth_not_configured', 'Device ingestion is disabled until DEVICE_API_KEY is configured.');
    return false;
  }
  if (!secureCompare(request.headers['x-device-key'] ?? '', process.env.DEVICE_API_KEY)) {
    fail(response, 401, 'invalid_device_key', 'A valid X-Device-Key is required.');
    return false;
  }
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
function ensureDevice(deviceId, firmwareVersion = null, observedAt = new Date().toISOString()) {
  db.prepare(`INSERT INTO devices(id, firmware_version, last_seen_at) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, firmware_version=COALESCE(excluded.firmware_version, devices.firmware_version)`)
    .run(deviceId, firmwareVersion, observedAt);
}
function logSystem(deviceId, category, eventType, detail, observedAt) {
  db.prepare('INSERT INTO system_logs(device_id, category, event_type, detail, observed_at) VALUES(?,?,?,?,?)').run(deviceId, category, eventType, detail ?? '', observedAt ?? new Date().toISOString());
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

async function api(request, response, url) {
  const method = request.method ?? 'GET';
  const path = url.pathname;

  if (method === 'GET' && path === '/api/config') {
    sendJson(response, 200, {
      demo_enabled: process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false',
      dashboard_auth_configured: Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET),
      device_ingestion_configured: Boolean(process.env.DEVICE_API_KEY),
    });
    return;
  }
  if (method === 'GET' && path === '/api/auth/status') {
    const authenticated = Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET && dashboardSession(request));
    sendJson(response, 200, { authenticated, auth_configured: Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET) });
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
    db.prepare('DELETE FROM dashboard_sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO dashboard_sessions(id, expires_at) VALUES(?,?)').run(id, expiresAt);
    setCookie(response, `${id}.${sessionToken(id)}`, sessionDuration);
    sendJson(response, 200, { authenticated: true, expires_at: new Date(expiresAt * 1000).toISOString() });
    return;
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    sameOriginIfProvided(request);
    const id = process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET ? dashboardSession(request) : false;
    if (id) db.prepare('DELETE FROM dashboard_sessions WHERE id = ?').run(id);
    clearCookie(response); sendJson(response, 200, { authenticated: false }); return;
  }

  if (['/api/device/sensor-data','/api/device/gps','/api/device/emergency','/api/device/heartbeat','/api/device/notification-status'].includes(path)) {
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
      ensureDevice(deviceId, null, timestamp);
      const result = db.prepare(`INSERT INTO sensor_readings(device_id, observed_at, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z)
        VALUES(@device_id,@observed_at,@accel_x,@accel_y,@accel_z,@gyro_x,@gyro_y,@gyro_z)`).run({ device_id: deviceId, observed_at: timestamp, ...sensor });
      if (prediction) db.prepare('INSERT INTO activity_predictions(device_id, observed_at, label, confidence, source) VALUES(?,?,?,?,?)').run(deviceId, timestamp, prediction.label, prediction.confidence, 'device');
      logSystem(deviceId, 'sensor', 'sensor_reading_received', 'MPU6050 sample received from device.', timestamp);
      sendJson(response, 201, { accepted: true, reading_id: Number(result.lastInsertRowid), observed_at: timestamp }); return;
    }

    if (path === '/api/device/gps') {
      const timestamp = readTimestamp(body.timestamp);
      const latitude = readFinite(body.latitude, 'latitude', { min: -90, max: 90 });
      const longitude = readFinite(body.longitude, 'longitude', { min: -180, max: 180 });
      const accuracy = readFinite(body.accuracy_m, 'accuracy_m', { min: 0, max: 100_000, optional: true });
      const satellites = readInteger(body.satellites, 'satellites', { min: 0, max: 128, optional: true });
      ensureDevice(deviceId, null, timestamp);
      const result = db.prepare('INSERT INTO gps_locations(device_id,observed_at,latitude,longitude,accuracy_m,satellites) VALUES(?,?,?,?,?,?)').run(deviceId, timestamp, latitude, longitude, accuracy, satellites);
      logSystem(deviceId, 'location', 'gps_location_received', 'GPS coordinates received from device.', timestamp);
      sendJson(response, 201, { accepted: true, location_id: Number(result.lastInsertRowid), observed_at: timestamp }); return;
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
      const id = eventId(); ensureDevice(deviceId, null, timestamp);
      db.prepare(`INSERT INTO emergency_events(id,device_id,event_type,trigger_source,observed_at,latitude,longitude,activity_label,alert_status,resolution_status)
        VALUES(?,?,?,?,?,?,?,?, 'queued','active')`).run(id, deviceId, type, source, timestamp, latitude, longitude, label);
      logSystem(deviceId, 'emergency', 'emergency_event_received', `${type} event received; notification delivery is unconfirmed.`, timestamp);
      sendJson(response, 201, { accepted: true, event_id: id, alert_status: 'queued', resolution_status: 'active' }); return;
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
        fields[field] = body[field] === undefined ? null : Number(body[field]);
      }
      ensureDevice(deviceId, firmware, timestamp);
      db.prepare(`INSERT INTO device_status(device_id,heartbeat_at,wifi_status,gsm_status,communication_method,gps_status,mpu6050_status,gsm_signal,battery_percent,battery_voltage,touch_active,buzzer_active,red_led_active)
        VALUES(@device_id,@heartbeat_at,@wifi_status,@gsm_status,@communication_method,@gps_status,@mpu6050_status,@gsm_signal,@battery_percent,@battery_voltage,@touch_active,@buzzer_active,@red_led_active)
        ON CONFLICT(device_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,wifi_status=excluded.wifi_status,gsm_status=excluded.gsm_status,communication_method=excluded.communication_method,gps_status=excluded.gps_status,mpu6050_status=excluded.mpu6050_status,gsm_signal=excluded.gsm_signal,battery_percent=excluded.battery_percent,battery_voltage=excluded.battery_voltage,touch_active=excluded.touch_active,buzzer_active=excluded.buzzer_active,red_led_active=excluded.red_led_active`).run({ device_id: deviceId, heartbeat_at: timestamp, ...fields });
      logSystem(deviceId, 'device', 'heartbeat_received', `Heartbeat received via ${fields.communication_method}.`, timestamp);
      sendJson(response, 200, { accepted: true, device_id: deviceId, heartbeat_at: timestamp }); return;
    }

    if (path === '/api/device/notification-status') {
      const timestamp = readTimestamp(body.timestamp);
      const emergencyId = readString(body.event_id, 'event_id', { min: 8, max: 64 });
      const channel = readString(body.channel, 'channel', { min: 1, max: 16 });
      if (!['wifi','gsm','sms','call','unknown'].includes(channel)) throw Object.assign(new Error('channel is unsupported.'), { status: 400, code: 'invalid_channel' });
      const status = readString(body.status, 'status', { min: 1, max: 16 });
      if (!['queued','sent','delivered','failed','unknown'].includes(status)) throw Object.assign(new Error('status is unsupported.'), { status: 400, code: 'invalid_delivery_status' });
      const event = db.prepare('SELECT id FROM emergency_events WHERE id=? AND device_id=?').get(emergencyId, deviceId);
      if (!event) throw Object.assign(new Error('Emergency event was not found for this device.'), { status: 404, code: 'event_not_found' });
      const recipientRef = readString(body.recipient_ref, 'recipient_ref', { min: 1, max: 80, optional: true });
      const providerRef = readString(body.provider_ref, 'provider_ref', { min: 1, max: 120, optional: true });
      db.prepare('INSERT INTO notification_logs(event_id,channel,status,recipient_ref,provider_ref,observed_at) VALUES(?,?,?,?,?,?)').run(emergencyId, channel, status, recipientRef, providerRef, timestamp);
      if (['queued','sent','delivered','failed'].includes(status)) db.prepare('UPDATE emergency_events SET alert_status=? WHERE id=?').run(status, emergencyId);
      logSystem(deviceId, 'notification', 'notification_status_received', `Device reported ${status} via ${channel}.`, timestamp);
      sendJson(response, 201, { accepted: true, event_id: emergencyId, status, observed_at: timestamp }); return;
    }
    return fail(response, 404, 'device_endpoint_not_found', 'Device endpoint was not found.');
  }

  if (path.startsWith('/api/')) {
    if (!requireDashboardSession(request, response)) return;
    if (['POST','PUT','PATCH','DELETE'].includes(method)) sameOriginIfProvided(request);

    if (method === 'GET' && path === '/api/dashboard/overview') {
      const deviceId = url.searchParams.get('device_id');
      const device = deviceId ? db.prepare('SELECT * FROM devices WHERE id=?').get(readDeviceId(deviceId)) : db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC LIMIT 1').get();
      if (!device) { sendJson(response, 200, { device: null, status: null, latest_sensor: null, latest_location: null, latest_activity: null, active_emergency: null }); return; }
      const id = device.id;
      sendJson(response, 200, {
        device,
        status: db.prepare('SELECT * FROM device_status WHERE device_id=?').get(id) ?? null,
        latest_sensor: db.prepare('SELECT * FROM sensor_readings WHERE device_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(id) ?? null,
        latest_location: db.prepare('SELECT * FROM gps_locations WHERE device_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(id) ?? null,
        latest_activity: db.prepare('SELECT * FROM activity_predictions WHERE device_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(id) ?? null,
        active_emergency: db.prepare("SELECT * FROM emergency_events WHERE device_id=? AND resolution_status='active' ORDER BY observed_at DESC LIMIT 1").get(id) ?? null,
      }); return;
    }
    if (method === 'GET' && path === '/api/device/status') {
      const deviceId = url.searchParams.get('device_id');
      const status = deviceId ? db.prepare('SELECT d.id,d.name,d.last_seen_at,d.firmware_version,s.* FROM devices d LEFT JOIN device_status s ON s.device_id=d.id WHERE d.id=?').get(readDeviceId(deviceId)) : db.prepare('SELECT d.id,d.name,d.last_seen_at,d.firmware_version,s.* FROM devices d LEFT JOIN device_status s ON s.device_id=d.id ORDER BY d.last_seen_at DESC LIMIT 1').get();
      sendJson(response, 200, status ?? null); return;
    }
    if (method === 'GET' && path === '/api/dashboard/sensor-history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const deviceId = url.searchParams.get('device_id');
      const rows = deviceId ? db.prepare('SELECT * FROM sensor_readings WHERE device_id=? ORDER BY observed_at DESC,id DESC LIMIT ?').all(readDeviceId(deviceId), limit) : db.prepare('SELECT * FROM sensor_readings ORDER BY observed_at DESC,id DESC LIMIT ?').all(limit);
      sendJson(response, 200, { readings: rows.reverse() }); return;
    }
    if (method === 'GET' && path === '/api/dashboard/location-history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const deviceId = url.searchParams.get('device_id');
      const rows = deviceId ? db.prepare('SELECT * FROM gps_locations WHERE device_id=? ORDER BY observed_at DESC,id DESC LIMIT ?').all(readDeviceId(deviceId), limit) : db.prepare('SELECT * FROM gps_locations ORDER BY observed_at DESC,id DESC LIMIT ?').all(limit);
      sendJson(response, 200, { locations: rows.reverse() }); return;
    }
    if (method === 'GET' && path === '/api/emergency/events') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 500); const status = url.searchParams.get('status');
      if (status && !['active','resolved'].includes(status)) throw Object.assign(new Error('status must be active or resolved.'), { status: 400, code: 'invalid_status' });
      const rows = status ? db.prepare('SELECT * FROM emergency_events WHERE resolution_status=? ORDER BY observed_at DESC LIMIT ?').all(status, limit) : db.prepare('SELECT * FROM emergency_events ORDER BY observed_at DESC LIMIT ?').all(limit);
      const logQuery = db.prepare('SELECT * FROM notification_logs WHERE event_id=? ORDER BY observed_at');
      sendJson(response, 200, { events: rows.map(row => ({ ...row, notifications: logQuery.all(row.id) })) }); return;
    }
    if (method === 'GET' && path === '/api/events/history') {
      const limit = clampLimit(url.searchParams.get('limit'), 100, 1000); const category = url.searchParams.get('category'); const q = url.searchParams.get('q')?.slice(0, 100);
      const rows = db.prepare(`SELECT * FROM system_logs WHERE (? IS NULL OR category=?) AND (? IS NULL OR event_type LIKE '%'||?||'%' OR detail LIKE '%'||?||'%') ORDER BY observed_at DESC LIMIT ?`).all(category, category, q || null, q || null, q || null, limit);
      sendJson(response, 200, { events: rows }); return;
    }
    if (path === '/api/emergency/contacts' && method === 'GET') {
      const contacts = db.prepare('SELECT * FROM emergency_contacts ORDER BY priority,id').all().map(mapContact); sendJson(response, 200, { contacts }); return;
    }
    if (path === '/api/emergency/contacts' && method === 'POST') {
      const body = await readJson(request, 8 * 1024);
      const name = readString(body.name, 'name', { min: 1, max: 80 }); const phone = normalizeIndianPhone(body.phone);
      const relationship = readString(body.relationship ?? '', 'relationship', { min: 0, max: 40 });
      const priority = readInteger(body.priority, 'priority', { min: 1, max: 20 }); const active = body.active === undefined ? true : body.active;
      const primary = body.primary === undefined ? false : body.primary;
      if (typeof active !== 'boolean' || typeof primary !== 'boolean') throw Object.assign(new Error('active and primary must be booleans.'), { status: 400, code: 'invalid_contact' });
      const id = randomBytes(12).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (primary) db.prepare('UPDATE emergency_contacts SET is_primary=0').run();
        db.prepare('INSERT INTO emergency_contacts(id,name,phone,relationship,priority,active,is_primary) VALUES(?,?,?,?,?,?,?)').run(id,name,phone,relationship,priority,Number(active),Number(primary));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const contact = mapContact(db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(id));
      sendJson(response, 201, { contact }); return;
    }
    const contactMatch = path.match(/^\/api\/emergency\/contacts\/([a-f0-9]{24})$/);
    if (contactMatch && ['PUT','DELETE'].includes(method)) {
      const id = contactMatch[1]; const existing = db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(id);
      if (!existing) return fail(response, 404, 'contact_not_found', 'Contact was not found.');
      if (method === 'DELETE') { db.prepare('DELETE FROM emergency_contacts WHERE id=?').run(id); sendJson(response, 200, { deleted: true, id }); return; }
      const body = await readJson(request, 8 * 1024);
      const name = body.name === undefined ? existing.name : readString(body.name,'name',{min:1,max:80});
      const phone = body.phone === undefined ? existing.phone : normalizeIndianPhone(body.phone);
      const relationship = body.relationship === undefined ? existing.relationship : readString(body.relationship,'relationship',{min:0,max:40});
      const priority = body.priority === undefined ? existing.priority : readInteger(body.priority,'priority',{min:1,max:20});
      const active = body.active === undefined ? Boolean(existing.active) : body.active;
      const primary = body.primary === undefined ? Boolean(existing.is_primary) : body.primary;
      if (typeof active !== 'boolean' || typeof primary !== 'boolean') throw Object.assign(new Error('active and primary must be booleans.'), { status: 400, code: 'invalid_contact' });
      db.exec('BEGIN IMMEDIATE');
      try {
        if (primary) db.prepare('UPDATE emergency_contacts SET is_primary=0').run();
        db.prepare("UPDATE emergency_contacts SET name=?,phone=?,relationship=?,priority=?,active=?,is_primary=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(name,phone,relationship,priority,Number(active),Number(primary),id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      sendJson(response, 200, { contact: mapContact(db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(id)) }); return;
    }
    const emergencyAction = path.match(/^\/api\/emergency\/events\/([a-f0-9]{32})\/(acknowledge|resolve)$/);
    if (emergencyAction && method === 'POST') {
      const [, id, action] = emergencyAction; const timestamp = new Date().toISOString();
      const result = action === 'acknowledge'
        ? db.prepare('UPDATE emergency_events SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=? AND resolution_status=\'active\'').run(timestamp,id)
        : db.prepare("UPDATE emergency_events SET resolution_status='resolved',resolved_at=? WHERE id=? AND resolution_status='active'").run(timestamp,id);
      if (!result.changes) return fail(response, 404, 'active_event_not_found', 'Active emergency event was not found.');
      const event = db.prepare('SELECT * FROM emergency_events WHERE id=?').get(id); logSystem(event.device_id,'emergency',action === 'acknowledge' ? 'emergency_acknowledged' : 'emergency_resolved',action === 'acknowledge' ? 'Emergency acknowledged in dashboard.' : 'Emergency resolved in dashboard.',timestamp);
      sendJson(response, 200, { event }); return;
    }
    return fail(response, 404, 'route_not_found', 'API route was not found.');
  }

  return false;
}

async function handle(request, response) {
  response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('referrer-policy', 'no-referrer');
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { return fail(response, 400, 'invalid_url', 'Request URL is invalid.'); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(request, response, url);
    if (url.pathname === '/health' && request.method === 'GET') {
      db.prepare('SELECT 1').get(); sendJson(response, 200, { status: 'ok', storage: 'sqlite', mode: process.env.NODE_ENV === 'production' ? 'production' : 'development' }); return;
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
      response.writeHead(200, { 'content-type': mimeTypes[extname(target)] ?? 'application/octet-stream', 'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=300' });
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
const host = process.env.HOST ?? '0.0.0.0';
const server = createServer((request,response) => void handle(request,response));
server.listen(port,host,() => console.log(`Safe Her API listening on http://${host}:${port}`));
function shutdown() { server.close(() => { closeDatabase(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
