import { db } from './db.js'

// Cache per device to avoid publishing the same target on every telemetry.
const lastAutoTarget = new Map()
const lightSamples = new Map()

/**
 * LDR digital mapping used by this firmware:
 * 1 = terang -> buka, 0 = gelap -> tutup.
 * The backend decides the target; ESP32 remains responsible for
 * motor movement, limit switches, and physical safety.
 */
export async function evaluateAutomaticControl({
  deviceId,
  light,
  position,
  moving,
  publishCommand,
}) {
  if (light !== 0 && light !== 1) return

  const [rows] = await db.execute(
    `SELECT d.id AS deviceDbId, d.owner_id AS ownerId, cs.mode
     FROM devices d
     INNER JOIN curtain_settings cs ON cs.device_id = d.id
     WHERE d.device_id = ? AND d.owner_id IS NOT NULL
     LIMIT 1`,
    [deviceId],
  )
  const settings = rows[0]
  if (!settings || settings.mode !== 'auto') {
    lastAutoTarget.delete(deviceId)
    lightSamples.delete(deviceId)
    return
  }

  const target = light === 1 ? 100 : 0
  const desiredPosition = target === 100 ? 'open' : 'closed'

  if (position === desiredPosition) {
    lastAutoTarget.set(deviceId, target)
    lightSamples.delete(deviceId)
    return
  }

  // Confirm the same digital state in two consecutive telemetry packets.
  const previous = lightSamples.get(deviceId)
  const count = previous?.light === light ? previous.count + 1 : 1
  lightSamples.set(deviceId, { light, count })
  if (count < 2 || moving === true) return

  if (lastAutoTarget.get(deviceId) === target) return

  await publishCommand(deviceId, {
    type: 'set_position',
    target,
    source: 'automation',
    issuedAt: new Date().toISOString(),
  })
  lastAutoTarget.set(deviceId, target)
  lightSamples.delete(deviceId)

  const eventType = target === 100 ? 'open_command' : 'close_command'
  const message = light === 1
    ? 'Otomatis: LDR digital mendeteksi terang; server memerintahkan tirai membuka.'
    : 'Otomatis: LDR digital mendeteksi gelap; server memerintahkan tirai menutup.'

  await db.execute(
    `INSERT INTO curtain_events
     (id, owner_id, device_id, event_type, mode, target_position, message)
     VALUES (UUID(), ?, ?, ?, 'auto', ?, ?)`,
    [settings.ownerId, settings.deviceDbId, eventType, target, message],
  )
}
