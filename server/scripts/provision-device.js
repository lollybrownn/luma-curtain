import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import { createDeviceMqttIdentity, deleteDeviceMqttIdentity } from '../src/emqx-cloud.js'

const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']
for (const key of required) if (!process.env[key]) throw new Error(`${key} belum diisi di server/.env`)

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
})

const deviceId = `LUMA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
const pairingCode = crypto.randomBytes(5).toString('hex').toUpperCase()
const mqttPassword = crypto.randomBytes(24).toString('base64url')
const name = process.argv.slice(2).join(' ') || 'LumaCurtain ESP32'

let cloudIdentityCreated = false
try {
  // Buat user dan ACL di EMQX Cloud terlebih dahulu. DB hanya menyimpan bcrypt hash.
  await createDeviceMqttIdentity(deviceId, mqttPassword)
  cloudIdentityCreated = true
  await db.execute(
    'INSERT INTO devices(id,device_id,name,pairing_code_hash,mqtt_password_hash) VALUES(UUID(),?,?,?,?)',
    [deviceId, name, await bcrypt.hash(pairingCode, 12), await bcrypt.hash(mqttPassword, 12)],
  )
} catch (error) {
  if (cloudIdentityCreated) {
    try { await deleteDeviceMqttIdentity(deviceId) } catch (cleanupError) {
      console.error('PERINGATAN: gagal menghapus user sementara di EMQX Cloud:', cleanupError.message)
    }
  }
  throw error
} finally {
  await db.end()
}

console.log('\nSimpan output ini di password manager. Nilai rahasia tidak dapat ditampilkan ulang.\n')
console.log(`DEVICE_ID=${deviceId}`)
console.log(`PAIRING_CODE=${pairingCode}`)
console.log(`MQTT_USERNAME=${deviceId}`)
console.log(`MQTT_PASSWORD=${mqttPassword}`)
console.log(`MQTT_HOST=${process.env.MQTT_HOST}`)
console.log(`MQTT_PORT=${process.env.MQTT_PORT || 8883}`)
console.log(`MQTT_TOPIC_TELEMETRY=lumacurtain/${deviceId}/telemetry`)
console.log(`MQTT_TOPIC_HEARTBEAT=lumacurtain/${deviceId}/heartbeat`)
console.log(`MQTT_TOPIC_COMMAND=lumacurtain/${deviceId}/command\n`)
