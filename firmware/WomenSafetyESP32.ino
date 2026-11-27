
#include <Wire.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <math.h>

// WOMEN SAFETY SYSTEM
// ESP32 DEVKIT V1
// MPU + GPS + TOUCH + BUZZER + LED
// GSM SIM800L NOT INCLUDED
// =====================================================

// ---------------- PIN CONFIGURATION ------------------

#define SDA_PIN       21
#define SCL_PIN       22

#define GPS_RX        16
#define GPS_TX        17

#define TOUCH_PIN     32
#define BUZZER_PIN    25
#define LED_PIN       18

// ---------------- MPU CONFIGURATION -----------------

#define MPU_ADDR      0x68

#define REG_SMPLRT_DIV   0x19
#define REG_CONFIG       0x1A
#define REG_GYRO_CONFIG  0x1B
#define REG_ACCEL_CONFIG 0x1C
#define REG_ACCEL_XOUT_H 0x3B
#define REG_PWR_MGMT_1   0x6B
#define REG_WHO_AM_I     0x75

// ±8g = 4096 LSB/g
// ±500 degrees/sec = 65.5 LSB/(degree/sec)

#define ACCEL_SCALE 4096.0
#define GYRO_SCALE  65.5

// ---------------- OBJECTS ----------------------------

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// ---------------- SYSTEM VARIABLES -------------------

bool sosActive = false;
bool alarmState = false;

bool touchWasHigh = false;
bool ignoreCurrentPressForCancel = false;
bool cancelTiming = false;

unsigned long cancelStartTime = 0;
unsigned long alarmPreviousMillis = 0;
unsigned long printPreviousMillis = 0;
unsigned long mpuPreviousMillis = 0;

const unsigned long CANCEL_HOLD_TIME = 3000;
const unsigned long ALARM_INTERVAL = 250;
const unsigned long PRINT_INTERVAL = 2000;
const unsigned long MPU_INTERVAL = 20;

// ---------------- MPU VARIABLES ----------------------

int16_t rawAX = 0;
int16_t rawAY = 0;
int16_t rawAZ = 0;

int16_t rawGX = 0;
int16_t rawGY = 0;
int16_t rawGZ = 0;

int16_t rawTemp = 0;

float accelX = 0;
float accelY = 0;
float accelZ = 0;

float gyroX = 0;
float gyroY = 0;
float gyroZ = 0;

float temperatureC = 0;
float accelerationMagnitude = 0;

bool mpuConnected = false;

uint8_t mpuIdentity = 0;

// ---------------- FALL DETECTION ---------------------

bool freeFallDetected = false;
unsigned long freeFallTime = 0;

const float FREEFALL_THRESHOLD = 0.65;
const float IMPACT_THRESHOLD = 2.5;

const unsigned long FALL_DETECTION_WINDOW = 1500;
// =====================================================
// I2C REGISTER FUNCTIONS
// =====================================================

bool writeMPURegister(uint8_t reg, uint8_t value) {

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);

  return Wire.endTransmission() == 0;
}

bool readMPURegister(uint8_t reg, uint8_t &value) {

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(MPU_ADDR, (uint8_t)1) != 1) {
    return false;
  }

  value = Wire.read();

  return true;
}

// =====================================================
// MPU INITIALIZATION
// =====================================================

bool initializeMPU() {

  Serial.println("\nInitializing MPU sensor...");

  if (!readMPURegister(REG_WHO_AM_I, mpuIdentity)) {
    Serial.println("MPU register communication failed!");
    return false;
  }

  Serial.print("WHO_AM_I: 0x");
  Serial.println(mpuIdentity, HEX);

  if (mpuIdentity == 0x68) {
    Serial.println("Standard MPU6050 identity detected.");
  }
  else if (mpuIdentity == 0x70) {
    Serial.println("Non-standard identity 0x70 detected.");
    Serial.println("Using compatible direct-register mode.");
  }
  else {
    Serial.println("Unknown sensor identity.");
    Serial.println("Testing register compatibility...");
  }

  // Wake up sensor
  if (!writeMPURegister(REG_PWR_MGMT_1, 0x00)) {
    Serial.println("MPU wake-up failed!");
    return false;
  }

  delay(100);

  // Sample rate divider
  writeMPURegister(REG_SMPLRT_DIV, 0x04);

  // Digital low pass filter
  writeMPURegister(REG_CONFIG, 0x03);

  // Gyroscope range: ±500 degrees/sec
  writeMPURegister(REG_GYRO_CONFIG, 0x08);

  // Accelerometer range: ±8g
  writeMPURegister(REG_ACCEL_CONFIG, 0x10);

  delay(100);

  Serial.println("MPU register configuration completed.");

  return true;
}

