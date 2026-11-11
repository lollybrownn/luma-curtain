import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { checkDatabase } from './db.js'
import { ensureInitialAdmin } from './bootstrap-admin.js'
import { routes } from './routes.js'
import { adminRoutes } from './admin-routes.js'
import { startMqtt, publishCommand } from './mqtt.js'
import { startAutomaticScheduler } from './automation.js'

await checkDatabase()
await ensureInitialAdmin()

const app = express()
app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '32kb' }))
app.use(cookieParser())
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/devices/pair', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/commands', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/admin', rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }), adminRoutes)
app.use('/api', routes)

if (config.NODE_ENV === 'production') {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const client = path.resolve(here, '../../dist/client')
  app.use(express.static(client))
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(client, 'index.html')))
}

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' })
})

app.listen(config.HTTP_PORT, '0.0.0.0', () => {
  console.log(`HTTP aktif di http://localhost:${config.HTTP_PORT}`)
})

startMqtt()
startAutomaticScheduler(publishCommand)
