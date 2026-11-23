import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { download, thisMonth } from '../lib/hooks'
import { Card, PageHeader, Table, Spinner, Segmented, Field, useToast } from '../components/ui'

interface Report { title: string; columns: { key: string; label: string; kind?: string }[]; rows: Record<string, unknown>[]; footer: string[] }
const INFO: Record<string, { title: string; text: string; uses: 'period' | 'month' | 'lead' }> = {
  performance: { title: 'Performance', text: 'Counted leads, contacts, conversions, calls and follow-ups per BDE', uses: 'period' },
  allocation: { title: 'Allocation', text: 'Every run: who got how many, by which method', uses: 'period' },
  status: { title: 'Status and funnel', text: 'Leads by status now, and where leads given out were lost', uses: 'period' },
  followups: { title: 'Follow-ups', text: 'Due, done on time and overdue per person', uses: 'period' },
  attendance: { title: 'Attendance', text: 'Present, half days, absent, late, early, missing punch-out', uses: 'month' },
  sources: { title: 'Sources and uploads', text: 'Conversion % per lead source and upload file', uses: 'period' },
  'lead-history': { title: 'Lead history', text: 'Everything that happened to one lead', uses: 'lead' },
  finance: { title: 'Finance', text: 'Transactions with shares', uses: 'period' },
}

const fmt = (v: unknown, kind?: string) => v == null ? '—' : kind === 'money' ? `₹${(Number(v) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : kind === 'pct' ? `${Number(v).toFixed(1)}%` : typeof v === 'number' ? v.toLocaleString('en-IN') : String(v)

export function Reports() {
  const { user } = useAuth()
  const toast = useToast()
  const kinds = useQuery({ queryKey: ['report-kinds'], queryFn: () => api<string[]>('/reports') })
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams'), enabled: user?.role !== 'BDE' })
  const [kind, setKind] = useState('performance')
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month')
  const [month, setMonth] = useState(thisMonth())
  const [teamId, setTeamId] = useState('')
  const [leadId, setLeadId] = useState('')
  useEffect(() => { if (kinds.data && !kinds.data.includes(kind)) setKind(kinds.data[0]) }, [kinds.data, kind])
  const info = INFO[kind] ?? { title: kind, text: '', uses: 'period' as const }
  const query = { ...(info.uses === 'period' && { period }), ...(info.uses === 'month' && { month }), ...(info.uses === 'lead' && { leadId }), teamId }
  const r = useQuery({ queryKey: ['report', kind, query], queryFn: () => api<Report>(`/reports/${kind}`, { query }), enabled: info.uses !== 'lead' || !!leadId, retry: false })
  const exp = (format: string) => download(`/reports/${kind}`, { ...query, format }).catch((e) => toast(e.message, 'bad'))
  const canExport = user?.role !== 'BDE' || ['performance', 'followups', 'attendance'].includes(kind)

  return (
    <div className="fade-in">
      <PageHeader title="Reports" sub="Same numbers as the dashboards. Every export says which filters and period rule were used." />
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] items-start">
        <nav aria-label="Reports" className="card p-2 flex flex-col gap-0.5">
          {kinds.data?.map((k) => (
            <button key={k} onClick={() => setKind(k)} className={clsx('text-left px-3 py-2.5 rounded-xl cursor-pointer', kind === k ? 'bg-ink text-white' : 'hover:bg-soft')}>
              <b className="block text-[14px]">{INFO[k]?.title ?? k}</b><span className={clsx('text-[12px]', kind === k ? 'text-white/70' : 'text-faint')}>{INFO[k]?.text}</span>
            </button>
          ))}
        </nav>
        <Card title={r.data?.title ?? info.title} action={canExport && r.data ? <span className="flex gap-2">{['xlsx', 'csv', 'pdf'].map((f) => <button key={f} className="btn-ghost btn-sm" onClick={() => exp(f)}>{f === 'xlsx' ? 'Excel' : f.toUpperCase()}</button>)}</span> : undefined}>
          <div className="flex flex-wrap gap-2 mb-4 items-end">
            {info.uses === 'period' && <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}
            {info.uses === 'month' && <input type="month" className="field h-10 w-44" aria-label="Month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
            {info.uses === 'lead' && <Field label="Lead number"><input className="field h-10 w-40" inputMode="numeric" value={leadId} onChange={(e) => setLeadId(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 42" /></Field>}
            {user?.role !== 'BDE' && (teams.data?.length ?? 0) > 1 && kind !== 'lead-history' && <select className="select" aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
          </div>
          {r.isLoading && <Spinner label="Building the report" />}
          {r.error && <p className="text-bad text-[13.5px]">{(r.error as Error).message}</p>}
          {info.uses === 'lead' && !leadId && <p className="text-muted text-[13.5px]">The lead number is at the end of its address, e.g. …/leads/<b>42</b>.</p>}
          {r.data && (
            <>
              <Table head={r.data.columns.map((c) => c.label)} minWidth={Math.max(560, r.data.columns.length * 110)}>
                {r.data.rows.map((row, i) => <tr key={i} className="num">{r.data!.columns.map((c, j) => <td key={c.key} className={clsx(j === 0 && 'text-ink font-medium', c.kind && c.kind !== 'text' && 'text-right')}>{fmt(row[c.key], c.kind)}</td>)}</tr>)}
                {!r.data.rows.length && <tr><td colSpan={r.data.columns.length} className="text-center text-muted py-6">No data for this period</td></tr>}
              </Table>
              <ul className="mt-3 text-[12px] text-faint flex flex-col gap-0.5">{r.data.footer.map((f) => <li key={f}>{f}</li>)}</ul>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
