
#include <Arduino.h>
#include <AccelStepper.h>
#include <math.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ==========================================
// 0. KONFIGURASI WI-FI DAN MQTT
// ==========================================
// Isi dari hasil provisioning backend. Jangan commit kredensial asli.
const char* WIFI_SSID = "GANTI_WIFI";
const char* WIFI_PASSWORD = "GANTI_PASSWORD_WIFI";
const char* MQTT_HOST = "192.168.1.10"; // IP komputer/server backend
const uint16_t MQTT_PORT = 1883;
const char* DEVICE_ID = "LUMA-GANTI";
const char* MQTT_PASSWORD = "GANTI_PASSWORD_MQTT";

WiFiClient network;
PubSubClient mqtt(network);
String commandTopic;
String telemetryTopic;
String heartbeatTopic;
unsigned long waktuCobaWiFi = 0;
unsigned long waktuCobaMqtt = 0;
unsigned long waktuTelemetry = 0;
unsigned long waktuHeartbeat = 0;
const unsigned long INTERVAL_TELEMETRY = 5000;
const unsigned long INTERVAL_HEARTBEAT = 15000;

// ==========================================
// 1. KONFIGURASI PIN ESP32
// ==========================================

// Motor Stepper ULN2003
#define IN1 19
#define IN2 18
#define IN3 5
#define IN4 17

// Sensor LDR Digital
#define LDR_PIN 34

// Limit Switch
#define LIMIT_BUKA 25
#define LIMIT_TUTUP 26

// Sensor Ultrasonik HC-SR04
#define TRIG_PIN 23
#define ECHO_PIN 27

// LED Indikator
#define LED_MERAH 33
#define LED_KUNING 16
#define LED_HIJAU 32


// ==========================================
// 2. KONFIGURASI MOTOR STEPPER
// ==========================================

// Menggunakan ULN2003 dengan HALF4WIRE
AccelStepper stepper(
  AccelStepper::HALF4WIRE,
  IN1, IN3, IN2, IN4
);

const float KECEPATAN = 600;
const float MAKS_KECEPATAN = 900;
const float KECEPATAN_HOMING = 200;

//  1 = arah buka positif
// -1 = membalik arah motor
const int ARAH_BUKA = 1;


// ==========================================
// 3. KONFIGURASI SENSOR LDR
// ==========================================

// true  = HIGH menunjukkan terang
// false = LOW menunjukkan terang
//
// Sesuaikan berdasarkan pengujian
// output DO modul LDR.

const bool NILAI_HIGH_ADALAH_TERANG = true;

unsigned long waktuBaca = 0;

const unsigned long INTERVAL_CAHAYA = 300;


// ==========================================
// 4. STATUS SISTEM
// ==========================================

enum Target {
  BELUM_ADA,
  TARGET_BUKA,
  TARGET_TUTUP
};

enum Gerak {
  BERHENTI,
  MEMBUKA,
  MENUTUP
};

enum Posisi {
  POSISI_TIDAK_DIKETAHUI,
  POSISI_BUKA,
  POSISI_TUTUP
};

Target target = BELUM_ADA;
Gerak gerak = BERHENTI;
Posisi posisi = POSISI_TIDAK_DIKETAHUI;

enum HomingState { HOMING_CARI_TUTUP, HOMING_CARI_BUKA, HOMING_KEMBALI_TUTUP, HOMING_SELESAI, HOMING_GAGAL };
HomingState statusHoming = HOMING_CARI_TUTUP;
bool sudahHoming = false;
long totalSteps = 0;
int targetPersen = 0;
unsigned long waktuMulaiHoming = 0;
const unsigned long BATAS_WAKTU_HOMING = 60000UL;
const long MIN_LANGKAH_KALIBRASI = 100;
const long MAX_LANGKAH_KALIBRASI = 50000;


// ==========================================
// 5. KONFIGURASI LIMIT SWITCH
// ==========================================

const unsigned long DEBOUNCE_MS = 40;
bool keduaLimitFaultDilaporkan = false;
bool eventLimitBukaPending = false;
bool eventLimitTutupPending = false;

struct LimitSwitch {
  int pin;
  bool pembacaanTerakhir;
  bool kondisiStabil;
  unsigned long waktuPerubahan;
};

LimitSwitch limitBuka = {
  LIMIT_BUKA, HIGH, HIGH, 0
};

LimitSwitch limitTutup = {
  LIMIT_TUTUP, HIGH, HIGH, 0
};


