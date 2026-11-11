import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { db } from './db.js'
const COOKIE='luma_session'
export function signSession(user){return jwt.sign({sub:user.id,email:user.email,role:user.role},config.JWT_SECRET,{expiresIn:'7d',issuer:'lumacurtain'})}
export function setSession(res,token){res.cookie(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production',maxAge:7*24*60*60*1000,path:'/'})}
export function clearSession(res){res.clearCookie(COOKIE,{httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production',path:'/'})}
export async function requireAuth(req,res,next){try{const decoded=jwt.verify(req.cookies[COOKIE],config.JWT_SECRET,{issuer:'lumacurtain'});const [rows]=await db.execute('SELECT id,email,role,status FROM app_users WHERE id=? LIMIT 1',[decoded.sub]);const user=rows[0];if(!user||user.status!=='active')return res.status(401).json({error:'Sesi tidak valid. Silakan masuk kembali.'});req.user={id:user.id,email:user.email,role:user.role};next()}catch(error){if(error?.name==='JsonWebTokenError'||error?.name==='TokenExpiredError')return res.status(401).json({error:'Sesi tidak valid. Silakan masuk kembali.'});next(error)}}
export function requireAdmin(req,res,next){if(req.user?.role!=='admin')return res.status(403).json({error:'Akses admin diperlukan.'});next()}
