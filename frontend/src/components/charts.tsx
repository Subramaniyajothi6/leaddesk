import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import clsx from 'clsx'
import { int } from '../lib/format'

export interface FunnelStep { label: string; count: number; keptPct: number | null; biggestLoss: boolean }

/** Where leads are lost: each step's share of the first, and what share of the step before moved on. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = Math.max(1, steps[0]?.count ?? 1)
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <li key={s.label}>
          {i > 0 && <p className={clsx('text-[12px] pl-[132px] max-sm:pl-[104px] -mb-0.5', s.biggestLoss ? 'text-accent-ink font-semibold' : 'text-faint')}>↓ {s.keptPct ?? 0}% moved on{s.biggestLoss && ' · biggest loss'}</p>}
          <div className="grid grid-cols-[124px_1fr_64px] max-sm:grid-cols-[96px_1fr_56px] items-center gap-2 text-[13px]">
            <span className="truncate">{s.label}</span>
            <span className="h-6 rounded-md bg-soft overflow-hidden" aria-hidden><i className={clsx('block h-full rounded-md', s.biggestLoss ? 'bg-accent' : 'bg-accent/45')} style={{ width: `${Math.max(1, (s.count / top) * 100)}%` }} /></span>
            <b className="num text-right text-ink">{int(s.count)}</b>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function WeeklyBars({ data, target }: { data: { weekEnding: string; conversions: number }[]; target?: number | null }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.weekEnding + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }))
  return (
    <div className="h-48" role="img" aria-label={`Conversions per week: ${data.map((d) => d.conversions).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebe3e6" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#7d6b73' }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#7d6b73' }} />
          <Tooltip cursor={{ fill: '#fde8ee' }} contentStyle={{ borderRadius: 12, border: '1px solid #ebe3e6', fontSize: 12 }} formatter={(v) => [v, 'Conversions']} />
          {target ? <ReferenceLine y={target} stroke="#1c0a12" strokeDasharray="4 4" label={{ value: 'target', position: 'insideTopRight', fontSize: 11, fill: '#6b5a62' }} /> : null}
          <Bar dataKey="conversions" fill="#e11d48" radius={[6, 6, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Horizontal bars for a share (e.g. conversion % by source). */
export function ShareBars({ rows }: { rows: { label: string; value: number | null; sub: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0))
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[96px_1fr_110px] items-center gap-2 text-[13px]">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded-full bg-soft overflow-hidden" aria-hidden><i className="block h-full rounded-full bg-accent/70" style={{ width: `${((r.value ?? 0) / max) * 100}%` }} /></span>
          <span className="text-right"><b className="num text-ink">{r.value == null ? '—' : `${r.value.toFixed(1)}%`}</b> <span className="text-faint">{r.sub}</span></span>
        </li>
      ))}
    </ul>
  )
}

/** Monthly revenue vs investment (confirmed only). Values arrive in paise. */
export function MonthlyMoney({ data }: { data: { month: string; revenuePaise: number; investmentPaise: number }[] }) {
  const rows = data.map((d) => ({ label: new Date(d.month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' }), Revenue: d.revenuePaise / 100, Investment: d.investmentPaise / 100 }))
  return (
    <div className="h-56" role="img" aria-label="Revenue and investment per month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebe3e6" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#7d6b73' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#7d6b73' }} tickFormatter={(v) => (v >= 100000 ? `${v / 100000}L` : v >= 1000 ? `${v / 1000}k` : v)} />
          <Tooltip cursor={{ fill: '#fde8ee' }} contentStyle={{ borderRadius: 12, border: '1px solid #ebe3e6', fontSize: 12 }} formatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} />
          <Bar dataKey="Revenue" fill="#e11d48" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Investment" fill="#1c0a12" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
