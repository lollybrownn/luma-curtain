import { useEffect } from 'react'

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onClose, 3600)
    return () => clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  const success = toast.type === 'success'
  return (
    <div className={`toast toast-${success ? 'success' : 'error'}`} role={success ? 'status' : 'alert'}>
      <span className="toast-icon" aria-hidden="true">{success ? '✓' : '!'}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" type="button" onClick={onClose} aria-label="Tutup notifikasi">×</button>
    </div>
  )
}
