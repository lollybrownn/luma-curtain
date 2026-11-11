import { db } from './db.js'

const TIME_ZONE = 'Asia/Jakarta'
const SCHEDULER_INTERVAL_MS = 5_000
const lastAutoTarget = new Map()
const lightSamples = new Map()
const scheduledOpenDay = new Map()

function getJakartaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    dayKey: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  }
}

function timeToMinutes(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\\d{2}):(\\d{2})(?::\\d{2})?$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function isWithinSchedule(nowMinute, openMinute, closeMinute) {
  return openMinute !== null && closeMinute !== null
    && nowMinute >= openMinute && nowMinute < closeMinute
}

async function recordAutomaticEvent(settings, target, source, message) {
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
  source,
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
    source,
    issuedAt: new Date().toISOString(),
  })
  lastAutoTarget.set(deviceId, target)
  await recordAutomaticEvent(settings, target, source, message)
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
 * Automatic policy:
 * - Outside [openTime, closeTime): keep the curtain closed; ignore the LDR.
 * - At openTime: the scheduler issues one opening command, regardless of light.
 * - Inside the window: stable digital LDR readings may open/close the curtain.
 * The ESP32 only executes set_position and keeps all physical safety handling.
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
    scheduledOpenDay.delete(deviceId)
    return
  }

  const now = getJakartaClock()
  const openMinute = timeToMinutes(settings.openTime)
  const closeMinute = timeToMinutes(settings.closeTime)
  const withinSchedule = isWithinSchedule(now.minuteOfDay, openMinute, closeMinute)

  if (!withinSchedule) {
    lightSamples.delete(deviceId)
    await sendAutomaticTarget({
      deviceId,
      settings,
      target: 0,
      publishCommand,
      source: 'schedule',
      message: 'Jadwal otomatis: di luar waktu operasional, server memerintahkan tirai menutup.',
      position,
      moving,
    })
    return
  }

  if (light !== 0 && light !== 1) return

  const target = light === 1 ? 100 : 0
  const previous = lightSamples.get(deviceId)
  const count = previous?.light === light ? previous.count + 1 : 1
  lightSamples.set(deviceId, { light, count })
  if (count < 2 || moving === true) return

  await sendAutomaticTarget({
    deviceId,
    settings,
    target,
    publishCommand,
    source: 'ldr',
    message: light === 1
      ? 'Otomatis: LDR mendeteksi terang dalam jadwal aktif; server memerintahkan tirai membuka.'
      : 'Otomatis: LDR mendeteksi gelap dalam jadwal aktif; server memerintahkan tirai menutup.',
    position,
    moving,
  })
  lightSamples.delete(deviceId)
}

/**
 * Runs independently of sensor telemetry so schedule boundaries still work
 * when no new LDR packet arrives. The timer uses the backend host clock,
 * explicitly interpreted in Asia/Jakarta.
 */
export function startAutomaticScheduler(publishCommand) {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const [devices] = await db.execute(
        `SELECT d.device_id AS deviceId, d.id AS deviceDbId,
                d.owner_id AS ownerId, cs.mode,
                TIME_FORMAT(cs.open_time, '%H:%i') AS openTime,
                TIME_FORMAT(cs.close_time, '%H:%i') AS closeTime,
                latest.position, latest.moving
         FROM devices d
         INNER JOIN curtain_settings cs ON cs.device_id = d.id
         LEFT JOIN (
           SELECT sr.device_id, sr.position, sr.moving
           FROM sensor_readings sr
           INNER JOIN (
             SELECT device_id, MAX(reading_at) AS latest_at
             FROM sensor_readings
             GROUP BY device_id
           ) newest ON newest.device_id = sr.device_id AND newest.latest_at = sr.reading_at
         ) latest ON latest.device_id = d.id
         WHERE d.owner_id IS NOT NULL AND cs.mode = 'auto'`,
      )

      const now = getJakartaClock()
      for (const settings of devices) {
        const openMinute = timeToMinutes(settings.openTime)
        const closeMinute = timeToMinutes(settings.closeTime)
        if (openMinute === null || closeMinute === null) continue

        if (now.minuteOfDay >= openMinute && now.minuteOfDay < closeMinute && scheduledOpenDay.get(settings.deviceId) !== now.dayKey) {
          const sent = await sendAutomaticTarget({
            deviceId: settings.deviceId,
            settings,
            target: 100,
            publishCommand,
            source: 'schedule',
            message: 'Jadwal otomatis: waktu buka tiba; server memerintahkan tirai membuka tanpa bergantung pada kondisi cahaya.',
            position: settings.position,
            moving: Boolean(settings.moving),
          })
          if (sent || settings.position === 'open') {
            scheduledOpenDay.set(settings.deviceId, now.dayKey)
          }
        }

        // Enforce the closed state outside the daily active window.
        if (!isWithinSchedule(now.minuteOfDay, openMinute, closeMinute)) {
          await sendAutomaticTarget({
            deviceId: settings.deviceId,
            settings,
            target: 0,
            publishCommand,
            source: 'schedule',
            message: 'Jadwal otomatis: di luar waktu operasional; server memerintahkan tirai menutup.',
            position: settings.position,
            moving: Boolean(settings.moving),
          })
          lightSamples.delete(settings.deviceId)
        }
      }

      // Forget cached devices that have been unpaired or switched to manual.
      const activeIds = new Set(devices.map(device => device.deviceId))
      for (const deviceId of lastAutoTarget.keys()) {
        if (!activeIds.has(deviceId)) {
          lastAutoTarget.delete(deviceId)
          lightSamples.delete(deviceId)
          scheduledOpenDay.delete(deviceId)
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
  console.log(`Scheduler otomatis aktif (zona waktu ${TIME_ZONE}, interval ${SCHEDULER_INTERVAL_MS / 1000} detik)`)
  return timer
}