// ==========================================
// 6. KONFIGURASI LED
// ==========================================

unsigned long waktuKedip = 0;

const unsigned long INTERVAL_KEDIP = 400;

bool statusLEDKuning = false;


// ==========================================
// 7. KONFIGURASI ULTRASONIK
// ==========================================

const unsigned long INTERVAL_JARAK = 500;

unsigned long waktuJarak = 0;
unsigned long waktuTrigger = 0;
unsigned long waktuEcho = 0;

float jarakTerakhir = -1;
float jarakTutup = -1;
float jarakBuka = -1;

bool jarakValid = false;

enum StatusUltrasonik {
  ULTRA_IDLE,
  MENUNGGU_ECHO,
  MEMBACA_ECHO
};

StatusUltrasonik statusUltrasonik = ULTRA_IDLE;


// ==========================================
// 8. MEMBACA SENSOR LDR
// ==========================================

bool bacaCahaya() {

  int nilai = digitalRead(LDR_PIN);

  if (NILAI_HIGH_ADALAH_TERANG) {
    return nilai == HIGH;
  }

  return nilai == LOW;
}


// ==========================================
// 9. MEMBACA LIMIT SWITCH
// DENGAN DEBOUNCE DAN EDGE DETECTION
// ==========================================

bool limitDitekan(LimitSwitch &limit) {

  bool pembacaan = digitalRead(limit.pin);

  unsigned long sekarang = millis();

  if (pembacaan != limit.pembacaanTerakhir) {

    limit.pembacaanTerakhir = pembacaan;

    limit.waktuPerubahan = sekarang;
  }

  if (sekarang - limit.waktuPerubahan >= DEBOUNCE_MS) {

    if (pembacaan != limit.kondisiStabil) {

      limit.kondisiStabil = pembacaan;

      // LOW hanya menghasilkan event
      // ketika limit switch baru tertekan.

      if (limit.kondisiStabil == LOW) {
        return true;
      }

    }

  }

  return false;
}


// ==========================================
// 10. MENGHENTIKAN MOTOR
// ==========================================

void berhentiMotor() {
  stepper.moveTo(stepper.currentPosition());
  stepper.setSpeed(0);
  stepper.disableOutputs();
  gerak = BERHENTI;
  statusLEDKuning = false;
  Serial.println("Motor berhenti.");
}


// ==========================================
// 11. MENGGERAKKAN MOTOR
// ==========================================

void mulaiMotor(Gerak arah) {

  stepper.enableOutputs();

  // Ketika meninggalkan posisi akhir,
  // status posisi sebelumnya dihapus.

  posisi = POSISI_TIDAK_DIKETAHUI;

  if (arah == MEMBUKA) {

    stepper.setSpeed(ARAH_BUKA * KECEPATAN);

    Serial.println("Motor membuka tirai.");

  }

  else if (arah == MENUTUP) {

    stepper.setSpeed(-ARAH_BUKA * KECEPATAN);

    Serial.println("Motor menutup tirai.");

  }

  gerak = arah;

  statusLEDKuning = true;

  waktuKedip = millis();

}


// ==========================================
// 12. MEMBACA JARAK HC-SR04
// ==========================================

float bacaJarak() {

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  unsigned long durasi = pulseIn(
    ECHO_PIN,
    HIGH,
    15000UL
  );

  if (durasi == 0) {
    return -1;
  }

  return durasi * 0.0343f / 2.0f;

}


// ==========================================
// 13. RATA-RATA JARAK UNTUK KALIBRASI
// ==========================================

float bacaJarakStabil() {

  float total = 0;

  int jumlah = 0;

  for (int i = 0; i < 5; i++) {

    float jarak = bacaJarak();

    if (jarak > 0) {

      total += jarak;

      jumlah++;

    }

    delay(30);

  }

  if (jumlah > 0) {

    return total / jumlah;

  }

  return -1;

}


// ==========================================
// 14. KALIBRASI POSISI TIRAI
// ==========================================

void kalibrasiJarak(bool terbuka) {

  // Motor sudah berhenti sebelum kalibrasi.

  statusUltrasonik = ULTRA_IDLE;

  delay(60);

  float hasil = bacaJarakStabil();

  if (hasil > 0) {

    jarakTerakhir = hasil;

    jarakValid = true;

    if (terbuka) {

      jarakBuka = hasil;

      Serial.print("Jarak posisi terbuka: ");

      Serial.print(jarakBuka, 1);

      Serial.println(" cm");

    }

    else {

      jarakTutup = hasil;

      Serial.print("Jarak posisi tertutup: ");

      Serial.print(jarakTutup, 1);

      Serial.println(" cm");

    }

  }

  else {

    jarakValid = false;

    Serial.println("Kalibrasi jarak gagal.");

  }

  waktuJarak = millis();

}


