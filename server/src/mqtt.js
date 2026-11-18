import mqtt from 'mqtt'
import fs from 'node:fs'
import { db } from './db.js'
import { config } from './config.js'
import { evaluateAutomaticControl } from './automation.js'

let mqttClient

const topic = (deviceId, suffix) => `lumacurtain/${deviceId}/${suffix}`

async function handleDeviceMessage(topicName, payload) {
  const parts = topicName.split('/')
  if (parts.length !== 3 || parts[0] !== 'lumacurtain') return
  const [, deviceId, kind] = parts
  if (!/^LUMA-[A-F0-9]{12}$/.test(deviceId)) return

  try {
    const body = JSON.parse(payload.toString())
    const now = new Date()

    if (kind === 'heartbeat') {
      await db.execute(
        'UPDATE devices SET last_seen_at=?,firmware_version=LEFT(?,40) WHERE device_id=?',
        [now, String(body.firmwareVersion || ''), deviceId],
      )
      return
    }

    if (kind !== 'telemetry') return

    // Firmware menormalisasi pembacaan LDR: 1 = terang, 0 = gelap.
    const light = body.light == null ? null : Number(body.light)
    const distance = body.distanceCm == null ? null : Number(body.distanceCm)
    const position = ['open', 'closed', 'between', 'unknown'].includes(body.position)
      ? body.position
      : 'unknown'

    if ((light !== null && light !== 0 && light !== 1)
      || (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 1000))) return

    const [devices] = await db.execute(
      'SELECT id,owner_id FROM devices WHERE device_id=? LIMIT 1',
      [deviceId],
    )
    const device = devices[0]
    if (!device) return

    await db.execute('UPDATE devices SET last_seen_at=? WHERE id=?', [now, device.id])
    if (device.owner_id) {
      await db.execute(
        `INSERT INTO sensor_readings
         (id, owner_id, device_id, reading_at, light, distance_cm, position, moving, limit_open, limit_closed, source)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'esp32')`,
        [
          device.owner_id,
          device.id,
          now,
          light,
          distance,
          position,
          body.moving === true,
          body.limitOpen === true,
          body.limitClosed === true,
        ],
      )
      await evaluateAutomaticControl({
        deviceId,
        light,
        position,
        moving: body.moving === true,
        publishCommand,
      })
    }
  } catch (error) {
    console.error('Payload MQTT diabaikan:', error.message)
  }
}

export function publishCommand(deviceId, payload) {
  return new Promise((resolve, reject) => {
    if (!mqttClient?.connected) {
      reject(new Error('Koneksi ke EMQX Cloud belum tersedia. Perintah belum dikirim.'))
      return
    }
    mqttClient.publish(
      topic(deviceId, 'command'),
      JSON.stringify(payload),
      { qos: 1, retain: false },
      error => error ? reject(error) : resolve(),
    )
  })
}

export function startMqtt() {
  if (mqttClient) return mqttClient

  const ca = config.MQTT_CA_CERT_PATH
    ? fs.readFileSync(config.MQTT_CA_CERT_PATH)
    : undefined

  mqttClient = mqtt.connect(`mqtts://${config.MQTT_HOST}:${config.MQTT_PORT}`, {
    username: config.MQTT_BACKEND_USERNAME,
    password: config.MQTT_BACKEND_PASSWORD,
    clientId: config.MQTT_BACKEND_CLIENT_ID,
    clean: true,
    connectTimeout: 15_000,
    keepalive: 30,
    reconnectPeriod: 3_000,
    resubscribe: true,
    ...(ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true }),
  })

  mqttClient.on('connect', () => {
    console.log('Terhubung ke EMQX Cloud melalui MQTT over TLS.')
    mqttClient.subscribe([
      { topic: 'lumacurtain/+/telemetry', qos: 1 },
      { topic: 'lumacurtain/+/heartbeat', qos: 1 },
      { topic: 'lumacurtain/+/status', qos: 1 },
    ], error => {
      if (error) console.error('Subscribe MQTT gagal:', error.message)
      else console.log('Subscribe telemetry, heartbeat, dan status aktif.')
    })
  })
  mqttClient.on('reconnect', () => console.log('Mencoba menyambung ulang ke EMQX Cloud...'))
  mqttClient.on('offline', () => console.warn('Koneksi EMQX Cloud offline.'))
  mqttClient.on('error', error => console.error('MQTT Cloud error:', error.message))
  mqttClient.on('message', (topicName, payload) => {
    void handleDeviceMessage(topicName, payload)
  })

  return mqttClient
}
