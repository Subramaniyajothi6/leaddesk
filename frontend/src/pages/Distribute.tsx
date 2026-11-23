import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction } from '../lib/hooks'
import { int, pct } from '../lib/format'
import { Card, PageHeader, Tabs, Table, Field, Badge, Spinner, Avatar } from '../components/ui'
import { Modal } from '../components/Modal'
import { History } from './Allocation'

type Method = 'SMART' | 'EQUAL' | 'WORKLOAD'
interface Team { id: number; name: string; autoDistribute: boolean; method: string; poolCount: number }
interface Elig { teamId: number; pool: number; bdes: { userId: number; name: string; open: number; max: number; left: number; givenToday: number; maxPerDay: number; fresh: number; perf: number; notEligibleToday: string | null }[] }
interface Preview { method: Method; inPool: number; willGive: number; perBde: { userId: number; name: string; get: number; openAfter: number; max: number; why: { firstScore?: number; perf?: number; matched: string[]; startLoad: string } | null }[]; skipped: { userId: number; name: string; reason: string }[]; message: string | null }

const METHODS: { value: Method; label: string; text: string }[] = [
  { value: 'SMART', label: 'Smart', text: 'Room left first, then matching and performance. Never over a max.' },
  { value: 'EQUAL', label: 'Equal', text: 'Same number each; the extra lead rotates.' },
  { value: 'WORKLOAD', label: 'Workload', text: 'Fill whoever has the fewest open leads first.' },
]

export function Distribute() {
  const { user } = useAuth()
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/teams') })
  const [teamId, setTeamId] = useState<number | null>(null)
  useEffect(() => { if (!teamId && teams.data?.length) setTeamId(teams.data[0].id) }, [teams.data, teamId])
  const team = teams.data?.find((t) => t.id === teamId)
  const [tab, setTab] = useState<'auto' | 'manual' | 'history'>('auto')
  return (
    <div className="fade-in">
      <PageHeader title="Team pool" sub={team ? `${team.name} · ${int(team.poolCount)} leads waiting for a BDE` : ' '}>
        {(teams.data?.length ?? 0) > 1 && <select className="select" aria-label="Team" value={teamId ?? ''} onChange={(e) => setTeamId(Number(e.target.value))}>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      </PageHeader>
      <Tabs label="Distribute" value={tab} onChange={setTab} tabs={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }, { value: 'history', label: 'History' }]} />
      {!team ? <Spinner /> : tab === 'auto' ? <Auto team={team} /> : tab === 'manual' ? <Manual team={team} /> : <History teamScoped={user?.role === 'TEAM_LEAD'} />}
    </div>
  )
}

