import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { SkyPage, Brand } from './Login'
import { useToast } from '../components/ui'

/** Also the forced first-login change (§12.1): nothing else works until it is done. */
export function ChangePassword() {
  const { user, changePassword, logout } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rules = [
    { ok: f.next.length >= 8, text: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(f.next), text: 'A letter' },
    { ok: /\d/.test(f.next), text: 'A number' },
    { ok: !!f.next && f.next === f.again, text: 'Both new passwords match' },
  ]
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!rules.every((r) => r.ok)) return
    setBusy(true); setError(null)
    try {
      await changePassword(f.current, f.next)
      toast('Password changed')
      nav('/', { replace: true })
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not change the password') } finally { setBusy(false) }
  }
  return (
    <SkyPage>
      <Brand />
      <h1 className="display text-center text-[38px] leading-none">{user?.mustChangePassword ? 'Choose your password' : 'Change password'}</h1>
      <p className="text-center text-muted mt-3 mb-6">{user?.mustChangePassword ? 'You signed in with a temporary password. Pick your own to continue.' : 'Other devices will be signed out.'}</p>
      <form onSubmit={submit} className="card p-6 flex flex-col gap-4">
        {(['current', 'next', 'again'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1.5">
            <span className="label">{{ current: 'Current password', next: 'New password', again: 'New password again' }[k]}</span>
            <input className="field" type="password" autoComplete={k === 'current' ? 'current-password' : 'new-password'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </label>
        ))}
        <ul className="grid grid-cols-2 gap-1.5 text-[12.5px]">
          {rules.map((r) => <li key={r.text} className={r.ok ? 'text-ok font-medium' : 'text-faint'}>{r.ok ? '✓' : '○'} {r.text}</li>)}
        </ul>
        {error && <p role="alert" className="text-[13.5px] text-bad bg-bad-soft rounded-lg px-3 py-2">{error}</p>}
        <button className="btn-primary h-11" disabled={busy || !f.current || !rules.every((r) => r.ok)}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="text-[13px] text-muted hover:text-ink cursor-pointer" onClick={() => (user?.mustChangePassword ? logout().then(() => nav('/login')) : nav(-1))}>{user?.mustChangePassword ? 'Sign out instead' : 'Cancel'}</button>
      </form>
    </SkyPage>
  )
}
