import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, post, refreshSession, setAccessToken, onLostSession, type Session, type SessionUser } from './api'

interface AuthState {
  user: SessionUser | null
  ready: boolean
  login: (login: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  const apply = useCallback((s: Session | null) => {
    setAccessToken(s?.accessToken ?? null)
    setUser(s?.user ?? null)
  }, [])

  // Restore the session from the refresh cookie on load; renew the access token before it expires.
  useEffect(() => {
    refreshSession().then(apply).finally(() => setReady(true))
    onLostSession(() => { apply(null); qc.clear() })
  }, [apply, qc])
  useEffect(() => {
    if (!user) return
    const t = setInterval(() => { refreshSession().then((s) => s ? apply(s) : (apply(null), qc.clear())) }, 12 * 60_000)
    return () => clearInterval(t)
  }, [user, apply, qc])

  const value = useMemo<AuthState>(() => ({
    user, ready,
    login: async (login, password) => { const s = await post<Session>('/auth/login', { login, password }); apply(s); return s.user },
    logout: async () => { await post('/auth/logout').catch(() => {}); apply(null); qc.clear() },
    changePassword: async (currentPassword, newPassword) => { const s = await api<Session>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }); apply(s) },
  }), [user, ready, apply, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

export const roleLabel = { ADMIN: 'Admin', TEAM_LEAD: 'Team Lead', BDE: 'BDE' } as const