// ==========================================
// 15. MENANDAI POSISI TERBUKA
// ==========================================

void tandaiTerbuka() {

  berhentiMotor();

  posisi = POSISI_BUKA;
  eventLimitBukaPending = true;

  Serial.println("==============================");
  Serial.println("TIRAI TERBUKA SEPENUHNYA");
  Serial.println("==============================");

  kalibrasiJarak(true);

}


// ==========================================
// 16. MENANDAI POSISI TERTUTUP
// ==========================================

void tandaiTertutup() {

  berhentiMotor();

  posisi = POSISI_TUTUP;
  eventLimitTutupPending = true;

  Serial.println("==============================");
  Serial.println("TIRAI TERTUTUP SEPENUHNYA");
  Serial.println("==============================");

  kalibrasiJarak(false);

}


// ==========================================
// 17. MEMPROSES KEDUA LIMIT SWITCH
// ==========================================

bool prosesLimitSwitch() {
  bool tekanBuka = limitDitekan(limitBuka);
  bool tekanTutup = limitDitekan(limitTutup);
  bool bukaAktif = digitalRead(LIMIT_BUKA) == LOW;
  bool tutupAktif = digitalRead(LIMIT_TUTUP) == LOW;

  if (bukaAktif && tutupAktif) {
    stepper.moveTo(stepper.currentPosition());
    stepper.setSpeed(0);
    stepper.disableOutputs();
    gerak = BERHENTI;
    statusHoming = HOMING_GAGAL;
    sudahHoming = false;
    Serial.println("FAULT: Kedua limit switch aktif bersamaan. Motor dihentikan.");
    return true;
  }

  if (!sudahHoming) {
    if (statusHoming == HOMING_GAGAL || statusHoming == HOMING_SELESAI) return true;
    if (millis() - waktuMulaiHoming > BATAS_WAKTU_HOMING) {
      stepper.moveTo(stepper.currentPosition());
      stepper.setSpeed(0);
      stepper.disableOutputs();
      gerak = BERHENTI;
      statusHoming = HOMING_GAGAL;
      Serial.println("FAULT: Homing timeout. Periksa limit switch dan mekanik tirai.");
      return true;
    }

    if (statusHoming == HOMING_CARI_TUTUP) {
      if (tutupAktif) {
        stepper.setSpeed(0);
        gerak = BERHENTI;
        if (tekanTutup) {
          stepper.setCurrentPosition(0);
          stepper.enableOutputs();
          stepper.setSpeed(ARAH_BUKA * KECEPATAN_HOMING);
          gerak = MEMBUKA;
          statusHoming = HOMING_CARI_BUKA;
          waktuMulaiHoming = millis();
          Serial.println("Homing: titik 0% ditemukan. Mengukur rentang sampai limit buka...");
        }
      } else {
        stepper.enableOutputs();
        stepper.setSpeed(-ARAH_BUKA * KECEPATAN_HOMING);
        gerak = MENUTUP;
        stepper.runSpeed();
      }
      return true;
    }

    if (statusHoming == HOMING_CARI_BUKA) {
      if (bukaAktif) {
        stepper.setSpeed(0);
        gerak = BERHENTI;
        if (tekanBuka) {
          long hasilKalibrasi = stepper.currentPosition();
          if (hasilKalibrasi < MIN_LANGKAH_KALIBRASI || hasilKalibrasi > MAX_LANGKAH_KALIBRASI) {
            statusHoming = HOMING_GAGAL;
            stepper.disableOutputs();
            Serial.println("FAULT: Rentang langkah hasil kalibrasi tidak valid.");
          } else {
            totalSteps = hasilKalibrasi;
            stepper.moveTo(0);
            stepper.setMaxSpeed(KECEPATAN);
            stepper.setAcceleration(400);
            statusHoming = HOMING_KEMBALI_TUTUP;
            waktuMulaiHoming = millis();
            Serial.printf("Kalibrasi selesai: %ld langkah. Kembali ke 0%%...\\n", totalSteps);
          }
        }
      } else {
        stepper.enableOutputs();
        stepper.setSpeed(ARAH_BUKA * KECEPATAN_HOMING);
        gerak = MEMBUKA;
        stepper.runSpeed();
      }
      return true;
    }

    if (statusHoming == HOMING_KEMBALI_TUTUP) {
      if (tutupAktif) {
        stepper.moveTo(stepper.currentPosition());
        if (tekanTutup) {
          stepper.setCurrentPosition(0);
          sudahHoming = true;
          statusHoming = HOMING_SELESAI;
          posisi = POSISI_TUTUP;
          gerak = BERHENTI;
          stepper.disableOutputs();
          Serial.println("Homing selesai. Posisi 0% sudah diketahui; kontrol slider aktif.");
          kendalikanMotor();
        }
      } else {
        stepper.enableOutputs();
        gerak = MENUTUP;
        stepper.run();
      }
      return true;
    }
    return true;
  }

  // Limit switch hanya menghentikan gerak saat menuju ujung terkait.
  if (bukaAktif && (gerak == MEMBUKA || targetPersen == 100)) {
    stepper.moveTo(totalSteps);
    stepper.setCurrentPosition(totalSteps);
    if (tekanBuka) {
      posisi = POSISI_BUKA;
      eventLimitBukaPending = true;
      Serial.println("Limit buka: posisi 100% dikonfirmasi.");
    }
    gerak = BERHENTI;
    stepper.disableOutputs();
    return true;
  }

  if (tutupAktif && (gerak == MENUTUP || targetPersen == 0)) {
    stepper.moveTo(0);
    stepper.setCurrentPosition(0);
    if (tekanTutup) {
      posisi = POSISI_TUTUP;
      eventLimitTutupPending = true;
      Serial.println("Limit tutup: posisi 0% dikonfirmasi.");
    }
    gerak = BERHENTI;
    stepper.disableOutputs();
    return true;
  }
  return false;
}

