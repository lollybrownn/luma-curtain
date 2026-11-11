import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db.js'
export async function ensureInitialAdmin(){
  const [rows]=await db.query("SELECT id FROM app_users WHERE role='admin' LIMIT 1")
  if(rows[0])return
  const email='admin@lumacurtain.local';const name='Administrator LumaCurtain';const password=`${crypto.randomBytes(15).toString('base64url')}!9a`
  await db.execute("INSERT INTO app_users(id,name,email,password_hash,role,status) VALUES(UUID(),?,?,?,'admin','active')",[name,email,await bcrypt.hash(password,12)])
  console.log('\n==============================================================')
  console.log('AKUN ADMIN PERTAMA DIBUAT. SIMPAN PASSWORD INI SEKARANG.')
  console.log(`ADMIN_EMAIL=${email}`)
  console.log(`ADMIN_PASSWORD=${password}`)
  console.log('Password tidak dapat ditampilkan kembali setelah terminal ditutup.')
  console.log('==============================================================\n')
}