// =====================================================
// READ MPU SENSOR DATA
// =====================================================

bool readMPUData() {

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(MPU_ADDR, (uint8_t)14) != 14) {
    return false;
  }

  rawAX = (int16_t)((Wire.read() << 8) | Wire.read());
  rawAY = (int16_t)((Wire.read() << 8) | Wire.read());
  rawAZ = (int16_t)((Wire.read() << 8) | Wire.read());

  rawTemp = (int16_t)((Wire.read() << 8) | Wire.read());

  rawGX = (int16_t)((Wire.read() << 8) | Wire.read());
  rawGY = (int16_t)((Wire.read() << 8) | Wire.read());
  rawGZ = (int16_t)((Wire.read() << 8) | Wire.read());

  // Convert acceleration to g
  accelX = rawAX / ACCEL_SCALE;
  accelY = rawAY / ACCEL_SCALE;
  accelZ = rawAZ / ACCEL_SCALE;

  // Convert gyroscope to degrees/sec
  gyroX = rawGX / GYRO_SCALE;
  gyroY = rawGY / GYRO_SCALE;
  gyroZ = rawGZ / GYRO_SCALE;

  // Temperature conversion for MPU6050-compatible register map
  temperatureC = (rawTemp / 340.0) + 36.53;

  // Total acceleration magnitude
  accelerationMagnitude = sqrt(
    accelX * accelX +
    accelY * accelY +
    accelZ * accelZ
  );

  return true;
}

// =====================================================
// ACTIVATE SOS
// =====================================================

void activateSOS(String reason) {

  if (sosActive) return;

  sosActive = true;

  cancelTiming = false;

  Serial.println("\n================================");
  Serial.println("          SOS ACTIVATED");
  Serial.println("================================");

  Serial.print("Reason: ");
  Serial.println(reason);

  Serial.println("Buzzer and LED alarm enabled.");

  if (gps.location.isValid() &&
      gps.location.age() < 10000) {

    Serial.print("GPS: https://www.google.com/maps?q=");
    Serial.print(gps.location.lat(), 6);
    Serial.print(",");
    Serial.println(gps.location.lng(), 6);
  }
  else {
    Serial.println("GPS location not available yet.");
  }
}

// =====================================================
// STOP SOS
// =====================================================

void stopSOS() {

  sosActive = false;

  alarmState = false;
  cancelTiming = false;
  freeFallDetected = false;

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  Serial.println("\n================================");
  Serial.println("          SOS CANCELLED");
  Serial.println("================================");
}

// =====================================================
// TOUCH SENSOR CONTROL
// =====================================================

void handleTouchSensor() {

  bool touchNow = digitalRead(TOUCH_PIN);

  // New touch event
  if (touchNow && !touchWasHigh) {

    if (!sosActive) {

      // First touch activates SOS.
      activateSOS("MANUAL TOUCH");

      // Do not allow this same press to cancel SOS.
      ignoreCurrentPressForCancel = true;
    }

    else if (!ignoreCurrentPressForCancel) {

      cancelTiming = true;
      cancelStartTime = millis();

      Serial.println("Touch detected.");
      Serial.println("Hold for 3 seconds to cancel SOS.");
    }
  }

  // Release touch
  if (!touchNow && touchWasHigh) {

    if (ignoreCurrentPressForCancel) {
      ignoreCurrentPressForCancel = false;
    }

    if (cancelTiming) {
      cancelTiming = false;
      Serial.println("Cancellation hold interrupted.");
    }
  }

  // Check cancellation duration
  if (touchNow && sosActive && cancelTiming) {

    unsigned long heldTime = millis() - cancelStartTime;

    if (heldTime >= CANCEL_HOLD_TIME) {

      stopSOS();

      // Prevent the current press from activating SOS again.
      ignoreCurrentPressForCancel = true;
    }
  }

  touchWasHigh = touchNow;
}