// 18. MEMBACA LDR (TELEMETRY SAJA)
// Keputusan buka/tutup berasal dari backend.
// ==========================================

bool statusCahaya = false;

void updateCahaya() {
  if (millis() - waktuBaca >= INTERVAL_CAHAYA) {
    waktuBaca = millis();
    statusCahaya = bacaCahaya();
  }
}


// ==========================================

// 19. MENAMPILKAN JARAK DAN PERSENTASE
// ==========================================

void tampilkanJarak() {

  Serial.print("Jarak sensor-tirai: ");

  Serial.print(jarakTerakhir, 1);

  Serial.print(" cm");

  if (jarakTutup > 0 && jarakBuka > 0) {

    float rentang = fabsf(jarakBuka - jarakTutup);

    if (rentang > 1.0f) {

      float bukaan = fabsf(jarakTerakhir - jarakTutup);

      float persen = (bukaan / rentang) * 100.0f;

      persen = constrain(persen, 0.0f, 100.0f);

      Serial.print(" | Bukaan: ");

      Serial.print(bukaan, 1);

      Serial.print(" cm (");

      Serial.print(persen, 0);

      Serial.print("%)");

    }

  }

  else {

    Serial.print(" | Persentase belum dikalibrasi");

  }

  Serial.println();

}


// ==========================================
// 20. MEMBACA HC-SR04 SECARA NON-BLOCKING
// ==========================================

void updateUltrasonik() {

  unsigned long sekarangMs = millis();

  unsigned long sekarangUs = micros();


  // Memulai pengukuran baru

  if (statusUltrasonik == ULTRA_IDLE) {

    if (sekarangMs - waktuJarak >= INTERVAL_JARAK) {

      waktuJarak = sekarangMs;

      digitalWrite(TRIG_PIN, LOW);

      delayMicroseconds(2);

      digitalWrite(TRIG_PIN, HIGH);

      delayMicroseconds(10);

      digitalWrite(TRIG_PIN, LOW);

      waktuTrigger = micros();

      statusUltrasonik = MENUNGGU_ECHO;

    }

    return;

  }


  // Menunggu ECHO HIGH

  if (statusUltrasonik == MENUNGGU_ECHO) {

    if (digitalRead(ECHO_PIN) == HIGH) {

      waktuEcho = micros();

      statusUltrasonik = MEMBACA_ECHO;

    }

    else if (sekarangUs - waktuTrigger > 25000UL) {

      Serial.println("HC-SR04: Tidak ada pantulan.");

      statusUltrasonik = ULTRA_IDLE;

    }

  }


  // Menunggu ECHO LOW

  else if (statusUltrasonik == MEMBACA_ECHO) {

    if (digitalRead(ECHO_PIN) == LOW) {

      unsigned long durasi = micros() - waktuEcho;

      jarakTerakhir = durasi * 0.0343f / 2.0f;

      if (jarakTerakhir > 0 && jarakTerakhir <= 400) {

        jarakValid = true;

        tampilkanJarak();

      }

      else {

        jarakValid = false;

        Serial.println("HC-SR04: Pengukuran tidak valid.");

      }

      statusUltrasonik = ULTRA_IDLE;

    }

    else if (sekarangUs - waktuEcho > 25000UL) {

      jarakValid = false;

      Serial.println("HC-SR04: Timeout.");

      statusUltrasonik = ULTRA_IDLE;

    }

  }

}


