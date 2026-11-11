import { db } from './db.js'

// Mencegah backend mengirim command yang sama berulang kali sebelum
// ESP32 sempat melaporkan posisi akhirnya.
const lastAutoTarget = new Map()

/**
 * Keputusan otomatis berbasis LDR digital:
 * 1 = terang -> buka, 0 = gelap -> tutup.
 * Fungsi ini hanya mengirim target; kontrol motor dan limit switch
 * tetap sepenuhnya ditangani firmware ESP32.
 */
export async function evaluateAutomaticControl({
  deviceId,
  light,
  position,
  moving,
  publishCommand,
}) {
  if (light !== 0 && light !== 1) return
  if (moving) return

  const target = light === 1 ? 100 : 0
  const desiredPosition = target === 100 ? 'open' : 'closed'

  // Jika sudah sampai tujuan, bersihkan cache command sebelumnya.
  if (position === desiredPosition) {
    lastAutoTarget.delete(deviceId)
    return
  }

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
    return
  }

  if (lastAutoTarget.get(deviceId) === target) return

  // Tandai sebelum publish agar telemetry yang datang berdekatan
  // tidak menghasilkan command duplikat.
  lastAutoTarget.set(deviceId, target)

  try {
    await publishCommand(deviceId, {
      type: 'set_position',
      target,
      source: 'automation',
      issuedAt: new Date().toISOString(),
    })

    const eventType = target === 100 ? 'auto_open_command' : 'auto_close_command'
    const message = light === 1
      ? 'Sensor LDR mendeteksi kondisi terang; server memerintahkan tirai membuka.'
      : 'Sensor LDR mendeteksi kondisi gelap; server memerintahkan tirai menutup.'

    await db.execute(
      `INSERT INTO curtain_events
       (id, owner_id, device_id, event_type, mode, target_position, message)
       VALUES (UUID(), ?, ?, ?, 'auto', ?, ?)`,
      [settings.ownerId, settings.deviceDbId, eventType, target, message],
    )
  } catch (error) {
    lastAutoTarget.delete(deviceId)
    throw error
  }
}