// =====================================================
// FALL DETECTION
// =====================================================

void detectFall() {

  if (!mpuConnected || sosActive) return;

  unsigned long now = millis();

  // Detect possible freefall
  if (accelerationMagnitude < FREEFALL_THRESHOLD) {

    freeFallDetected = true;
    freeFallTime = now;
  }

  // Detect impact after freefall
  if (freeFallDetected) {

    if (now - freeFallTime <= FALL_DETECTION_WINDOW) {

      if (accelerationMagnitude > IMPACT_THRESHOLD) {

        activateSOS("POSSIBLE FALL / IMPACT");

        freeFallDetected = false;
      }
    }
    else {

      freeFallDetected = false;
    }
  }
}

// =====================================================
// BUZZER AND LED ALARM
// =====================================================

void updateAlarm() {

  if (!sosActive) {

    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);

    return;
  }

  unsigned long now = millis();

  if (now - alarmPreviousMillis >= ALARM_INTERVAL) {

    alarmPreviousMillis = now;

    alarmState = !alarmState;

    digitalWrite(BUZZER_PIN, alarmState);
    digitalWrite(LED_PIN, alarmState);
  }
}

// =====================================================
// GPS PROCESSING
// =====================================================

void readGPS() {

  while (gpsSerial.available()) {

    gps.encode(gpsSerial.read());
  }
}

// =====================================================
// SERIAL MONITOR STATUS
// =====================================================

