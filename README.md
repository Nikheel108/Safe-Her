# Safe Her — Women Safety IoT Dashboard

Responsive Safe Her dashboard that reads ESP32 sensor output directly from a USB serial connection in the browser. The visual dashboard follows the supplied Figma Make design.

## Requirements and local setup

- Node.js 24 or newer (uses the built-in `node:sqlite` module).
- Start the app with `npm run dev` and open [http://localhost:4173](http://localhost:4173).
- Connect the ESP32 with USB, close Arduino Serial Monitor, then choose **Connect ESP32 USB** in Chrome or Edge.

The dashboard reads the sketch's 115200-baud serial output directly. Real sensor status reports and emergency contacts are saved in this browser's local storage. After USB disconnects, the last saved values remain visible; a new complete report refreshes them. No readings are sent to an API or database. `localhost` is used because browser USB serial access requires a secure browser context.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_PATH` | Optional SQLite file path. Defaults to `./data/safe-her.sqlite`. |
| `HOST` | Bind address. Defaults to `127.0.0.1` for local USB dashboard use. |
| `PORT` | HTTP port. Defaults to `4173`. |
| `NODE_ENV` | Set to `production` in production; this disables demo mode and enables secure cookies. |
| `DEMO_MODE` | Set to `false` to disable the development simulator. Production mode disables it regardless. |

## ESP32 USB setup

The integrated [ESP32 sketch](firmware/WomenSafetyESP32.ino) keeps its sensor, GPS, touch, buzzer, LED, and fall-detection logic and prints readings at 115200 baud. The dashboard parses those serial status blocks and displays MPU axes, magnitude, gyro, temperature, GPS, touch/output state, SOS, and fall-detection state. See [USB serial setup](docs/usb-serial.md).

## Safety and delivery semantics

- The dashboard does not generate sensor values or coordinates. Sensor readings and emergency contacts (including email addresses) are kept in this browser only; contacts can be edited, and email actions open a prefilled mail draft for manual sending. Clearing site data removes them. The Location tab shows an interactive OpenStreetMap and sends the current GPS coordinates to that map service to place its marker.
- The site does not run the ML model. Activity labels/confidence are stored as predictions supplied by the ESP32 or inference service.
- Emergency alerts begin as `queued`. The backend does not send SMS or make calls. Only a later device/network delivery report can move an alert to `sent`, `delivered`, or `failed`.
- Wi-Fi/GSM fallback is performed by ESP32 firmware. The web backend records the reported communication method and does not infer GSM availability.
- USB serial is a direct local connection; this mode does not transmit sensor or location readings over Wi-Fi or to Supabase.

## Checks

Run `npm test` for the API integration checks and `node --check server.mjs && node --check db.mjs && node --check public/app.js` for syntax checks.

The firmware's activity classification remains based on its built-in fall-detection logic; it does not run a machine-learning activity classifier.
