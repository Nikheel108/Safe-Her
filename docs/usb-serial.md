# Safe Her USB serial dashboard

The dashboard reads the ESP32 directly over USB using the browser's Web Serial API. It does not call the Safe Her API or Supabase for device readings.

## Start the dashboard

1. In a terminal opened in the project folder, run `npm run dev`.
2. Open `http://localhost:4173` in Chrome or Edge.
3. Close Arduino IDE's Serial Monitor and Serial Plotter. Only one application can own the ESP32 serial port at a time.
4. Click **Connect ESP32 USB**, select the ESP32's COM port, and approve access.

The sketch and dashboard both use **115200 baud**. The dashboard updates after each complete status report printed by the sketch (about every two seconds).

## Manual SOS control

In Emergency Center, connect the ESP32 over USB and use **Activate SOS manually** or **Turn SOS off**. Confirm the action in the prompt. The dashboard sends `S` to activate SOS or `R` to stop it; it updates the displayed state only after the ESP32 reports the new `SOS:` status. Activating SOS runs the sketch's normal alarm and notification flow. Upload the current `firmware/WomenSafetyESP32.ino` sketch to the board before using this control. The existing touch sensor remains available to activate/cancel SOS.

## Displayed readings

The page shows MPU connection and identity, accelerometer axes and magnitude, gyroscope axes, temperature, GPS satellite count and HDOP, coordinates and location age, altitude, speed, GPS time, touch state, buzzer and LED state, SOS state, fall detection, freefall, and cancel-hold progress.

GPS fields stay unavailable until the ESP32 reports a fix. The Location tab shows an interactive OpenStreetMap at that reported position (map tiles and coordinates are requested from OpenStreetMap). Sensor status reports, a bounded history, and editable emergency contacts (including email addresses) are saved to this browser's local storage. When configured, SOS email is submitted to Google Apps Script and SMS to Twilio; the local serial page reports the provider result rather than claiming delivery. Disconnecting USB keeps the most recent saved readings visible; reconnecting starts live updates again. Data remains on this browser and is not sent to the project backend.

If the browser does not offer serial ports, use Chrome or Edge at `localhost`, make sure the board is connected and its USB driver is installed, and close Serial Monitor before trying again.

## SOS email and SMS alerts

When the serial stream changes to `SOS: ACTIVE`, the dashboard posts one alert to the local server. Configure [Google Apps Script email and optional Twilio SMS](emergency-notifications.md). Keep the dashboard open with the ESP32 connected; a browser-only USB reader cannot detect an SOS while it is closed or disconnected. The Emergency Center distinguishes provider acceptance from confirmed delivery.