void printSystemStatus() {

  Serial.println("\n========================================");
  Serial.println("       WOMEN SAFETY SYSTEM STATUS");
  Serial.println("========================================");

  // MPU DETAILS
  Serial.println("\n[ MPU SENSOR ]");

  Serial.print("Connected: ");
  Serial.println(mpuConnected ? "YES" : "NO");

  Serial.print("WHO_AM_I: 0x");
  Serial.println(mpuIdentity, HEX);

  if (mpuConnected) {

    Serial.print("Accel X: ");
    Serial.print(accelX, 3);

    Serial.print(" | Y: ");
    Serial.print(accelY, 3);

    Serial.print(" | Z: ");
    Serial.println(accelZ, 3);

    Serial.print("Acceleration magnitude: ");
    Serial.print(accelerationMagnitude, 3);
    Serial.println(" g");

    Serial.print("Gyro X: ");
    Serial.print(gyroX, 2);

    Serial.print(" | Y: ");
    Serial.print(gyroY, 2);

    Serial.print(" | Z: ");
    Serial.println(gyroZ, 2);

    Serial.print("Temperature: ");
    Serial.print(temperatureC, 2);
    Serial.println(" C");
  }

  // GPS DETAILS
  Serial.println("\n[ GPS SENSOR ]");

  Serial.print("Characters processed: ");
  Serial.println(gps.charsProcessed());

  Serial.print("Satellites: ");

  if (gps.satellites.isValid()) {
    Serial.println(gps.satellites.value());
  }
  else {
    Serial.println("Not available");
  }

  Serial.print("HDOP: ");

  if (gps.hdop.isValid()) {
    Serial.println(gps.hdop.hdop());
  }
  else {
    Serial.println("Not available");
  }

  Serial.print("Location: ");

  if (gps.location.isValid()) {

    Serial.print(gps.location.lat(), 6);
    Serial.print(", ");
    Serial.println(gps.location.lng(), 6);

    Serial.print("Location age: ");
    Serial.print(gps.location.age());
    Serial.println(" ms");

    if (gps.location.age() < 10000) {

      Serial.print("Google Maps: https://www.google.com/maps?q=");
      Serial.print(gps.location.lat(), 6);
      Serial.print(",");
      Serial.println(gps.location.lng(), 6);
    }
    else {
      Serial.println("WARNING: GPS fix is stale.");
    }
  }
  else {
    Serial.println("Waiting for GPS fix...");
  }

  Serial.print("Altitude: ");

  if (gps.altitude.isValid()) {
    Serial.print(gps.altitude.meters());
    Serial.println(" m");
  }
  else {
    Serial.println("Not available");
  }

  Serial.print("Speed: ");

  if (gps.speed.isValid()) {
    Serial.print(gps.speed.kmph());
    Serial.println(" km/h");
  }
  else {
    Serial.println("Not available");
  }

  Serial.print("GPS date/time: ");

  if (gps.date.isValid() && gps.time.isValid()) {

    Serial.print(gps.date.day());
    Serial.print("/");
    Serial.print(gps.date.month());
    Serial.print("/");
    Serial.print(gps.date.year());

    Serial.print(" ");

    Serial.print(gps.time.hour());
    Serial.print(":");
    Serial.print(gps.time.minute());
    Serial.print(":");
    Serial.println(gps.time.second());
  }
  else {
    Serial.println("Not available");
  }

  // TOUCH DETAILS
  Serial.println("\n[ TOUCH SENSOR ]");

  Serial.print("Touch state: ");
  Serial.println(digitalRead(TOUCH_PIN) ? "PRESSED" : "RELEASED");

  // OUTPUT DETAILS
  Serial.println("\n[ OUTPUT STATUS ]");

  Serial.print("Buzzer: ");
  Serial.println(digitalRead(BUZZER_PIN) ? "ON" : "OFF");

  Serial.print("LED: ");
  Serial.println(digitalRead(LED_PIN) ? "ON" : "OFF");

  // SYSTEM DETAILS
  Serial.println("\n[ SYSTEM STATUS ]");

  Serial.print("SOS: ");
  Serial.println(sosActive ? "ACTIVE" : "NORMAL");

  Serial.print("Fall detection: ");
  Serial.println(mpuConnected ? "ENABLED" : "DISABLED");

  Serial.print("Freefall detected: ");
  Serial.println(freeFallDetected ? "YES" : "NO");

  if (cancelTiming) {

    Serial.print("Cancel hold: ");

    Serial.print((millis() - cancelStartTime) / 1000.0, 1);

    Serial.println(" / 3.0 seconds");
  }

  Serial.println("========================================");
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println("\n\n");
  Serial.println("========================================");
  Serial.println("       WOMEN SAFETY SYSTEM");
  Serial.println("            ESP32 DEVKIT");
  Serial.println("========================================");

  // Configure outputs
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  // Touch sensor
  pinMode(TOUCH_PIN, INPUT);

  // Initialize I2C
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  // Initialize MPU
  mpuConnected = initializeMPU();

  if (!mpuConnected) {
    Serial.println("WARNING: MPU sensor unavailable.");
  }

  // Initialize GPS UART2
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  Serial.println("\nGPS UART initialized.");
  Serial.println("GPS RX: GPIO 16");
  Serial.println("GPS TX: GPIO 17");

  Serial.println("\nSystem initialization completed.");


  Serial.println("Touch once: Activate SOS");
  Serial.println("Touch again and hold 3 seconds: Cancel SOS");

  printPreviousMillis = millis();
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  unsigned long now = millis();

  // 1. Continuously process GPS
  readGPS();

  // 2. Read MPU sensor every 20 ms
  if (mpuConnected &&
      now - mpuPreviousMillis >= MPU_INTERVAL) {

    mpuPreviousMillis = now;

    if (readMPUData()) {

      detectFall();
    }
    else {

      Serial.println("MPU register read error!");
      mpuConnected = false;
    }
  }

  // 3. Process touch sensor
  handleTouchSensor();

  // 4. Update buzzer and LED
  updateAlarm();

  // 5. Print complete status every 2 seconds
  if (now - printPreviousMillis >= PRINT_INTERVAL) {

    printPreviousMillis = now;

    printSystemStatus();
  }

  // 6. Serial commands
  if (Serial.available()) {

    char command = Serial.read();

    if (command == 'R' || command == 'r') {

      stopSOS();

    }

    else if (command == 'G' || command == 'g') {

      printSystemStatus();

    }
  }
}
