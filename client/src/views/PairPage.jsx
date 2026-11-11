import { useState } from 'react'
import { Navigate, useNavigate, useOutletContext } from 'react-router'
import { api } from '../api'
export function PairPage() {
  const { user } = useOutletContext(); const navigate = useNavigate(); const [error,setError]=useState(''); const [pending,setPending]=useState(false)
  if (!user) return <Navigate to="/" replace />
  async function submit(event){event.preventDefault();setPending(true);setError('');try{await api('/devices/pair',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});navigate('/dashboard')}catch(err){setError(err.message)}finally{setPending(false)}}
  return <main className="center page-bg"><section className="pair-card"><div className="pair-icon">⌁</div><p className="kicker">PAIRING PERANGKAT</p><h1>Hubungkan ESP32</h1><p className="muted">Jalankan script provisioning, lalu masukkan Device ID dan kode pairing yang dicetak satu kali.</p><ol><li><span>01</span>Jalankan <code>npm run provision:device</code></li><li><span>02</span>Salin Device ID dan pairing code</li><li><span>03</span>Masukkan kredensial di bawah</li></ol><form onSubmit={submit}><label>Device ID<input name="deviceId" placeholder="LUMA-XXXXXXXX" required /></label><label>Kode pairing<input name="pairingCode" placeholder="8 karakter" required minLength="8" /></label>{error && <p className="notice error">{error}</p>}<button className="primary" disabled={pending}>{pending?'Memverifikasi…':'Hubungkan perangkat'}</button></form></section></main>
}
