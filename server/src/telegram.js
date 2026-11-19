import { db } from './db.js'
import { config } from './config.js'

let polling = false
let updateOffset = 0
let publishCommandRef
const pendingCompletions = new Map()

const enabled = Boolean(config.TELEGRAM_BOT_TOKEN)
const notificationChatId = String(config.TELEGRAM_CHAT_ID || '')

async function telegramApi(method, body = {}) {
  if (!enabled) throw new Error('Telegram belum dikonfigurasi.')
  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API gagal: ${response.status}`)
  return result.result
}

export async function notifyTelegram(message) {
  if (!enabled || !notificationChatId) return
  try {
    await telegramApi('sendMessage', { chat_id: notificationChatId, text: message })
  } catch (error) {
    console.error('Notifikasi Telegram gagal:', error.message)
  }
}

export async function notifyTelegramCompletion({ deviceId, position, moving }) {
  if (!enabled || moving === true) return
  const pending = pendingCompletions.get(deviceId)
  if (!pending) return
  if (Date.now() - pending.requestedAt > 120_000) {
    pendingCompletions.delete(deviceId)
    await notifyTelegram(`⚠️ Belum ada konfirmasi posisi setelah 2 menit. Periksa ESP32 dan mekanisme tirai.\nPerangkat: ${deviceId}`)
    return
  }
  const expectedPosition = pending.target === 100 ? 'open' : 'closed'
  if (position !== expectedPosition) return

  pendingCompletions.delete(deviceId)
  await notifyTelegram(
    `✅ Tirai berhasil ${pending.target === 100 ? 'dibuka' : 'ditutup'}.\nPosisi target: ${pending.target}%\nPerangkat: ${deviceId}`,
  )
}

async function getDeviceStatus() {
  const [rows] = await db.execute(
    `SELECT d.device_id AS deviceId, d.name, d.last_seen_at AS lastSeenAt,
            cs.mode, cs.manual_target AS manualTarget,
            sr.position, sr.moving, sr.reading_at AS readingAt
     FROM devices d
     INNER JOIN curtain_settings cs ON cs.device_id = d.id
     LEFT JOIN sensor_readings sr ON sr.id = (
       SELECT latest.id FROM sensor_readings latest
       WHERE latest.device_id = d.id ORDER BY latest.reading_at DESC LIMIT 1
     )
     WHERE d.owner_id IS NOT NULL
     LIMIT 1`,
  )
  return rows[0] || null
}

function modeLabel(mode) {
  return mode === 'manual' ? 'Manual' : mode === 'auto' ? 'Otomatis (jadwal + sensor)' : mode
}

async function replyHelp(chatId) {
  await telegramApi('sendMessage', {
    chat_id: chatId,
    text: [
      '🤖 LumaCurtain Bot',
      '',
      '/open - Buka tirai (100%)',
      '/close - Tutup tirai (0%)',
      '/status - Lihat status perangkat',
      '/help - Tampilkan bantuan',
      '',
      'Perintah buka/tutup hanya tersedia saat mode Manual aktif.',
    ].join('\n'),
  })
}

async function handleCommand(message) {
  const chatId = String(message.chat?.id || '')
  if (!chatId || !message.text) return

  const command = message.text.trim().split(/\s+/, 1)[0].split('@')[0].toLowerCase()
  if (command === '/start' || command === '/help') {
    await replyHelp(chatId)
    return
  }

  if (command === '/status') {
    const device = await getDeviceStatus()
    if (!device) {
      await telegramApi('sendMessage', { chat_id: chatId, text: 'Belum ada perangkat LumaCurtain yang dipasangkan.' })
      return
    }
    const online = device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 45_000
    const position = device.position === 'open' ? 'Terbuka' : device.position === 'closed' ? 'Tertutup' : 'Tidak diketahui / di antara posisi'
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: [
        '📊 Status LumaCurtain',
        `Perangkat: ${device.name} (${device.deviceId})`,
        `Koneksi ESP32: ${online ? '🟢 Online' : '🔴 Offline'}`,
        `Mode: ${modeLabel(device.mode)}`,
        `Posisi: ${position}`,
        `Motor: ${device.moving ? 'Bergerak' : 'Berhenti'}`,
      ].join('\n'),
    })
    return
  }

  if (command !== '/open' && command !== '/close') return

  const device = await getDeviceStatus()
  if (!device) {
    await telegramApi('sendMessage', { chat_id: chatId, text: '❌ Belum ada perangkat yang dipasangkan.' })
    return
  }
  if (device.mode !== 'manual') {
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: `⚠️ Perintah ditolak. Mode saat ini: ${modeLabel(device.mode)}.\nUbah mode ke Manual melalui dashboard terlebih dahulu.`,
    })
    return
  }

  const online = device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 45_000
  if (!online) {
    await telegramApi('sendMessage', { chat_id: chatId, text: '❌ ESP32 sedang offline. Perintah tidak dikirim.' })
    return
  }

  const target = command === '/open' ? 100 : 0
  await publishCommandRef(device.deviceId, {
    type: 'set_position',
    target,
    source: 'telegram',
    issuedAt: new Date().toISOString(),
  })
  await db.execute('UPDATE curtain_settings SET manual_target=? WHERE device_id=(SELECT id FROM devices WHERE device_id=? LIMIT 1)', [target, device.deviceId])
  await db.execute(
    `INSERT INTO curtain_events(id,owner_id,device_id,event_type,mode,target_position,message)
     SELECT UUID(),owner_id,id,?, 'manual', ?, ? FROM devices WHERE device_id=? AND owner_id IS NOT NULL`,
    [target === 100 ? 'open_command' : 'close_command', target, `Perintah Telegram: target ${target}%`, device.deviceId],
  )
  pendingCompletions.set(device.deviceId, { target, requestedAt: Date.now() })
  await telegramApi('sendMessage', {
    chat_id: chatId,
    text: `📨 Perintah diterima. Tirai sedang ${target === 100 ? 'dibuka' : 'ditutup'}.\nTarget: ${target}%\nAku akan memberi tahu ketika ESP32 mengonfirmasi posisi sudah tercapai.`,
  })
}

async function pollUpdates() {
  // Abaikan update lama yang tertinggal saat backend mati agar command lama
  // tidak dieksekusi tiba-tiba ketika server dinyalakan kembali.
  try {
    const backlog = await telegramApi('getUpdates', { offset: -1, timeout: 0, allowed_updates: ['message'] })
    if (backlog.length) updateOffset = backlog[backlog.length - 1].update_id + 1
  } catch (error) {
    console.error('Gagal menyelaraskan antrean Telegram:', error.message)
  }

  while (polling) {
    try {
      const updates = await telegramApi('getUpdates', { offset: updateOffset, timeout: 25, allowed_updates: ['message'] })
      for (const update of updates) {
        updateOffset = update.update_id + 1
        try {
          if (update.message) await handleCommand(update.message)
        } catch (error) {
          console.error('Perintah Telegram gagal diproses:', error.message)
          const chatId = String(update.message?.chat?.id || '')
          if (chatId) {
            await telegramApi('sendMessage', {
              chat_id: chatId,
              text: '❌ Perintah gagal diproses. Periksa koneksi backend dan MQTT.',
            })
          }
        }
      }
    } catch (error) {
      console.error('Polling Telegram gagal:', error.message)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
}

export function startTelegram(publishCommand) {
  if (!enabled) {
    console.log('Telegram nonaktif. Isi TELEGRAM_BOT_TOKEN di server/.env untuk mengaktifkan.')
    return
  }
  if (polling) return
  publishCommandRef = publishCommand
  polling = true
  void publishCommandRef
  console.log('Telegram bot aktif (perintah dapat digunakan oleh semua akun).')
  void pollUpdates()
}
