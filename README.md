# SAFENET — Women Safety IoT Dashboard

Responsive monitoring dashboard with a Node.js HTTP API, authenticated ESP32 ingestion, and SQLite storage. The visual dashboard follows the supplied Figma Make design.

## Requirements and local setup

- Node.js 24 or newer (uses the built-in `node:sqlite` module).
- Copy `.env.example` to `.env`, then replace the example secrets with private values.
- Start the app with `npm run dev` and open [http://localhost:4173](http://localhost:4173).
- The local SQLite database is created at `data/safe-her.sqlite` by default; set `DATABASE_PATH` to change it.

The development server enables demo mode by default. Set `DEMO_MODE=false` to turn it off. Demo mode is always disabled when `NODE_ENV=production`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Password for the dashboard sign-in API. Use a unique, strong secret. |
| `SESSION_SECRET` | At least 32 random bytes (base64url is convenient) used to sign HttpOnly dashboard sessions. |
| `DEVICE_API_KEY` | Secret sent by the ESP32 in the `X-Device-Key` header. |
| `DATABASE_PATH` | Optional SQLite file path. Defaults to `./data/safe-her.sqlite`. |
| `HOST` | Bind address. Defaults to `0.0.0.0` so a device on the LAN can reach the API. |
| `PORT` | HTTP port. Defaults to `4173`. |
| `NODE_ENV` | Set to `production` in production; this disables demo mode and enables secure cookies. |
| `DEMO_MODE` | Set to `false` to disable the development simulator. Production mode disables it regardless. |

Generate secrets locally; never commit `.env` or put device/admin secrets in browser code. Expose the HTTP service to an ESP32 only on a trusted network behind TLS or a TLS reverse proxy.

## API and ESP32 setup

The device sends sensor, GPS, heartbeat, emergency, and notification-status payloads to authenticated `/api/device/*` endpoints. Dashboard reads and contact management require the session authentication API. See [ESP32 API documentation](docs/esp32-api.md) for payloads, status semantics, and example requests.

The database schema is initialized automatically and includes devices, sensor readings, GPS points, activity predictions, emergency events, contacts, notification delivery logs, device status, system logs, and dashboard sessions. A device key is required to ingest telemetry. Dashboard credentials are required to read precise locations and private contacts.

## Safety and delivery semantics

- Demo sensor values, coordinates, contacts, and events are development-only and session-local. They are removed from the UI when demo mode is disabled.
- The site does not run the ML model. Activity labels/confidence are stored as predictions supplied by the ESP32 or inference service.
- Emergency alerts begin as `queued`. The backend does not send SMS or make calls. Only a later device/network delivery report can move an alert to `sent`, `delivered`, or `failed`.
- Wi-Fi/GSM fallback is performed by ESP32 firmware. The web backend records the reported communication method and does not infer GSM availability.
- Contact APIs and private location/history APIs require a dashboard session. Contact records are never returned by a public endpoint.

## Checks

Run `npm test` for the API integration checks and `node --check server.mjs && node --check db.mjs && node --check public/app.js` for syntax checks.

## Current implementation boundary

This phase provides the backend API, SQLite persistence, ingestion authentication, and API documentation. The static UI still uses its development demo workflow; connecting its live mode and login screen to the new APIs is the next local implementation phase.
