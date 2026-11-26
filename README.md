# SAFENET — Women Safety IoT Dashboard

A responsive dashboard foundation for the Women Safety IoT project. This first implementation follows the supplied Figma Make preview and includes an interactive, clearly labeled demo experience.

## Run locally

Requires Node.js 20 or newer. There are no package dependencies.

```sh
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The `/health` endpoint returns a small server status response.

## Included in this phase

- Responsive command-center navigation for overview, live monitoring, location, emergency center, activity, contacts, history, device management, and settings.
- Overview status cards, MPU6050 metric cards, motion chart, map preview, emergency state, and recent activity.
- Demo SOS flow with acknowledgement and resolution states. It only changes local page state and never sends a call or message.
- Demo/live view switch. Live mode shows explicit waiting and unavailable states; no device connection is claimed.
- Session-only contact form with Indian mobile-number validation, priority, and primary-contact controls.
- Event search/filter and CSV export for the current in-memory demo event list.
- Accessible modal confirmation, toast feedback, and a mobile navigation drawer.

## Important scope and safety notes

All sensor values, coordinates, device statuses, contacts, and generated events in demo mode are illustrative. Demo state exists only in the open page and resets on reload. The live-device view intentionally stays empty because this phase has no ESP32 API, inference service, database, or authentication. It does not claim to run machine learning, send emergency notifications, or detect GSM fallback. Contact and preference forms are not secure storage and must not be used for real personal data.

## Next implementation phase

Add authenticated device ingestion endpoints and durable storage, then connect live dashboard updates to validated device telemetry. Emergency notification delivery must be represented from confirmed device/network status and remain the ESP32 firmware's responsibility when Wi-Fi is unavailable.
