import { useState } from 'react'
import { Navigate, useNavigate, useOutletContext } from 'react-router'
import { api } from '../api'

export function PairPage() {
  const { user, refresh } = useOutletContext()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)

  if (!user) return <Navigate to="/" replace />

  async function backToLogin() {
    setLeaving(true)
    setError('')
    try {
      await api('/auth/logout', { method: 'POST' })
      await refresh()
      navigate('/')
    } catch (err) {
      setError(err.message)
      setLeaving(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await api('/devices/pair', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="center page-bg">
      <button
        type="button"
        onClick={backToLogin}
        disabled={leaving}
        aria-label="Kembali ke halaman login"
        title="Kembali ke halaman login"
        style={{
          position: 'fixed',
          top: '24px',
          left: '24px',
          zIndex: 10,
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: '#BAF138',
          color: '#11140d',
          fontSize: '28px',
          fontWeight: 900,
          lineHeight: 1,
          cursor: leaving ? 'wait' : 'pointer',
        }}
      >
        ←
      </button>
      <section className="pair-card">
        <div className="pair-icon">⌁</div>
        <p className="kicker">PAIRING PERANGKAT</p>
        <h1>Hubungkan ESP32</h1>
        <p className="muted">Jalankan script provisioning, lalu masukkan Device ID dan kode pairing yang dicetak satu kali.</p>
        <ol>
          <li><span>01</span>Jalankan <code>npm run provision:device</code></li>
          <li><span>02</span>Salin Device ID dan pairing code</li>
          <li><span>03</span>Masukkan kredensial di bawah</li>
        </ol>
        <form onSubmit={submit}>
          <label>Device ID<input name="deviceId" placeholder="LUMA-XXXXXXXX" required /></label>
          <label>Kode pairing<input name="pairingCode" placeholder="8 karakter" required minLength={8} /></label>
          {error && <p className="notice error">{error}</p>}
          <button className="primary" disabled={pending || leaving}>{pending ? 'Memverifikasi…' : 'Hubungkan perangkat'}</button>
        </form>
      </section>
    </main>
  )
}
