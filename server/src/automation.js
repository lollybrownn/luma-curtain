import { db } from './db.js'

const SCHEDULER_INTERVAL_MS = 5_000
const TIME_ZONE = 'Asia/Jakarta'
const lastAutoTarget = new Map()
const lightSamples = new Map()
const stableLight = new Map()
const runtimeState = new Map()
const pendingTargets = new Map()

function jakartaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}

function jakartaDayUtcRange(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return [start, end]
}

async function recordAutomaticEvent(settings, target, message) {
  const eventType = target === 100 ? 'open_command' : 'close_command'
  await db.execute(
    `INSERT INTO curtain_events
     (id, owner_id, device_id, occurred_at, event_type, mode, target_position, message)
     VALUES (UUID(), ?, ?, ?, ?, 'auto', ?, ?)`,
    [settings.ownerId, settings.deviceDbId, new Date(), eventType, target, message],
  )
}

async function dispatchTarget({ deviceId, settings, target, publishCommand, message, position, moving, source }) {
  const desiredPosition = target === 100 ? 'open' : 'closed'

  if (position === desiredPosition) {
    lastAutoTarget.set(deviceId, target)
    pendingTargets.delete(deviceId)
    return false
  }

  if (moving === true) {
    // Simpan pemicu terbaru. Target yang lebih baru menggantikan target antrean sebelumnya.
    pendingTargets.set(deviceId, { target, message, source })
    return false
  }

  if (lastAutoTarget.get(deviceId) === target) return false

  await publishCommand(deviceId, {
    type: 'set_position',
    target,
    source,
    issuedAt: new Date().toISOString(),
  })

  lastAutoTarget.set(deviceId, target)
  pendingTargets.delete(deviceId)
  await recordAutomaticEvent(settings, target, message)
  return true
}

async function getDeviceSettings(deviceId) {
  const [rows] = await db.execute(
    `SELECT d.id AS deviceDbId, d.owner_id AS ownerId, cs.mode,
            TIME_FORMAT(cs.open_time, '%H:%i') AS openTime,
            TIME_FORMAT(cs.close_time, '%H:%i') AS closeTime
     FROM devices d
     INNER JOIN curtain_settings cs ON cs.device_id = d.id
     WHERE d.device_id = ? AND d.owner_id IS NOT NULL
     LIMIT 1`,
    [deviceId],
  )
  return rows[0] || null
}

/**
 * Mode otomatis bersifat event-driven:
 * - Jadwal buka dan tutup masing-masing dieksekusi sekali per tanggal Jakarta.
 * - LDR 0 (gelap) meminta buka; LDR 1 (terang) meminta tutup.
 * - LDR harus stabil pada dua sampel berturut-turut dan hanya memicu saat status berubah.
 * - Pemicu terbaru menang; saat motor bergerak, target terbaru disimpan sebagai antrean.
 * Keputusan bisnis berada di server. ESP32 hanya menjalankan target dan menjaga limit fisik.
 */
export async function evaluateAutomaticControl({ deviceId, light, position, moving, publishCommand }) {
  const settings = await getDeviceSettings(deviceId)

  if (!settings || settings.mode !== 'auto') {
    lastAutoTarget.delete(deviceId)
    lightSamples.delete(deviceId)
    stableLight.delete(deviceId)
    pendingTargets.delete(deviceId)
    runtimeState.delete(deviceId)
    return
  }

  runtimeState.set(deviceId, { position, moving: moving === true })

  // Jika motor sudah berhenti, jalankan pemicu terakhir yang tertunda.
  const pending = pendingTargets.get(deviceId)
  if (pending && moving !== true) {
    await dispatchTarget({
      deviceId, settings, ...pending, publishCommand, position, moving,
    })
  }

  if (light !== 0 && light !== 1) return

  const previous = lightSamples.get(deviceId)
  const count = previous?.light === light ? previous.count + 1 : 1
  lightSamples.set(deviceId, { light, count })
  if (count < 2) return

  const previousStable = stableLight.get(deviceId)
  lightSamples.delete(deviceId)
  if (previousStable === light) return
  stableLight.set(deviceId, light)

  const target = light === 0 ? 100 : 0
  const message = light === 0
    ? 'Otomatis: LDR stabil mendeteksi gelap; server memerintahkan tirai membuka.'
    : 'Otomatis: LDR stabil mendeteksi terang; server memerintahkan tirai menutup.'

  await dispatchTarget({
    deviceId, settings, target, publishCommand, message, position, moving, source: 'ldr',
  })
}

