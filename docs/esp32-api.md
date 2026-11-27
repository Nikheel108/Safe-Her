# ESP32 API integration

This local single-device setup has no dashboard or device authentication. Every device request must use the configured device ID `WSD_001`; any other ID is rejected. Keep the server on a trusted private network and never expose this no-auth setup to the public internet.

All timestamps are ISO 8601 with an explicit timezone, preferably UTC (`Z`). The server stores the observation time separately from its receive time. IDs contain 3–64 letters, numbers, underscores, or hyphens.

## Sensor sample

`POST /api/device/sensor-data`

```json
{
  "device_id": "WSD_001",
  "timestamp": "2026-11-26T08:30:00.000Z",
  "sensor": {
    "accel_x": 0.12,
    "accel_y": 0.34,
    "accel_z": 0.98,
    "gyro_x": 1.2,
    "gyro_y": 0.5,
    "gyro_z": 0.8
  },
  "activity": { "label": "walking", "confidence": 0.92 }
}
```

All six axes are required. Accelerometer values are in `g` and constrained to ±64; gyroscope values are in degrees/second and constrained to ±4000. `activity` is optional. Accepted labels are `normal`, `walking`, `running`, `sudden_movement`, `potential_fall`, and `confirmed_emergency`. The dashboard stores supplied predictions but does not perform inference.

## GPS fix

`POST /api/device/gps`

```json
{
  "device_id": "WSD_001",
  "timestamp": "2026-11-26T08:30:05.000Z",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "accuracy_m": 8,
  "satellites": 7
}
```

Latitude and longitude are required. Accuracy and satellite count are optional. Location records are private and only available to an authenticated dashboard session.

## Emergency trigger

`POST /api/device/emergency`

```json
{
  "device_id": "WSD_001",
  "event_type": "manual_sos",
  "trigger_source": "touch_sensor",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "activity_label": "normal",
  "timestamp": "2026-11-26T08:30:10.000Z"
}
```

`event_type` is `manual_sos` or `automatic_fall`. `trigger_source` is `touch_sensor`, `fall_detection`, or `other`. Coordinates are optional but must be sent together. New events start with `alert_status: queued` and `resolution_status: active`; the backend does not send any alert.

The device can resolve the latest active event for itself after the wearer cancels the local SOS:

`POST /api/device/emergency/cancel` with `{ "device_id": "WSD_001", "timestamp": "2026-11-26T08:31:00.000Z" }`.

## Heartbeat

`POST /api/device/heartbeat`

```json
{
  "device_id": "WSD_001",
  "timestamp": "2026-11-26T08:30:15.000Z",
  "firmware_version": "0.1.0",
  "wifi_status": "connected",
  "gsm_status": "registered",
  "communication_method": "wifi",
  "gps_status": "fix",
  "mpu6050_status": "connected",
  "gsm_signal": 20,
  "battery_percent": 82,
  "battery_voltage": 3.9,
  "touch_active": false,
  "buzzer_active": false,
  "red_led_active": false
}
```

Status values may be `unknown` when telemetry is unavailable. `communication_method` is `wifi`, `gsm`, `offline`, or `unknown`. The backend records the device's report; it does not probe the physical modules.

## Notification delivery report

`POST /api/device/notification-status`

```json
{
  "device_id": "WSD_001",
  "event_id": "the-event-id-returned-by-the-emergency-endpoint",
  "channel": "sms",
  "status": "sent",
  "recipient_ref": "contact-1",
  "provider_ref": "modem-report-id",
  "timestamp": "2026-11-26T08:30:20.000Z"
}
```

`status` may be `queued`, `sent`, `delivered`, `failed`, or `unknown`. Report `delivered` only after a network delivery report confirms it. Issuing an AT command or queuing an SMS is not delivery confirmation. The device remains responsible for sending emergency SMS/calls through SIM800L when Wi-Fi is unavailable.

## Dashboard endpoints

These endpoints are open in the local single-device setup and return data only for `WSD_001`:

- `GET /api/auth/status` — session state.
- `GET /api/dashboard/overview?device_id=WSD_001` — device, latest sensor/GPS/activity, status, and active emergency.
- `GET /api/dashboard/sensor-history?device_id=WSD_001&limit=100` — recent MPU6050 readings.
- `GET /api/dashboard/location-history?device_id=WSD_001&limit=100` — recent GPS fixes.
- `GET /api/device/status?device_id=WSD_001` — reported heartbeat and module status.
- `GET /api/emergency/events?status=active&limit=100` — emergency events plus notification logs.
- `POST /api/emergency/events/:id/acknowledge` and `/resolve` — dashboard actions.
- `GET`, `POST`, `PUT`, and `DELETE /api/emergency/contacts` — private contact management.
- `GET /api/events/history?category=device&q=heartbeat&limit=100` — event log search.

## Response and error behavior

Successful ingestion returns HTTP 201 (or 200 for heartbeat) with an acknowledgement ID/time. Invalid JSON, missing fields, out-of-range values, and unknown IDs return structured JSON errors. Request bodies are limited to 32 KiB.

The dashboard reads the latest stored sensor sample, GPS fix, activity prediction, heartbeat, and emergency state from `/api/dashboard/overview`. It keeps displaying those stored values when a heartbeat becomes older than 45 seconds and marks the device offline. New uploads appear on the next dashboard refresh (about every 3 seconds). The firmware currently uploads sensor data every 2 seconds, GPS every 5 seconds when a recent fix is available, and heartbeat every 15 seconds. It does not buffer every sample during Wi-Fi outages; the database retains the last successfully uploaded values.

`firmware/WomenSafetyESP32.ino` is the integrated sketch based on the supplied code. Set its Wi-Fi SSID/password and API base URL. Its device ID is `WSD_001`. For local testing on a trusted private Wi-Fi network, use `http://<computer-LAN-IP>:4173`; the server must be running and Windows Firewall must allow port 4173 on the private network. Find the computer IPv4 address with `ipconfig`; do not use `localhost`, `127.0.0.1`, `0.0.0.0`, or the Supabase URL in the sketch. For internet deployments, use HTTPS with the server's trusted CA certificate and do not use `setInsecure()`. The sketch uses the ESP32 Arduino core's `WiFi`, `WiFiClientSecure`, `HTTPClient`, and FreeRTOS APIs plus the existing TinyGPS++ library.

Activity labels/confidence are not inferred by this sketch; it uploads raw MPU6050 axes. The server stores an activity prediction only when an inference source sends one. Fall detection and SOS activation remain in the firmware, and emergency events are uploaded separately.
