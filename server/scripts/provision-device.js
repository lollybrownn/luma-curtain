import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
const required=['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'];for(const key of required)if(!process.env[key])throw new Error(`${key} belum diisi di server/.env`)
const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD})
const deviceId=`LUMA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;const pairingCode=crypto.randomBytes(5).toString('hex').toUpperCase();const mqttPassword=crypto.randomBytes(24).toString('base64url');const name=process.argv.slice(2).join(' ')||'LumaCurtain ESP32'
await db.execute('INSERT INTO devices(id,device_id,name,pairing_code_hash,mqtt_password_hash) VALUES(UUID(),?,?,?,?)',[deviceId,name,await bcrypt.hash(pairingCode,12),await bcrypt.hash(mqttPassword,12)]);await db.end()
console.log('\nSimpan output ini di password manager. Nilai rahasia tidak dapat ditampilkan ulang.\n');console.log(`DEVICE_ID=${deviceId}`);console.log(`PAIRING_CODE=${pairingCode}`);console.log(`MQTT_USERNAME=${deviceId}`);console.log(`MQTT_PASSWORD=${mqttPassword}`);console.log(`MQTT_TOPIC_TELEMETRY=lumacurtain/${deviceId}/telemetry`);console.log(`MQTT_TOPIC_HEARTBEAT=lumacurtain/${deviceId}/heartbeat`);console.log(`MQTT_TOPIC_COMMAND=lumacurtain/${deviceId}/command\n`)