// ==========================================
// 21. KONTROL MOTOR OTOMATIS
// ==========================================

void kendalikanMotor() {
  if (!sudahHoming || totalSteps <= 0) return;

  long targetLangkah = lround((double)totalSteps * targetPersen / 100.0);
  stepper.moveTo(targetLangkah);
  long sisaLangkah = stepper.distanceToGo();

  if (sisaLangkah == 0) {
    gerak = BERHENTI;
    if (targetPersen == 0) posisi = POSISI_TUTUP;
    else if (targetPersen == 100) posisi = POSISI_BUKA;
    else posisi = POSISI_TIDAK_DIKETAHUI;
    stepper.disableOutputs();
    statusLEDKuning = false;
    return;
  }

  stepper.enableOutputs();
  gerak = sisaLangkah > 0 ? MEMBUKA : MENUTUP;
  posisi = POSISI_TIDAK_DIKETAHUI;
  stepper.run();
}

// 22. KONTROL LED INDIKATOR
// ==========================================

void updateLED() {

  // MOTOR SEDANG BERGERAK

  if (gerak != BERHENTI) {

    digitalWrite(LED_HIJAU, LOW);

    digitalWrite(LED_MERAH, LOW);

    if (millis() - waktuKedip >= INTERVAL_KEDIP) {

      waktuKedip = millis();

      statusLEDKuning = !statusLEDKuning;

    }

    digitalWrite(LED_KUNING, statusLEDKuning);

  }


  // MOTOR BERHENTI

  else {

    digitalWrite(LED_KUNING, LOW);

    digitalWrite(
      LED_HIJAU,
      posisi == POSISI_BUKA ? HIGH : LOW
    );

    digitalWrite(
      LED_MERAH,
      posisi == POSISI_TUTUP ? HIGH : LOW
    );

    statusLEDKuning = false;

  }

}


// ==========================================
// 22A. MQTT: COMMAND, TELEMETRY, HEARTBEAT
// ==========================================

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("MQTT: JSON command tidak valid: %s\\n", error.c_str());
    return;
  }

  const char* type = doc["type"] | "";
  if (strcmp(type, "set_position") != 0) return;

  int requestedTarget = doc["target"] | -1;
  if (requestedTarget < 0 || requestedTarget > 100) {
    Serial.println("MQTT: target harus 0-100, command diabaikan.");
    return;
  }
  targetPersen = requestedTarget;
  target = requestedTarget == 100 ? TARGET_BUKA :
           requestedTarget == 0 ? TARGET_TUTUP : BELUM_ADA;
  Serial.printf("MQTT command: target posisi %d%% diterima.\\n", targetPersen);
  if (sudahHoming) kendalikanMotor();
}

void mulaiWiFiDanTopik() {
  commandTopic = "lumacurtain/" + String(DEVICE_ID) + "/command";
  telemetryTopic = "lumacurtain/" + String(DEVICE_ID) + "/telemetry";
  heartbeatTopic = "lumacurtain/" + String(DEVICE_ID) + "/heartbeat";
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  waktuCobaWiFi = millis();
  Serial.println("Menghubungkan ke Wi-Fi...");
}

void jagaKoneksi() {
  unsigned long sekarang = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (sekarang - waktuCobaWiFi >= 10000UL) {
      waktuCobaWiFi = sekarang;
      Serial.println("Wi-Fi terputus, mencoba menyambung ulang...");
      WiFi.reconnect();
    }
    if (mqtt.connected()) mqtt.disconnect();
    if (gerak != BERHENTI) {
      target = BELUM_ADA;
      berhentiMotor();
    }
    return;
  }

  if (!mqtt.connected() && sekarang - waktuCobaMqtt >= 3000UL) {
    waktuCobaMqtt = sekarang;
    uint64_t chip = ESP.getEfuseMac();
    String clientId = "luma-" +
      String((uint32_t)(chip >> 32), HEX) +
      String((uint32_t)chip, HEX);

    if (mqtt.connect(clientId.c_str(), DEVICE_ID, MQTT_PASSWORD)) {
      Serial.println("MQTT terhubung.");
      mqtt.subscribe(commandTopic.c_str(), 1);
      Serial.print("Subscribe: ");
      Serial.println(commandTopic);
    } else {
      Serial.printf("MQTT gagal, state=%d\\n", mqtt.state());
    }
  }
  if (mqtt.connected()) mqtt.loop();
}

