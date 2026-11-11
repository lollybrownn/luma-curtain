
#include <Arduino.h>
#include <AccelStepper.h>
#include <math.h>

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


// ==========================================
// 5. KONFIGURASI LIMIT SWITCH
// ==========================================

const unsigned long DEBOUNCE_MS = 40;

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

  if (tekanBuka && tekanTutup) {

    berhentiMotor();

    posisi = POSISI_TIDAK_DIKETAHUI;

    Serial.println("PERINGATAN: Kedua limit switch aktif.");

    return true;

  }

  if (tekanBuka) {

    tandaiTerbuka();

    return true;

  }

  if (tekanTutup) {

    tandaiTertutup();

    return true;

  }

  return false;

}


// ==========================================
// 18. LOGIKA OTOMATIS BERDASARKAN LDR
// ==========================================

void updateCahaya() {

  if (millis() - waktuBaca >= INTERVAL_CAHAYA) {

    waktuBaca = millis();

    bool terang = bacaCahaya();

    Target targetBaru = target;

    if (terang) {

      targetBaru = TARGET_BUKA;

    }

    else {

      targetBaru = TARGET_TUTUP;

    }

    if (targetBaru != target) {

      target = targetBaru;

      if (target == TARGET_BUKA) {

        Serial.println("Terang terdeteksi.");

        Serial.println("Target: MEMBUKA TIRAI");

      }

      else {

        Serial.println("Gelap terdeteksi.");

        Serial.println("Target: MENUTUP TIRAI");

      }

    }

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

  // ==============================
  // TARGET MEMBUKA
  // ==============================

  if (target == TARGET_BUKA) {

    // Sudah mencapai posisi terbuka

    if (posisi == POSISI_BUKA) {

      if (gerak != BERHENTI) {

        berhentiMotor();

      }

      return;

    }

    // Mulai membuka jika belum bergerak

    if (gerak != MEMBUKA) {

      mulaiMotor(MEMBUKA);

    }

    stepper.runSpeed();

  }


  // ==============================
  // TARGET MENUTUP
  // ==============================

  else if (target == TARGET_TUTUP) {

    // Sudah mencapai posisi tertutup

    if (posisi == POSISI_TUTUP) {

      if (gerak != BERHENTI) {

        berhentiMotor();

      }

      return;

    }

    // Mulai menutup jika belum bergerak

    if (gerak != MENUTUP) {

      mulaiMotor(MENUTUP);

    }

    stepper.runSpeed();

  }


  // ==============================
  // BELUM ADA TARGET
  // ==============================

  else {

    if (gerak != BERHENTI) {

      berhentiMotor();

    }

  }

}


// ==========================================
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
// 23. SETUP
// ==========================================

void setup() {

  Serial.begin(115200);


  // SENSOR LDR DIGITAL

  pinMode(LDR_PIN, INPUT);


  // LIMIT SWITCH

  pinMode(LIMIT_BUKA, INPUT_PULLUP);

  pinMode(LIMIT_TUTUP, INPUT_PULLUP);

  // HIGH dijadikan keadaan awal.
  // Jika switch sudah aktif ketika ESP32
  // menyala, program akan mendeteksinya
  // setelah proses debounce.

  limitBuka.pembacaanTerakhir = HIGH;

  limitBuka.kondisiStabil = HIGH;

  limitBuka.waktuPerubahan = millis();

  limitTutup.pembacaanTerakhir = HIGH;

  limitTutup.kondisiStabil = HIGH;

  limitTutup.waktuPerubahan = millis();


  // HC-SR04

  pinMode(TRIG_PIN, OUTPUT);

  pinMode(ECHO_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);


  // LED

  pinMode(LED_MERAH, OUTPUT);

  pinMode(LED_KUNING, OUTPUT);

  pinMode(LED_HIJAU, OUTPUT);

  digitalWrite(LED_MERAH, LOW);

  digitalWrite(LED_KUNING, LOW);

  digitalWrite(LED_HIJAU, LOW);


  // MOTOR STEPPER ULN2003

  stepper.setMaxSpeed(MAKS_KECEPATAN);

  stepper.disableOutputs();


  // PESAN AWAL

  Serial.println("==================================");

  Serial.println("     SISTEM TIRAI OTOMATIS ESP32");

  Serial.println("==================================");

  Serial.println("Mode: OTOMATIS");

  Serial.println("Motor: 28BYJ-48 + ULN2003");

  Serial.println("LDR digital aktif.");

  Serial.println("Limit switch buka dan tutup aktif.");

  Serial.println("HC-SR04 aktif.");

  Serial.println("LED indikator aktif.");

  Serial.println("Menunggu pembacaan sensor...");

}


// ==========================================
// 24. LOOP UTAMA
// ==========================================

void loop() {

  // 1. Memeriksa limit switch

  bool adaLimitTerpicu = prosesLimitSwitch();


  // 2. Membaca kondisi cahaya LDR

  updateCahaya();


  // 3. Memperbarui pembacaan HC-SR04

  updateUltrasonik();


  // 4. Mengendalikan motor jika tidak
  // sedang memproses sinyal limit switch

  if (!adaLimitTerpicu) {

    kendalikanMotor();

  }


  // 5. Memperbarui LED

  updateLED();

}
