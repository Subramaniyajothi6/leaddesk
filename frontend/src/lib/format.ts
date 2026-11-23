/** Display helpers. Numbers arrive raw from the API (paise, counts); formatting happens only here. */
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export const int = (n: number | null | undefined) => (n == null ? '—' : inrFmt.format(n))
export const inr = (paise: number | null | undefined) => (paise == null ? '—' : `₹${inrFmt.format(Math.round(paise / 100))}`)
export const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}%`)
export function minutes(m: number | null | undefined) {
  if (m == null) return '—'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
export function time(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
export function delta(cur: number | null | undefined, prev: number | null | undefined, unit = '') {
  if (cur == null || prev == null) return null
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return { text: `same as last period`, dir: 0 as const }
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit} vs last period`, dir: (d > 0 ? 1 : -1) as 1 | -1 }
}
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
const AV = ['#e11d48', '#0f8f80', '#7c3aed', '#c2560f', '#2563eb', '#1b8a4a', '#be185d', '#475569']
export const avatarColor = (id: number) => AV[id % AV.length]
