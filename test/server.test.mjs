import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const secret = 'test-dashboard-password-42';
const deviceKey = 'test-device-key-92';
const sessionSecret = 'a-test-session-secret-that-is-longer-than-32-bytes';
let child;
let baseUrl;
let cookie;
let storagePath;
let temporaryDirectory;

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function request(path, { method = 'GET', body, auth = true, device = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && cookie) headers.cookie = cookie;
  if (device) headers['x-device-key'] = deviceKey;
  if (['POST','PUT','PATCH','DELETE'].includes(method) && auth && cookie) headers.origin = baseUrl;
  return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

before(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'safe-her-api-'));
  storagePath = join(temporaryDirectory, 'test.sqlite');
  const port = await availablePort(); baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'development', DATABASE_PATH: storagePath, ADMIN_PASSWORD: secret, SESSION_SECRET: sessionSecret, DEVICE_API_KEY: deviceKey, DEMO_MODE: 'true' },
    stdio: ['ignore','ignore','pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited before starting: ${stderr}`);
    try { const response = await fetch(`${baseUrl}/health`); if (response.ok) { ready = true; break; } }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server did not start: ${stderr}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('protects dashboard data and device ingestion until authenticated', async () => {
  const config = await (await request('/api/config', { auth: false })).json();
  assert.equal(config.demo_enabled, true);
  assert.equal(config.dashboard_auth_configured, true);

  const unauthenticated = await request('/api/emergency/contacts', { auth: false });
  assert.equal(unauthenticated.status, 401);

  const badDeviceKey = await request('/api/device/heartbeat', { method: 'POST', auth: false, body: { device_id: 'WSD_001', timestamp: new Date().toISOString() } });
  assert.equal(badDeviceKey.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ password: secret }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().find(value => value.startsWith('safeher_session=')).split(';')[0];
  assert.ok(cookie);
  const auth = await (await request('/api/auth/status')).json();
  assert.equal(auth.authenticated, true);
});

test('validates and persists sensor, GPS, heartbeat, and prediction payloads', async () => {
  const timestamp = new Date().toISOString();
  const sensor = { device_id: 'WSD_001', timestamp, sensor: { accel_x: 0.12, accel_y: 0.34, accel_z: 0.98, gyro_x: 1.2, gyro_y: 0.5, gyro_z: 0.8 }, activity: { label: 'walking', confidence: 0.92 } };
  const invalid = await request('/api/device/sensor-data', { method: 'POST', auth: false, device: true, body: { ...sensor, sensor: { ...sensor.sensor, accel_x: 999 } } });
  assert.equal(invalid.status, 400);
  const sensorResponse = await request('/api/device/sensor-data', { method: 'POST', auth: false, device: true, body: sensor });
  assert.equal(sensorResponse.status, 201);
  assert.equal((await sensorResponse.json()).accepted, true);

  const gps = await request('/api/device/gps', { method: 'POST', auth: false, device: true, body: { device_id: 'WSD_001', timestamp, latitude: 12.9716, longitude: 77.5946, accuracy_m: 8, satellites: 7 } });
  assert.equal(gps.status, 201);
  const heartbeat = await request('/api/device/heartbeat', { method: 'POST', auth: false, device: true, body: { device_id: 'WSD_001', timestamp, firmware_version: '0.1.0', wifi_status: 'connected', gsm_status: 'registered', communication_method: 'wifi', gps_status: 'fix', mpu6050_status: 'connected', battery_percent: 82, touch_active: false, buzzer_active: false, red_led_active: false } });
  assert.equal(heartbeat.status, 200);

  const overview = await (await request('/api/dashboard/overview?device_id=WSD_001')).json();
  assert.equal(overview.latest_sensor.accel_x, 0.12);
  assert.equal(overview.latest_activity.confidence, 0.92);
  assert.equal(overview.latest_location.latitude, 12.9716);
  assert.equal(overview.status.communication_method, 'wifi');
  const history = await (await request('/api/dashboard/sensor-history?device_id=WSD_001&limit=5')).json();
  assert.equal(history.readings.length, 1);
});

test('stores SOS as queued, then records explicit device delivery reports', async () => {
  const timestamp = new Date().toISOString();
  const response = await request('/api/device/emergency', { method: 'POST', auth: false, device: true, body: { device_id: 'WSD_001', event_type: 'manual_sos', trigger_source: 'touch_sensor', latitude: 12.9716, longitude: 77.5946, timestamp } });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.alert_status, 'queued');

  const update = await request('/api/device/notification-status', { method: 'POST', auth: false, device: true, body: { device_id: 'WSD_001', event_id: created.event_id, channel: 'sms', status: 'sent', timestamp } });
  assert.equal(update.status, 201);
  const events = await (await request('/api/emergency/events?status=active')).json();
  assert.equal(events.events[0].alert_status, 'sent');
  assert.equal(events.events[0].notifications[0].status, 'sent');
  const resolved = await request(`/api/emergency/events/${created.event_id}/resolve`, { method: 'POST', body: {} });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).event.resolution_status, 'resolved');
});

test('keeps contacts private and enforces Indian mobile and primary-contact constraints', async () => {
  const first = await request('/api/emergency/contacts', { method: 'POST', body: { name: 'Primary', relationship: 'Family', phone: '+91 98765 43210', priority: 1, primary: true } });
  assert.equal(first.status, 201);
  const primary = (await first.json()).contact;
  assert.equal(primary.phone, '+919876543210');
  const second = await request('/api/emergency/contacts', { method: 'POST', body: { name: 'Secondary', relationship: 'Friend', phone: '98450 12345', priority: 2, primary: true } });
  assert.equal(second.status, 201);
  const contacts = await (await request('/api/emergency/contacts')).json();
  assert.equal(contacts.contacts.filter(contact => contact.primary).length, 1);
  assert.equal(contacts.contacts.find(contact => contact.id === primary.id).primary, false);
  const badPhone = await request('/api/emergency/contacts', { method: 'POST', body: { name: 'Invalid', phone: '1234', priority: 3 } });
  assert.equal(badPhone.status, 400);
  const stillPrivate = await request('/api/emergency/contacts', { auth: false });
  assert.equal(stillPrivate.status, 401);
});
