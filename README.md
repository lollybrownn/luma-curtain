# LumaCurtain Standalone

Versi lokal tanpa Figma/Payload:

- **Frontend:** Vite + React + React Router
- **Backend:** Express
- **Database:** MySQL 8
- **MQTT broker:** Aedes (open-source, berjalan di proses backend)
- **ESP32:** contoh PubSubClient + ArduinoJson tersedia di `firmware/`

## Keamanan MQTT

MQTT Client ID **bukan secret** dan dapat terlihat di jaringan. Aplikasi tidak mengandalkan Client ID untuk keamanan.

Setiap perangkat mendapat:

- Device ID acak sebagai MQTT username
- password MQTT acak 192-bit, hanya dicetak sekali
- kode pairing terpisah
- hash bcrypt untuk password MQTT dan kode pairing di MySQL
- ACL programatik: perangkat hanya boleh publish ke topic miliknya dan subscribe ke command miliknya
- koneksi anonim ditolak

Jangan masukkan kredensial hasil provisioning ke Git. Untuk internet/produksi, aktifkan TLS melalui `MQTT_TLS_CERT_PATH` dan `MQTT_TLS_KEY_PATH`, firewall port MQTT, serta gunakan VPN bila memungkinkan.

## 1. Persyaratan

- Node.js 20 atau lebih baru
- MySQL 8
- npm (sudah ikut ketika memasang Node.js)

Periksa:

```powershell
node -v
npm -v
mysql --version
```

Proyek ini tidak membutuhkan `mise`, `corepack`, atau `pnpm`.

## 2. Buat database

Buka Command Prompt di folder proyek:

```cmd
mysql -u root -p < database\schema.sql
```

Jika memakai PowerShell:

```powershell
cmd /c "mysql -u root -p < database\schema.sql"
```

Buat user MySQL khusus melalui MySQL Console. Ganti password dengan nilai kuat milik Anda:

```sql
CREATE USER 'lumacurtain_user'@'localhost' IDENTIFIED BY 'PASSWORD_KUAT_ANDA';
GRANT SELECT, INSERT, UPDATE, DELETE ON lumacurtain.* TO 'lumacurtain_user'@'localhost';
FLUSH PRIVILEGES;
```

## 3. Buat konfigurasi server

Di PowerShell:

```powershell
Copy-Item server\.env.example server\.env
```

Buat JWT secret acak:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Buka `server/.env`, lalu isi:

- `MYSQL_USER=lumacurtain_user`
- `MYSQL_PASSWORD` dengan password MySQL Anda
- `JWT_SECRET` dengan hasil perintah Node di atas
- `CLIENT_ORIGIN=http://localhost:5173`

Jangan commit atau membagikan `server/.env`.

## 4. Instal dan jalankan

Dari folder utama proyek:

```powershell
npm install
npm run dev
```

Buka `http://localhost:5173`.

Port lokal:

- Web: `5173`
- Express API: `3001`
- MQTT: `1883`

Izinkan port 1883 di Windows Firewall hanya untuk jaringan privat/LAN yang diperlukan. Jangan membuka port 1883 langsung ke internet.

## 5. Provisioning perangkat

Pastikan MySQL sudah berjalan dan `server/.env` sudah benar:

```powershell
npm run provision:device -- "Tirai Kamar Utama"
```

Perintah mencetak satu kali:

- `DEVICE_ID`
- `PAIRING_CODE`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- topic perangkat

Simpan output di password manager. Gunakan Device ID dan pairing code pada halaman pairing. Salin MQTT username/password ke firmware ESP32 secara lokal dan jangan commit firmware yang sudah berisi secret.

## 6. Upload firmware ESP32

1. Buka `firmware/esp32-example.ino` di Arduino IDE.
2. Instal library `PubSubClient` dan `ArduinoJson`.
3. Isi Wi-Fi, IP komputer server, Device ID, dan MQTT password.
4. Pastikan ESP32 dan komputer ada di jaringan yang sama.
5. Upload firmware.

## 7. Build produksi

```powershell
npm run build
$env:NODE_ENV="production"
npm run start
```

Pada produksi, letakkan Express di belakang reverse proxy HTTPS. MQTT sebaiknya memakai sertifikat TLS dan port 8883, bukan TCP polos 1883.

## Topic MQTT

Untuk Device ID `LUMA-ABC123`:

```text
Publish:   lumacurtain/LUMA-ABC123/telemetry
Publish:   lumacurtain/LUMA-ABC123/heartbeat
Publish:   lumacurtain/LUMA-ABC123/status
Subscribe: lumacurtain/LUMA-ABC123/command
```

Broker memverifikasi username/password dan menolak topic milik perangkat lain.

## Troubleshooting

### `mysql` tidak dikenali

Tambahkan folder `bin` MySQL ke PATH Windows atau jalankan menggunakan path lengkap, misalnya:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

### ESP32 tidak terhubung

- Gunakan IP LAN komputer, bukan `localhost`.
- Pastikan `MQTT_USERNAME` sama dengan Device ID.
- Periksa Windows Firewall untuk jaringan privat.
- Jalankan provisioning hanya sekali per perangkat.
- Jangan memakai Device ID milik perangkat lain.

## Admin console

Versi ini memiliki admin console di:

```text
http://localhost:5173/admin
```

Untuk database baru, `database/schema.sql` sudah mencakup role admin dan audit log.

Jika database dibuat menggunakan ZIP versi sebelumnya, jalankan migrasi ini satu kali:

```powershell
cmd /c "mysql -u root -p < database\migrate-admin.sql"
```

Saat `npm run dev` dijalankan pertama kali, server otomatis membuat akun admin jika belum ada. Email dan password acak akan dicetak satu kali di terminal. Simpan password tersebut.

Jika output hilang atau Anda ingin mereset password admin:

```powershell
npm run create:admin
```

Email default admin:

```text
admin@lumacurtain.local
```

Script mencetak password acak satu kali di terminal. Simpan password tersebut di password manager. Menjalankan perintah lagi akan menghasilkan password baru dan mereset akun admin yang sama.

Untuk email admin lain:

```powershell
npm run create:admin -- "admin@example.com" "Nama Administrator"
```

Pendaftaran dari halaman publik selalu membuat role `member`; pengguna tidak dapat menjadikan dirinya admin.

Admin console menyediakan:

- overview pengguna, perangkat, status online, sensor, dan aktivitas;
- daftar pengguna dan aktivasi/nonaktivasi akun;
- daftar perangkat, unpair, dan rotasi password MQTT;
- pembacaan sensor terbaru;
- riwayat aktivitas tirai; dan
- audit log tindakan admin.

Password akun, pairing code, dan password MQTT tidak pernah dapat dibaca kembali dari MySQL. Password MQTT baru hanya tampil sekali ketika dirotasi.
