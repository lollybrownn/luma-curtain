import { createBrowserRouter, Navigate, Outlet } from 'react-router'
import { useEffect, useState } from 'react'
import { api } from './api'
import { AuthPage } from './views/AuthPage'
import { PairPage } from './views/PairPage'
import { DashboardPage } from './views/DashboardPage'
import { AdminPage } from './views/AdminPage'

export function Root() {
  const [session, setSession] = useState({ loading: true, user: null })
  const refresh = () => api('/auth/me').then(({ user }) => setSession({ loading: false, user })).catch(() => setSession({ loading: false, user: null }))
  useEffect(() => { refresh() }, [])
  if (session.loading) return <main className="center"><div className="loader" /></main>
  return <Outlet context={{ ...session, refresh }} />
}

export function Protected() {
  return <Outlet />
}

export const router = createBrowserRouter([{
  path: '/', Component: Root, children: [
    { index: true, Component: AuthPage },
    { path: 'pair', Component: PairPage },
    { path: 'dashboard', Component: DashboardPage },
    { path: 'admin', Component: AdminPage },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}])
