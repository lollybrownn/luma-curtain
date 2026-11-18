# LumaCurtain

- **Frontend:** Vite + React + React Router
- **Backend:** Express (Node.js)
- **Database:** MySQL 8
- **MQTT broker:** managed EMQX Cloud (Dedicated Flex direkomendasikan untuk kontrol dan provisioning ACL per perangkat)
- **ESP32:** PubSubClient + ArduinoJson, koneksi MQTT over TLS

Broker tidak lagi dijalankan di proses backend. Backend dan ESP32 sama-sama menjadi MQTT client yang terhubung ke deployment EMQX Cloud. Hosting Express dan MySQL tetap diperlukan secara terpisah.

## Keamanan MQTT

- Setiap ESP32 memakai username berupa Device ID dan password acak 192-bit.
- Password disimpan sebagai bcrypt hash di MySQL; plaintext hanya ditampilkan ketika provisioning atau rotasi.
- User MQTT perangkat dibuat di EMQX Cloud melalui Deployment API.
- ACL per username hanya mengizinkan publish telemetry/heartbeat/status milik perangkat dan subscribe command miliknya.
- Backend memakai kredensial terpisah. Jangan gunakan akun backend sebagai kredensial ESP32.
- Koneksi MQTT menggunakan TLS port 8883 dan verifikasi CA certificate. Jangan memakai `setInsecure()`.
- Jangan gunakan broker publik untuk kontrol tirai atau data perangkat.

## 1. Persiapan layanan EMQX Cloud

Buat deployment EMQX Cloud **Dedicated Flex** dan aktifkan password-based authentication dengan built-in database serta built-in database authorization. Pada authenticator, pilih **UserID Type = username**. Buat kredensial backend khusus, misalnya `lumacurtain-backend`.

Backend memerlukan izin MQTT:
- Subscribe: `lumacurtain/+/telemetry`, `lumacurtain/+/heartbeat`, `lumacurtain/+/status`
- Publish: `lumacurtain/+/command`

Atur ACL backend pada Dashboard EMQX Cloud untuk username backend:
- Allow subscribe ke `lumacurtain/+/telemetry`, `lumacurtain/+/heartbeat`, dan `lumacurtain/+/status`
- Allow publish ke `lumacurtain/+/command`

Jangan jadikan backend superuser jika ACL terpisah dapat digunakan.

Di EMQX Cloud, buat Deployment API Key dengan izin minimum untuk mengelola built-in database authentication users dan authorization rules. Whitelist endpoint API yang dibutuhkan:
- `GET, POST, PUT, DELETE /api/v5/authentication/password_based:built_in_database/users`
- `GET, PUT, DELETE /api/v5/authentication/password_based:built_in_database/users/*`
- `POST /api/v5/authorization/sources/built_in_database/rules/users`
- `PUT, DELETE /api/v5/authorization/sources/built_in_database/rules/users/*`

Ambil **API endpoint dari detail deployment** (bukan Platform API endpoint), lalu isi App ID dan App Secret. Endpoint API berbeda dari hostname MQTT. Pastikan built-in database authentication dan authorization sudah dibuat/aktif pada deployment sebelum provisioning.

## 2. Database dan environment backend

Buat database menggunakan `database/schema.sql`, lalu salin konfigurasi:

```powershell
Copy-Item server\.env.example server\.env
```

Isi nilai MySQL, JWT, dan variabel berikut di `server/.env`:

- `MQTT_HOST`: hostname MQTT dari detail deployment EMQX Cloud (tanpa `mqtts://`)
- `MQTT_PORT=8883`
- `MQTT_BACKEND_USERNAME` dan `MQTT_BACKEND_PASSWORD`: akun backend yang dibuat di EMQX
- `MQTT_BACKEND_CLIENT_ID=lumacurtain-backend`
- `MQTT_CLOUD_API_URL`: Deployment API endpoint dari detail deployment
- `MQTT_CLOUD_APP_ID` dan `MQTT_CLOUD_APP_SECRET`: kredensial Deployment API
- `MQTT_CA_CERT_PATH`: opsional, path CA bundle jika Node.js tidak memakai trust store standar

