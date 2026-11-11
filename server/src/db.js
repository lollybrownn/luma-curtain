import mysql from 'mysql2/promise'
import { config } from './config.js'
export const db = mysql.createPool({
  host: config.MYSQL_HOST, port: config.MYSQL_PORT, database: config.MYSQL_DATABASE,
  user: config.MYSQL_USER, password: config.MYSQL_PASSWORD, waitForConnections: true,
  connectionLimit: 10, decimalNumbers: true, timezone: 'Z',
})
export async function checkDatabase(){ await db.query('SELECT 1') }
