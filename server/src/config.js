import 'dotenv/config'
import { z } from 'zod'
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  MYSQL_HOST: z.string().min(1).default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().default(3306),
  MYSQL_DATABASE: z.string().min(1).default('lumacurtain'),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MQTT_HOST: z.string().default('0.0.0.0'),
  MQTT_PORT: z.coerce.number().int().min(1).max(65535).default(1883),
  MQTT_TLS_CERT_PATH: z.string().optional(),
  MQTT_TLS_KEY_PATH: z.string().optional(),
})
const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}
export const config = parsed.data
