import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post } from '../lib/api'
import { useSources } from '../lib/refdata'
import { useAction } from '../lib/hooks'
import { int, ago } from '../lib/format'
import { Card, PageHeader, Tabs, Table, Field, Badge, Spinner, Empty } from '../components/ui'
import { Modal } from '../components/Modal'

interface Team { id: number; name: string; state: string; poolCount: number; members: { id: number; state: string }[]; teamLead: { name: string } | null }
interface PreviewRow { teamId: number; team: string; inPoolNow: number; willReceive: number; poolAfter: number }
interface Run { id: number; level: 'TEAM' | 'BDE'; method: string; teamId: number | null; leadCount: number; createdAt: string; startedByName: string }
interface Bulk { id: number; kind: string; leadCount: number; at: string; undoneAt: string | null; runId: number | null }

export function Allocation() {
  const [tab, setTab] = useState<'give' | 'history'>('give')
  return (
    <div className="fade-in">
      <PageHeader title="Allocation" sub="Company pool → teams. Team Leads then give leads to their BDEs."><Link to="/distribute" className="btn-ghost">Team pools → BDEs</Link></PageHeader>
      <Tabs label="Allocation" value={tab} onChange={setTab} tabs={[{ value: 'give', label: 'Give leads to teams' }, { value: 'history', label: 'History and undo' }]} />
      {tab === 'give' ? <GiveToTeams /> : <History />}
    </div>
  )
}