async function hasScheduleRun(settings, dateKey, target) {
  const [start, end] = jakartaDayUtcRange(dateKey)
  const scheduleLabel = target === 100 ? 'Jadwal buka' : 'Jadwal tutup'
  const [rows] = await db.execute(
    `SELECT id FROM curtain_events
     WHERE device_id = ? AND mode = 'auto'
       AND event_type = ? AND occurred_at >= ? AND occurred_at < ?
       AND message LIKE ?
     LIMIT 1`,
    [settings.deviceDbId, target === 100 ? 'open_command' : 'close_command', start, end, `Otomatis: ${scheduleLabel}%`],
  )
  return rows.length > 0
}

export function startAutomaticScheduler(publishCommand) {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const now = jakartaDateParts()
      const dateKey = `${now.year}-${now.month}-${now.day}`
      const minute = `${now.hour}:${now.minute}`

      const [devices] = await db.execute(
        `SELECT d.id AS deviceDbId, d.device_id AS deviceId, d.owner_id AS ownerId,
                cs.mode, TIME_FORMAT(cs.open_time, '%H:%i') AS openTime,
                TIME_FORMAT(cs.close_time, '%H:%i') AS closeTime
         FROM devices d
         INNER JOIN curtain_settings cs ON cs.device_id = d.id
         WHERE d.owner_id IS NOT NULL AND cs.mode = 'auto'`,
      )

      const activeIds = new Set(devices.map(device => device.deviceId))
      for (const cache of [lastAutoTarget, lightSamples, stableLight, runtimeState, pendingTargets]) {
        for (const deviceId of [...cache.keys()]) {
          if (!activeIds.has(deviceId)) cache.delete(deviceId)
        }
      }

      for (const settings of devices) {
        const deviceId = settings.deviceId
        const current = runtimeState.get(deviceId) || { position: 'unknown', moving: false }
        const schedules = [
          { time: settings.openTime, target: 100, label: 'buka' },
          { time: settings.closeTime, target: 0, label: 'tutup' },
        ]

        for (const schedule of schedules) {
          if (schedule.time !== minute) continue
          if (await hasScheduleRun(settings, dateKey, schedule.target)) continue

          const message = `Otomatis: Jadwal ${schedule.label} pukul ${schedule.time} WIB dijalankan.`
          await dispatchTarget({
            deviceId,
            settings,
            target: schedule.target,
            publishCommand,
            message,
            position: current.position,
            moving: current.moving,
            source: 'schedule',
          })
          // Jika target sudah tercapai atau sedang bergerak, catat event jadwal juga
          // agar tidak dieksekusi berulang selama menit yang sama.
          if (current.position === (schedule.target === 100 ? 'open' : 'closed')) {
            await recordAutomaticEvent(settings, schedule.target, message)
          } else if (current.moving) {
            await recordAutomaticEvent(settings, schedule.target, message)
          }
        }
      }
    } catch (error) {
      console.error('Scheduler otomatis gagal:', error.message)
    } finally {
      running = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS)
  timer.unref?.()
  console.log(`Scheduler otomatis aktif (jadwal + LDR, zona waktu ${TIME_ZONE}, interval ${SCHEDULER_INTERVAL_MS / 1000} detik)`)
  return timer
}
