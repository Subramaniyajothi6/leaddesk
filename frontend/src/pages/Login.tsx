import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Icon } from '../components/Icon'

export function SkyPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh sky grain grid place-items-center px-4 py-10 overflow-hidden">
      <div className="relative z-10 w-full max-w-[420px] fade-in">{children}</div>
    </div>
  )
}

export function Brand() {
  return (
    <div className="flex items-center justify-center gap-2.5 font-bold text-[18px] text-ink mb-5">
      <span className="size-8 rounded-[9px] grid place-items-center" style={{ background: 'linear-gradient(140deg,#ff86c2,#e11d48)' }} aria-hidden>
        <span className="size-3 bg-white" style={{ borderRadius: '3px 3px 3px 8px' }} />
      </span>
      LeadDesk
    </div>
  )
}

const DEMO = [
  { label: 'Admin', login: 'DEMO-ADM', password: 'Demo@1234' },
  { label: 'Team Lead', login: 'DEMO-TL1', password: 'Demo@1234' },
  { label: 'BDE', login: 'DEMO-B01', password: 'Demo@1234' },
]

export function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ login: '', password: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const u = await login(form.login.trim(), form.password)
      nav(u.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.')
    } finally { setBusy(false) }
  }

  return (
    <SkyPage>
      <Brand />
      <h1 className="display text-center text-[44px] leading-none">Welcome back</h1>
      <p className="text-center text-muted mt-3 mb-6">Sign in with your email or employee code.</p>
      <form onSubmit={submit} className="card p-6 shadow-[0_24px_60px_-28px_rgba(159,18,57,.45)] flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="label">Email or employee code</span>
          <input className="field" autoComplete="username" autoFocus required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Password</span>
          <span className="relative">
            <input className="field pr-16" type={show ? 'text' : 'password'} autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[12.5px] font-semibold text-accent-ink px-2 py-1 cursor-pointer" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        {error && <p role="alert" className="text-[13.5px] text-bad bg-bad-soft rounded-lg px-3 py-2">{error}</p>}
        <button className="btn-primary h-11 text-[15px]" disabled={busy || !form.login || !form.password}>{busy ? 'Signing in…' : <>Sign in <Icon name="arrow" size={16} /></>}</button>
      </form>
      {import.meta.env.DEV && (
        <div className="mt-5 text-center">
          <p className="text-[12.5px] text-muted mb-2">Development only · fill a demo account</p>
          <div className="flex justify-center gap-2 flex-wrap">
            {DEMO.map((d) => <button key={d.label} type="button" className="btn-ghost btn-sm bg-white/70" onClick={() => setForm({ login: d.login, password: d.password ?? '' })}>{d.label}</button>)}
          </div>
        </div>
      )}
    </SkyPage>
  )
}