function GiveToTeams() {
  const [sp] = useSearchParams()
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/teams') })
  const batches = useQuery({ queryKey: ['imports'], queryFn: () => api<{ id: number; fileName: string; accepted: number }[]>('/imports') })
  const pool = useQuery({ queryKey: ['leads', 'company-pool-count'], queryFn: () => api<{ total: number }>('/leads', { query: { view: 'company_pool', pageSize: 1 } }) })
  const sources = useSources()
  const active = useMemo(() => (teams.data ?? []).filter((t) => t.state === 'ACTIVE'), [teams.data])
  const [f, setF] = useState({ batchId: sp.get('batchId') ?? '', sourceId: '', minScore: '', count: sp.get('count') ?? '', method: 'EQUAL' as 'EQUAL' | 'CAPACITY' | 'MANUAL', alsoToBdes: false })
  const [picked, setPicked] = useState<number[]>([])
  const [manual, setManual] = useState<Record<string, string>>({})
  useEffect(() => { if (active.length && !picked.length) setPicked(active.map((t) => t.id)) }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = Number(f.count || pool.data?.total || 0)
  const body = {
    teamIds: picked, count: Math.max(1, Math.min(20_000, count)), method: f.method, alsoToBdes: f.alsoToBdes,
    ...(f.batchId && { batchId: Number(f.batchId) }), ...(f.sourceId && { sourceId: Number(f.sourceId) }), ...(f.minScore && { minScore: Number(f.minScore) }),
    ...(f.method === 'MANUAL' && { manual: Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0])) }),
  }
  const key = JSON.stringify(body)
  const preview = useQuery({ queryKey: ['alloc-preview', key], queryFn: () => post<{ selected: number; rows: PreviewRow[] }>('/allocation/teams/preview', body), enabled: picked.length > 0 && count > 0, retry: false })
  const run = useAction(() => post<{ given: number; toBdes: { teamId: number; given: number; message: string | null }[] }>('/allocation/teams', body), {
    success: (r) => `${int(r.given)} leads given to ${picked.length} team(s)${r.toBdes.length ? ` · ${r.toBdes.reduce((a, x) => a + x.given, 0)} passed on to BDEs` : ''}`,
    invalidate: ['alloc-preview', 'teams', 'leads', 'dashboard', 'runs'],
  })
  const total = preview.data?.rows.reduce((a, r) => a + r.willReceive, 0) ?? 0

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start">
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); run.mutate(undefined) }}>
        <Card title="1. Which leads" note={pool.data ? `${int(pool.data.total)} leads in the company pool` : undefined}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Upload"><select className="field" value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })}><option value="">All uploads</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.fileName} ({int(b.accepted)})</option>)}</select></Field>
            <Field label="Source"><select className="field" value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })}><option value="">Any</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Score at least"><input className="field" type="number" value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} placeholder="Any" /></Field>
            <Field label="How many to give"><input className="field" type="number" min={1} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} placeholder={pool.data ? `All (${pool.data.total})` : ''} /></Field>
          </div>
          <p className="text-[12.5px] text-faint mt-3">Highest score first, then oldest first.</p>
        </Card>
        <Card title="2. How to split">
          <div className="flex flex-col gap-2">
            {([['EQUAL', 'Equal', 'Same number each. The extra lead rotates between teams.'], ['CAPACITY', 'By free capacity', 'More to teams with more room under their BDEs’ max.'], ['MANUAL', 'Manual', 'Type a number for each team.']] as const).map(([v, l, d]) => (
              <label key={v} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer', f.method === v ? 'border-ink bg-soft' : 'border-line hover:bg-soft')}>
                <input type="radio" name="method" checked={f.method === v} onChange={() => setF({ ...f, method: v })} />
                <span><b className="text-ink block">{l}</b><span className="text-[13px] text-muted">{d}</span></span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="3. Teams">
          <div className="flex flex-col gap-1">
            {active.map((t) => (
              <label key={t.id} className="flex items-center gap-3 min-h-11 text-[14px]">
                <input type="checkbox" checked={picked.includes(t.id)} onChange={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))} />
                <span className="flex-1"><b className="text-ink">{t.name}</b> <span className="text-muted text-[13px]">· {t.members.filter((m) => m.state === 'ACTIVE').length} BDEs · pool {t.poolCount}{!t.teamLead && ' · no Team Lead'}</span></span>
                {f.method === 'MANUAL' && picked.includes(t.id) && <input className="field h-9 w-24" type="number" min={0} aria-label={`Leads for ${t.name}`} value={manual[t.id] ?? ''} onChange={(e) => setManual({ ...manual, [t.id]: e.target.value })} />}
              </label>
            ))}
            {!active.length && <p className="text-muted text-[13.5px]">No teams yet. Create them in Teams &amp; people.</p>}
          </div>
        </Card>
      </form>

      <Card title="Preview" note="Nothing is saved until you confirm" strong className="lg:sticky lg:top-24">
        {preview.isFetching && !preview.data && <Spinner label="Working out the split" />}
        {preview.error && <p role="alert" className="text-bad text-[13.5px] bg-bad-soft rounded-lg px-3 py-2">{(preview.error as Error).message}</p>}
        {preview.data && (
          <>
            <p className="text-[14px] mb-3">{int(total)} leads · {f.method === 'EQUAL' ? 'Equal' : f.method === 'CAPACITY' ? 'By free capacity' : 'Manual'} · {picked.length} team(s){preview.data.selected < count && <span className="text-warn"> · only {int(preview.data.selected)} match the filters</span>}</p>
            <Table head={['Team', 'In team pool now', 'Will receive', 'Team pool after']} minWidth={420}>
              {preview.data.rows.map((r) => <tr key={r.teamId} className="num"><td className="text-ink font-medium">{r.team}</td><td>{r.inPoolNow}</td><td><b className="text-ink">{r.willReceive}</b></td><td>{r.poolAfter}</td></tr>)}
              <tr className="num font-semibold text-ink"><td>Total</td><td>{preview.data.rows.reduce((a, r) => a + r.inPoolNow, 0)}</td><td>{total}</td><td>{preview.data.rows.reduce((a, r) => a + r.poolAfter, 0)}</td></tr>
            </Table>
            <p className="text-[12.5px] text-muted bg-soft rounded-lg px-3 py-2 mt-3">Leads above a team’s free capacity are not lost: they wait in that team’s pool until a BDE has room.</p>
            <label className="flex items-center gap-2 text-[13.5px] mt-3"><input type="checkbox" checked={f.alsoToBdes} onChange={(e) => setF({ ...f, alsoToBdes: e.target.checked })} />Also give them to BDEs now, with each team’s own method</label>
          </>
        )}
        <button className="btn-primary w-full mt-4" disabled={!total || run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? 'Allocating…' : `Allocate ${int(total)} leads`}</button>
        <MovePool teams={active} />
      </Card>
    </div>
  )
}

