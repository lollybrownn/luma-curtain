import { useState } from 'react'
import { Navigate, useNavigate, useOutletContext } from 'react-router'
import { api } from '../api'

export function AuthPage() {
  const { user, refresh } = useOutletContext()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />

  async function submit(event) {
    event.preventDefault(); setPending(true); setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) })
      await refresh(); navigate(result.user.role === 'admin' ? '/admin' : result.hasDevice ? '/dashboard' : '/pair')
    } catch (err) { setError(err.message) } finally { setPending(false) }
  }

  return <main className="auth-shell">
    <section className="auth-hero"><div className="logo">LC</div><div><p className="kicker">SMART WAKE-UP CURTAIN</p><h1>Bangun bersama cahaya.</h1><p>Kontrol tirai, pantau sensor, dan hubungkan ESP32 melalui kanal MQTT yang terisolasi.</p></div><small>Vite · Express · MySQL · Aedes MQTT</small></section>
    <section className="auth-panel"><div className="auth-card"><p className="kicker">AKSES AMAN</p><h2>{mode === 'login' ? 'Selamat datang kembali' : 'Buat akun baru'}</h2><div className="tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Masuk</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Daftar</button></div><form onSubmit={submit}>{mode === 'register' && <label>Nama<input name="name" required minLength="2" maxLength="80" /></label>}<label>Email<input name="email" type="email" required /></label><label>Kata sandi<input name="password" type="password" required minLength="8" maxLength="72" /></label>{error && <p className="notice error">{error}</p>}<button className="primary" disabled={pending}>{pending ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Buat akun'}</button></form></div></section>
  </main>
}
