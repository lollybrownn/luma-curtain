import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
const required=['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'];for(const key of required)if(!process.env[key])throw new Error(`${key} belum diisi di server/.env`)
const email=(process.argv[2]||'admin@lumacurtain.local').trim().toLowerCase();const name=process.argv[3]||'Administrator LumaCurtain';const password=`${crypto.randomBytes(15).toString('base64url')}!9a`
const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD})
await db.execute("INSERT INTO app_users(id,name,email,password_hash,role,status) VALUES(UUID(),?,?,?,'admin','active') ON DUPLICATE KEY UPDATE name=VALUES(name),password_hash=VALUES(password_hash),role='admin',status='active'",[name,email,await bcrypt.hash(password,12)]);await db.end()
console.log('\nAkun admin siap. Simpan password ini sekarang; nilainya tidak disimpan dalam bentuk asli.\n');console.log(`ADMIN_EMAIL=${email}`);console.log(`ADMIN_PASSWORD=${password}\n`)