void kirimTelemetry() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["light"] = statusCahaya ? 1 : 0;
  doc["distanceCm"] = jarakValid ? jarakTerakhir : -1;
  doc["position"] = posisi == POSISI_BUKA ? "open" :
                    posisi == POSISI_TUTUP ? "closed" :
                    "unknown";
  doc["positionPercent"] = sudahHoming && totalSteps > 0
    ? (int)constrain(lround((double)stepper.currentPosition() * 100.0 / totalSteps), 0L, 100L)
    : -1;
  doc["moving"] = gerak != BERHENTI;
  // Kirim event limit hanya sekali setelah switch terkonfirmasi debounce.
  // Flag tetap pending jika MQTT gagal mengirim, lalu dicoba pada telemetry berikutnya.
  doc["limitOpen"] = eventLimitBukaPending;
  doc["limitClosed"] = eventLimitTutupPending;

  char output[384];
  size_t written = serializeJson(doc, output, sizeof(output));
  if (written > 0 && mqtt.publish(telemetryTopic.c_str(), output, false)) {
    eventLimitBukaPending = false;
    eventLimitTutupPending = false;
  }
}

void kirimHeartbeat() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["firmwareVersion"] = "1.1.0";
  char output[128];
  size_t written = serializeJson(doc, output, sizeof(output));
  if (written > 0) mqtt.publish(heartbeatTopic.c_str(), output, false);
}


// ==========================================

// 23. SETUP
// ==========================================

void setup() {
  Serial.begin(115200);
  pinMode(LDR_PIN, INPUT);

  pinMode(LIMIT_BUKA, INPUT_PULLUP);
  pinMode(LIMIT_TUTUP, INPUT_PULLUP);
  limitBuka.pembacaanTerakhir = HIGH;
  limitBuka.kondisiStabil = HIGH;
  limitBuka.waktuPerubahan = millis();
  limitTutup.pembacaanTerakhir = HIGH;
  limitTutup.kondisiStabil = HIGH;
  limitTutup.waktuPerubahan = millis();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  pinMode(LED_MERAH, OUTPUT);
  pinMode(LED_KUNING, OUTPUT);
  pinMode(LED_HIJAU, OUTPUT);
  digitalWrite(LED_MERAH, LOW);
  digitalWrite(LED_KUNING, LOW);
  digitalWrite(LED_HIJAU, LOW);

  stepper.setMaxSpeed(MAKS_KECEPATAN);
  stepper.setAcceleration(400);
  stepper.disableOutputs();
  waktuMulaiHoming = millis();
  Serial.println("Homing awal: mencari limit switch tutup untuk menetapkan 0%...");

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(3);

  Serial.println("==================================");
  Serial.println(" SMART WAKE-UP CURTAIN - ESP32");
  Serial.println("==================================");
  Serial.println("Motor: 28BYJ-48 + ULN2003");
  Serial.println("LDR, HC-SR04, limit switch, LED aktif.");
  Serial.println("Kontrol buka/tutup diterima melalui MQTT.");
  Serial.println("Limit switch tetap menjadi pengaman lokal.");
  mulaiWiFiDanTopik();
}

// 24. LOOP UTAMA
// ==========================================

void loop() {
  jagaKoneksi();

  // Safety hardware selalu diprioritaskan.
  bool adaLimitTerpicu = prosesLimitSwitch();

  // LDR hanya dibaca untuk dikirim ke backend.
  updateCahaya();
  updateUltrasonik();

  if (!adaLimitTerpicu) kendalikanMotor();
  updateLED();

  unsigned long sekarang = millis();
  if (mqtt.connected() && sekarang - waktuTelemetry >= INTERVAL_TELEMETRY) {
    waktuTelemetry = sekarang;
    kirimTelemetry();
  }
  if (mqtt.connected() && sekarang - waktuHeartbeat >= INTERVAL_HEARTBEAT) {
    waktuHeartbeat = sekarang;
    kirimHeartbeat();
  }
}