function MovePool({ teams }: { teams: Team[] }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ from: '', to: '', count: '' })
  const m = useAction(() => post<{ moved: number }>('/allocation/move-pool', { fromTeamId: Number(f.from), toTeamId: Number(f.to), count: Number(f.count) }), { success: (r) => `${r.moved} leads moved`, invalidate: ['teams', 'alloc-preview', 'runs'], onDone: () => setOpen(false) })
  return (
    <>
      <button className="w-full mt-2 text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => setOpen(true)}>Move leads between team pools…</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Move leads between team pools">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
          <p className="text-[13px] text-muted">Only leads still waiting in a team pool move. A lead a BDE is working is never moved.</p>
          <Field label="From"><select className="field" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}><option value="">Choose…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name} (pool {t.poolCount})</option>)}</select></Field>
          <Field label="To"><select className="field" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Choose…</option>{teams.filter((t) => String(t.id) !== f.from).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="How many"><input className="field" type="number" min={1} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
          <button className="btn-primary self-end" disabled={!f.from || !f.to || !Number(f.count) || m.isPending}>Move</button>
        </form>
      </Modal>
    </>
  )
}

export function History({ teamScoped }: { teamScoped?: boolean }) {
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<{ total: number; rows: Run[] }>('/allocation/runs') })
  const bulk = useQuery({ queryKey: ['bulk'], queryFn: () => api<Bulk[]>('/allocation/bulk') })
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/teams') })
  const [openRun, setOpenRun] = useState<number | null>(null)
  const detail = useQuery({ queryKey: ['run', openRun], queryFn: () => api<{ assignments: { lead: { id: number; name: string }; to: string; reason: Record<string, unknown>; endReason: string | null }[] }>(`/allocation/runs/${openRun}`), enabled: !!openRun })
  const undo = useAction((id: number) => post<{ restored: number; skipped: number[] }>(`/allocation/bulk/${id}/undo`), {
    success: (r) => `${r.restored} leads put back${r.skipped.length ? ` · ${r.skipped.length} skipped (moved again since)` : ''}`, invalidate: ['bulk', 'runs', 'leads', 'teams', 'dashboard'],
  })
  const teamName = (id: number | null) => (id ? teams.data?.find((t) => t.id === id)?.name ?? `Team ${id}` : 'Teams')
  const bulkByRun = new Map((bulk.data ?? []).filter((b) => b.runId).map((b) => [b.runId!, b]))
  if (runs.isLoading) return <Spinner />
  return (
    <Card title="Every allocation" note={`${int(runs.data?.total)} runs · undo is possible for 30 days, for leads nobody moved since`}>
      {!runs.data?.rows.length ? <Empty icon="split" title="Nothing allocated yet" /> : (
        <Table head={['When', 'What', 'Method', 'Leads', 'By', '']}>
          {runs.data.rows.map((r) => {
            const b = bulkByRun.get(r.id)
            return (
              <tr key={r.id} className="num">
                <td className="text-muted whitespace-nowrap">{ago(r.createdAt)}</td>
                <td><button className="font-semibold text-ink hover:underline cursor-pointer text-left" onClick={() => setOpenRun(r.id)}>{r.level === 'TEAM' ? 'Company pool → teams' : `${teamName(r.teamId)} → BDEs`}</button></td>
                <td><Badge>{r.method.replace('_', ' ').toLowerCase()}</Badge></td><td>{int(r.leadCount)}</td><td>{r.startedByName}</td>
                <td className="text-right">{b && (b.undoneAt ? <span className="text-faint text-[12.5px]">Undone</span> : !teamScoped || r.level === 'BDE' ? <button className="btn-ghost btn-sm" disabled={undo.isPending} onClick={() => undo.mutate(b.id)}>Undo</button> : null)}</td>
              </tr>
            )
          })}
        </Table>
      )}
      <Modal open={!!openRun} onClose={() => setOpenRun(null)} title="Who got which lead, and why" wide>
        {detail.isLoading ? <Spinner /> : (
          <Table head={['Lead', 'Given to', 'Why', 'Now']} minWidth={560}>
            {detail.data?.assignments.map((a, i) => (
              <tr key={i}><td className="text-ink">{a.lead.name}</td><td>{a.to}</td>
                <td className="text-[12.5px] text-muted">{Object.entries(a.reason).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}</td>
                <td>{a.endReason ? <Badge>{a.endReason.toLowerCase().replace('_', ' ')}</Badge> : <Badge tone="ok">current</Badge>}</td></tr>
            ))}
          </Table>
        )}
      </Modal>
    </Card>
  )
}
