import { db } from './db.js'

const SCHEDULER_INTERVAL_MS = 5_000
const lastAutoTarget = new Map()
const lightSamples = new Map()

async function recordAutomaticEvent(settings, target, message) {
  const eventType = target === 100 ? 'open_command' : 'close_command'
  await db.execute(
    `INSERT INTO curtain_events
     (id, owner_id, device_id, event_type, mode, target_position, message)
     VALUES (UUID(), ?, ?, ?, 'auto', ?, ?)`,
    [settings.ownerId, settings.deviceDbId, eventType, target, message],
  )
}

async function sendAutomaticTarget({
  deviceId,
  settings,
  target,
  publishCommand,
  message,
  position,
  moving,
}) {
  const desiredPosition = target === 100 ? 'open' : 'closed'

  if (position === desiredPosition) {
    lastAutoTarget.set(deviceId, target)
    return false
  }

  if (moving === true || lastAutoTarget.get(deviceId) === target) return false

  await publishCommand(deviceId, {
    type: 'set_position',
    target,
    source: 'ldr',
    issuedAt: new Date().toISOString(),
  })

  lastAutoTarget.set(deviceId, target)
  await recordAutomaticEvent(settings, target, message)
  return true
}

async function getDeviceSettings(deviceId) {
  const [rows] = await db.execute(
    `SELECT d.id AS deviceDbId, d.owner_id AS ownerId, cs.mode
     FROM devices d
     INNER JOIN curtain_settings cs ON cs.device_id = d.id
     WHERE d.device_id = ? AND d.owner_id IS NOT NULL
     LIMIT 1`,
    [deviceId],
  )
  return rows[0] || null
}

/**
 * Prioritas otomatis:
 * - LDR digital 0 (gelap) => buka 100%.
 * - LDR digital 1 (terang) => tutup 0%.
 * - Dua sampel berturut-turut harus sama untuk menghindari noise.
 * - Jam buka/tutup hanya disimpan di pengaturan UI; tidak mengalahkan LDR.
 * Server menentukan target. ESP32 hanya mengeksekusi target dan safety limit.
 */
export async function evaluateAutomaticControl({
  deviceId,
  light,
  position,
  moving,
  publishCommand,
}) {
  const settings = await getDeviceSettings(deviceId)

  if (!settings || settings.mode !== 'auto') {
    lastAutoTarget.delete(deviceId)
    lightSamples.delete(deviceId)
    return
  }

  // Modul LDR digital hanya boleh mengirim 0 atau 1.
  if (light !== 0 && light !== 1) return

  const previous = lightSamples.get(deviceId)
  const count = previous?.light === light ? previous.count + 1 : 1
  lightSamples.set(deviceId, { light, count })

  if (count < 2 || moving === true) return

  // Sensor berada di dalam ruangan:
  // gelap berarti tirai dibuka; terang (termasuk lampu menyala) berarti ditutup.
  const target = light === 0 ? 100 : 0
  const message = light === 0
    ? 'Otomatis: LDR mendeteksi gelap di dalam ruangan; server memerintahkan tirai membuka.'
    : 'Otomatis: LDR mendeteksi terang di dalam ruangan; server memerintahkan tirai menutup.'

  await sendAutomaticTarget({
    deviceId,
    settings,
    target,
    publishCommand,
    message,
    position,
    moving,
  })

  // Setelah keputusan diproses, kumpulkan dua sampel baru untuk perubahan berikutnya.
  lightSamples.delete(deviceId)
}

/**
 * Pembersihan cache perangkat yang sudah unpair atau berpindah ke mode manual.
 * Scheduler tidak lagi mengirim perintah berdasarkan jam.
 */
export function startAutomaticScheduler(_publishCommand) {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const [devices] = await db.execute(
        `SELECT d.device_id AS deviceId
         FROM devices d
         INNER JOIN curtain_settings cs ON cs.device_id = d.id
         WHERE d.owner_id IS NOT NULL AND cs.mode = 'auto'`,
      )

      const activeIds = new Set(devices.map(device => device.deviceId))
      for (const deviceId of [...lastAutoTarget.keys()]) {
        if (!activeIds.has(deviceId)) {
          lastAutoTarget.delete(deviceId)
          lightSamples.delete(deviceId)
        }
      }
      for (const deviceId of [...lightSamples.keys()]) {
        if (!activeIds.has(deviceId)) lightSamples.delete(deviceId)
      }
    } catch (error) {
      console.error('Pembersihan scheduler otomatis gagal:', error.message)
    } finally {
      running = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS)
  timer.unref?.()
  console.log(`Scheduler otomatis aktif (prioritas LDR, interval pemeriksaan ${SCHEDULER_INTERVAL_MS / 1000} detik)`)
  return timer
}
