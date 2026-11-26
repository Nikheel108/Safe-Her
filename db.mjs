import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const defaultPath = resolve(projectRoot, 'data', 'safe-her.sqlite');
const databasePath = process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : defaultPath;
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Safety wearable',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at TEXT,
    firmware_version TEXT
  );
  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    accel_x REAL NOT NULL, accel_y REAL NOT NULL, accel_z REAL NOT NULL,
    gyro_x REAL NOT NULL, gyro_y REAL NOT NULL, gyro_z REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sensor_readings_device_time ON sensor_readings(device_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS gps_locations (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
    accuracy_m REAL,
    satellites INTEGER
  );
  CREATE INDEX IF NOT EXISTS gps_locations_device_time ON gps_locations(device_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS activity_predictions (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    label TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
    source TEXT NOT NULL DEFAULT 'device'
  );
  CREATE INDEX IF NOT EXISTS activity_predictions_device_time ON activity_predictions(device_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS emergency_events (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    activity_label TEXT,
    alert_status TEXT NOT NULL DEFAULT 'queued' CHECK(alert_status IN ('queued','sent','delivered','failed','unknown')),
    resolution_status TEXT NOT NULL DEFAULT 'active' CHECK(resolution_status IN ('active','resolved')),
    acknowledged_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
  );
  CREATE INDEX IF NOT EXISTS emergency_events_device_time ON emergency_events(device_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS emergency_contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    phone TEXT NOT NULL,
    relationship TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 20),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_primary_contact ON emergency_contacts(is_primary) WHERE is_primary = 1;
  CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES emergency_events(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK(channel IN ('wifi','gsm','sms','call','unknown')),
    status TEXT NOT NULL CHECK(status IN ('queued','sent','delivered','failed','unknown','acknowledged')),
    recipient_ref TEXT,
    provider_ref TEXT,
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS notification_logs_event_time ON notification_logs(event_id, observed_at DESC);
  CREATE TABLE IF NOT EXISTS device_status (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    heartbeat_at TEXT NOT NULL,
    wifi_status TEXT NOT NULL DEFAULT 'unknown' CHECK(wifi_status IN ('connected','disconnected','unknown')),
    gsm_status TEXT NOT NULL DEFAULT 'unknown' CHECK(gsm_status IN ('registered','unregistered','active','unknown')),
    communication_method TEXT NOT NULL DEFAULT 'unknown' CHECK(communication_method IN ('wifi','gsm','offline','unknown')),
    gps_status TEXT NOT NULL DEFAULT 'unknown' CHECK(gps_status IN ('fix','no_fix','unknown')),
    mpu6050_status TEXT NOT NULL DEFAULT 'unknown' CHECK(mpu6050_status IN ('connected','disconnected','unknown')),
    gsm_signal INTEGER CHECK(gsm_signal BETWEEN 0 AND 31),
    battery_percent INTEGER CHECK(battery_percent BETWEEN 0 AND 100),
    battery_voltage REAL CHECK(battery_voltage BETWEEN 0 AND 30),
    touch_active INTEGER CHECK(touch_active IN (0,1)),
    buzzer_active INTEGER CHECK(buzzer_active IN (0,1)),
    red_led_active INTEGER CHECK(red_led_active IN (0,1))
  );
  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS system_logs_time ON system_logs(observed_at DESC);
  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

export function closeDatabase() {
  db.close();
}