function Auto({ team }: { team: Team }) {
  const [method, setMethod] = useState<Method>((['SMART', 'EQUAL', 'WORKLOAD'].includes(team.method) ? team.method : 'SMART') as Method)
  const [count, setCount] = useState('')
  const body = { teamId: team.id, method, ...(Number(count) > 0 && { count: Number(count) }) }
  const preview = useQuery({ queryKey: ['dist-preview', JSON.stringify(body)], queryFn: () => post<Preview>('/allocation/distribute/preview', body), retry: false })
  const give = useAction(() => post<Preview & { given: number }>('/allocation/distribute', body), { success: (r) => `${r.given} leads given out${r.message ? ` · ${r.message}` : ''}`, invalidate: ['dist-preview', 'teams', 'eligibility', 'leads', 'dashboard', 'runs', 'bulk'] })
  const toggle = useAction((v: Partial<Team>) => api(`/teams/${team.id}`, { method: 'PATCH', body: v }), { success: 'Saved', invalidate: ['teams'] })
  const p = preview.data
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
      <Card title="How to give them out">
        <div className="flex flex-col gap-2 mb-4">
          {METHODS.map((m) => (
            <label key={m.value} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer', method === m.value ? 'border-ink bg-soft' : 'border-line hover:bg-soft')}>
              <input type="radio" name="m" checked={method === m.value} onChange={() => setMethod(m.value)} />
              <span><b className="text-ink">{m.label}</b><span className="block text-[13px] text-muted">{m.text}</span></span>
            </label>
          ))}
        </div>
        <Field label="How many" hint="Empty = as many as fit"><input className="field" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder={`All (${team.poolCount})`} /></Field>
        <div className="mt-5 pt-4 border-t border-line flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-[13.5px]"><span><b className="text-ink">Auto-refill</b><span className="block text-muted text-[12.5px]">When a BDE runs out of fresh leads, give more from this pool automatically</span></span>
            <input type="checkbox" className="size-5" checked={team.autoDistribute} onChange={(e) => toggle.mutate({ autoDistribute: e.target.checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-[13.5px]"><span><b className="text-ink">Team’s default method</b><span className="block text-muted text-[12.5px]">Used by auto-refill and recycled leads</span></span>
            <select className="select" value={team.method} onChange={(e) => toggle.mutate({ method: e.target.value })}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        </div>
      </Card>
      <Card title="Preview" note="Who gets how many, and why" strong>
        {preview.isLoading && <Spinner label="Working it out" />}
        {preview.error && <p className="text-bad text-[13.5px]">{(preview.error as Error).message}</p>}
        {p && (
          <>
            <p className="mb-3 text-[14px]"><b className="text-ink">{int(p.willGive)}</b> of {int(p.inPool)} leads will be given out.</p>
            <Table head={['BDE', 'Gets', 'Load after', 'Why']} minWidth={480}>
              {p.perBde.map((b) => (
                <tr key={b.userId} className="num">
                  <td><span className="flex items-center gap-2"><Avatar id={b.userId} name={b.name} size={26} /><b className="text-ink">{b.name}</b></span></td>
                  <td><b className="text-ink text-[15px]">{b.get}</b></td><td>{b.openAfter} / {b.max}</td>
                  <td className="text-[12.5px] text-muted">{b.why ? [`started at ${b.why.startLoad}`, b.why.firstScore != null && `score ${b.why.firstScore}`, b.why.perf != null && `performance ${b.why.perf}`, b.why.matched.length && `matched ${b.why.matched.join(', ')}`].filter(Boolean).join(' · ') : '—'}</td>
                </tr>
              ))}
            </Table>
            {p.skipped.length > 0 && <div className="mt-3"><p className="kicker mb-1.5">Skipped</p><ul className="flex flex-wrap gap-2">{p.skipped.map((s) => <li key={s.userId}><Badge tone="warn">{s.name}: {s.reason}</Badge></li>)}</ul></div>}
            {p.message && <p className="mt-3 text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2">{p.message}</p>}
          </>
        )}
        <button className="btn-primary w-full mt-4" disabled={!p?.willGive || give.isPending} onClick={() => give.mutate(undefined)}>{give.isPending ? 'Giving out…' : `Give ${int(p?.willGive ?? 0)} leads`}</button>
      </Card>
    </div>
  )
}

function Manual({ team }: { team: Team }) {
  const elig = useQuery({ queryKey: ['eligibility', team.id], queryFn: () => api<Elig>('/allocation/eligibility', { query: { teamId: team.id } }) })
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [reason, setReason] = useState('')
  const [needReason, setNeedReason] = useState<string | null>(null)
  const [editMax, setEditMax] = useState<Elig['bdes'][number] | null>(null)
  const rows = Object.entries(counts).map(([u, c]) => ({ userId: Number(u), count: Number(c) })).filter((r) => r.count > 0)
  const total = rows.reduce((a, r) => a + r.count, 0)
  const give = useAction(() => post<{ rows: { name: string; given: number }[] }>('/allocation/assign-counts', { teamId: team.id, counts: rows, ...(reason.trim() && { overMaxReason: reason.trim() }) }), {
    success: (r) => r.rows.map((x) => `${x.name} +${x.given}`).join(' · '), invalidate: ['eligibility', 'teams', 'leads', 'dashboard', 'runs', 'bulk'],
    onDone: () => { setCounts({}); setReason(''); setNeedReason(null) },
    onError: (e) => { if (e instanceof ApiError && (e.details as { needsReason?: boolean })?.needsReason) { setNeedReason(e.message); return true } },
  })
  if (elig.isLoading) return <Spinner />
  const e = elig.data!
  return (
    <Card title="Type how many each BDE gets" note={`The best ${int(e.pool)} leads in the pool are taken first. To pick particular leads, select them in Leads.`}>
      <Table head={['BDE', 'Open / max', 'Fresh', 'Given today', 'Performance', 'Today', 'Give']} minWidth={760}>
        {e.bdes.map((b) => (
          <tr key={b.userId} className="num">
            <td><span className="flex items-center gap-2"><Avatar id={b.userId} name={b.name} size={26} /><b className="text-ink">{b.name}</b></span></td>
            <td>{b.open} / {b.max} <button className="ml-1 text-[12px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => setEditMax(b)}>Edit max</button></td>
            <td className={clsx(b.fresh <= 2 && 'text-bad font-semibold')}>{b.fresh}</td><td>{b.givenToday} / {b.maxPerDay}</td><td>{pct(b.perf * 100, 0)}</td>
            <td>{b.notEligibleToday ? <Badge tone="warn">{b.notEligibleToday}</Badge> : <Badge tone="ok">Can get leads</Badge>}</td>
            <td><input className="field h-9 w-20" type="number" min={0} aria-label={`Leads for ${b.name}`} value={counts[b.userId] ?? ''} onChange={(ev) => { setCounts({ ...counts, [b.userId]: ev.target.value }); setNeedReason(null) }} /></td>
          </tr>
        ))}
      </Table>
      <p className="text-[12.5px] text-faint mt-2">Manual giving may go over a max or reach someone who isn’t in today, but over the max needs a reason, which is saved.</p>
      {needReason && <div className="mt-4 flex flex-col gap-2"><p className="text-warn bg-warn-soft rounded-lg px-3 py-2 text-[13.5px] font-semibold">{needReason}</p><Field label="Reason (saved in the audit log)"><input className="field" value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field></div>}
      <div className="flex justify-end mt-4"><button className="btn-primary" disabled={!total || give.isPending || (!!needReason && !reason.trim())} onClick={() => give.mutate(undefined)}>Give {total} leads</button></div>
      <EditMax bde={editMax} onClose={() => setEditMax(null)} />
    </Card>
  )
}

function EditMax({ bde, onClose }: { bde: Elig['bdes'][number] | null; onClose: () => void }) {
  const [v, setV] = useState({ max: '', perDay: '' })
  useEffect(() => { if (bde) setV({ max: String(bde.max), perDay: String(bde.maxPerDay) }) }, [bde])
  const m = useAction(() => api('/limits', { method: 'PUT', body: { scope: 'USER', scopeId: bde!.userId, maxOpen: Number(v.max) || null, maxPerDay: Number(v.perDay) || null } }), { success: 'Limits saved', invalidate: ['eligibility', 'dashboard'], onDone: onClose })
  return (
    <Modal open={!!bde} onClose={onClose} title={`Limits for ${bde?.name ?? ''}`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <Field label="Max open leads at one time"><input className="field" type="number" min={1} value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></Field>
        <Field label="Max new leads per day"><input className="field" type="number" min={1} value={v.perDay} onChange={(e) => setV({ ...v, perDay: e.target.value })} /></Field>
        <button className="btn-primary self-end" disabled={m.isPending}>Save</button>
      </form>
    </Modal>
  )
}