Jangan commit `server/.env`.

## 3. Instal dan jalankan backend/frontend

```powershell
npm install
# npm install memperbarui package-lock.json di root sesuai dependency MQTT.js yang baru
npm run dev
```

Jalankan dari root proyek. Pastikan perubahan `package-lock.json` hasil `npm install` ikut di-commit sebelum memakai `npm ci` pada CI/deployment. Backend Express menggunakan port 3001; frontend Vite menggunakan port 5173. Backend otomatis menghubungkan diri ke EMQX Cloud dan melakukan reconnect bila koneksi terputus.

## 4. Provisioning perangkat ESP32

Setelah API, authenticator, dan authorization source EMQX siap:

```powershell
npm run provision:device -- "Tirai Kamar Utama"
```

Script akan:
1. membuat user MQTT di EMQX Cloud;
2. memasang ACL khusus device;
3. menyimpan pairing code dan hash password ke MySQL;
4. mencetak kredensial sekali saja.

Simpan output provisioning dengan aman. Jika provisioning gagal setelah user cloud dibuat, script mencoba membersihkan user sementara di EMQX.

## 5. Konfigurasi firmware

Buka `firmware/esp32-example.ino` dan isi:
- Wi-Fi SSID/password;
- hostname EMQX Cloud;
- Device ID dan MQTT password dari provisioning;
- CA certificate resmi untuk hostname deployment EMQX Cloud.

Firmware memakai `WiFiClientSecure` dan PubSubClient pada port 8883. Tempel CA certificate yang benar; placeholder di file bukan sertifikat valid. Verifikasi TLS tidak boleh dinonaktifkan. Install library Arduino `PubSubClient` dan `ArduinoJson` serta library bawaan ESP32.

Setelah upload, pastikan Serial Monitor menunjukkan Wi-Fi tersambung dan MQTT connected.

## 6. Rotasi password perangkat

Admin console menyediakan rotasi kredensial MQTT. Endpoint memperbarui password di EMQX Cloud terlebih dahulu, lalu menyimpan bcrypt hash baru di MySQL dan menampilkan password baru satu kali. Setelah rotasi, update `MQTT_PASSWORD` di firmware dan upload ulang ESP32. Perangkat dengan password lama akan gagal reconnect.

## Arsitektur

```text
React/Vite
    |
    v
Express API + MySQL 8
    |  MQTT client (TLS 8883)
    v
EMQX Cloud managed broker
    ^
    |  MQTT client (TLS 8883)
  ESP32
```

EMQX Cloud mengelola broker; pengguna tidak perlu menjalankan atau meng-host broker sendiri. Express API dan MySQL tetap perlu di-host atau dijalankan di lingkungan server yang tersedia.

## Troubleshooting

- **Connection refused / timeout:** cek hostname, port 8883, egress firewall, dan status deployment.
- **Not authorized:** pastikan authenticator password-based aktif, username/password benar, serta ACL username dan backend sudah sesuai.
- **TLS certificate verify failed:** pastikan CA certificate resmi cocok dengan sertifikat hostname deployment; jangan mematikan verifikasi TLS.
- **API 401/403:** pastikan memakai Deployment API endpoint dan App ID/App Secret dari deployment, serta API key memiliki whitelist izin endpoint yang diperlukan.
- **Provisioning API 404:** pastikan deployment mendukung API v5 built-in database authenticator/authorization dan sumber built-in database sudah diaktifkan.
- **Rotasi password:** setelah admin menghasilkan password baru, firmware harus diperbarui dengan password tersebut.

## Referensi resmi

- [EMQX Cloud Dedicated API](https://docs.emqx.com/en/cloud/latest/api/dedicated.html)
- [EMQX Cloud Deployment Management API](https://docs.emqx.com/en/cloud/latest/api/deployment_manage.html)
- [EMQX Cloud authorization](https://docs.emqx.com/en/cloud/latest/deployments/authz_overview.html)
- [EMQX Cloud authentication](https://docs.emqx.com/en/cloud/latest/deployments/auth_overview.html)
