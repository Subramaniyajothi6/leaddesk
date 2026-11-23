import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction } from '../lib/hooks'
import { Card, PageHeader, Tabs, Segmented, Spinner, Empty, Badge, Avatar } from '../components/ui'
import { Modal } from '../components/Modal'
import { FollowUpPicker, emptyFollowUp, type FollowUpValue } from '../components/FollowUpPicker'
import { Icon } from '../components/Icon'

type Tab = 'overdue' | 'today' | 'upcoming' | 'all'
interface Row { id: number; type: 'CALL' | 'WHATSAPP' | 'MEETING' | 'TASK'; dueAt: string; reason: string | null; auto: boolean; overdue: boolean; owner: { id: number; name: string }; lead: { id: number; name: string; phone: string; status: { label: string; colour: string } } }
const TYPE = { CALL: 'Call', WHATSAPP: 'WhatsApp', MEETING: 'Meeting', TASK: 'Task' }

function weekStart(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

export function FollowUps() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('overdue')
  const [type, setType] = useState('')
  const [owner, setOwner] = useState('')
  const [view, setView] = useState<'list' | 'week'>('list')
  const [week, setWeek] = useState(weekStart())
  const weekEnd = new Date(week.getTime() + 7 * 86_400_000)
  const query = view === 'week' ? { from: week.toISOString(), to: weekEnd.toISOString(), type, userId: owner } : { tab, type, userId: owner }
  const q = useQuery({ queryKey: ['followups', query], queryFn: () => api<{ counts?: { overdue: number; today: number; upcoming: number }; rows: Row[] }>('/follow-ups', { query }), refetchInterval: 60_000 })
  const users = useQuery({ queryKey: ['users', 'BDE'], queryFn: () => api<{ id: number; name: string }[]>('/users', { query: { role: 'BDE', state: 'ACTIVE' } }), enabled: user?.role !== 'BDE' })
  const [move, setMove] = useState<Row | null>(null)
  const [cancel, setCancel] = useState<Row | null>(null)
  const c = q.data?.counts

  return (
    <div className="fade-in">
      <PageHeader title="Follow-ups" sub="A follow-up is done when you log a call or change the status on its lead.">
        {user?.role !== 'BDE' && <select className="select" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Everyone</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        <select className="select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'week', label: 'Week' }]} />
      </PageHeader>

      {view === 'list' ? (
        <>
          <Tabs label="When" value={tab} onChange={setTab} tabs={[{ value: 'overdue', label: 'Overdue', count: c?.overdue }, { value: 'today', label: 'Due today', count: c?.today }, { value: 'upcoming', label: 'Upcoming', count: c?.upcoming }, { value: 'all', label: 'All' }]} />
          {q.isLoading ? <Spinner /> : !q.data?.rows.length ? <Card><Empty title={tab === 'overdue' ? 'Nothing overdue' : 'Nothing here'}>{tab === 'overdue' ? 'Every follow-up is on time.' : 'Follow-ups you book appear here.'}</Empty></Card> : (
            <Card>
              <ul className="divide-y divide-line">
                {q.data.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={clsx('w-28 shrink-0 num text-[13px]', r.overdue ? 'text-bad font-semibold' : 'text-ink')}>{new Date(r.dueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <Badge tone={r.type === 'MEETING' ? 'accent' : 'neutral'}>{TYPE[r.type]}</Badge>
                    <span className="flex-1 min-w-48">
                      <Link to={`/leads/${r.lead.id}`} className="font-semibold text-ink hover:underline">{r.lead.name}</Link>
                      <span className="text-[12.5px] text-muted num"> · {r.lead.phone} · {r.lead.status.label}</span>
                      {r.reason && <span className="block text-[12.5px] text-muted">{r.reason}{r.auto && ' (automatic)'}</span>}
                    </span>
                    {user?.role !== 'BDE' && <span className="flex items-center gap-1.5 text-[13px]"><Avatar id={r.owner.id} name={r.owner.name} size={22} />{r.owner.name}</span>}
                    <span className="flex gap-1.5">
                      {r.type === 'CALL' && user?.role === 'BDE' && <Link to={`/leads/${r.lead.id}?call=1`} className="btn-primary btn-sm"><Icon name="phone" size={14} />Call</Link>}
                      <button className="btn-ghost btn-sm" onClick={() => setMove(r)}>Move</button>
                      <button className="btn-ghost btn-sm" onClick={() => setCancel(r)}>Cancel</button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <WeekView rows={q.data?.rows ?? []} week={week} setWeek={setWeek} loading={q.isLoading} />
      )}
      <MoveModal row={move} onClose={() => setMove(null)} />
      <CancelModal row={cancel} onClose={() => setCancel(null)} />
    </div>
  )
}

function WeekView({ rows, week, setWeek, loading }: { rows: Row[]; week: Date; setWeek: (d: Date) => void; loading: boolean }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 86_400_000)), [week])
  const todayKey = new Date().toDateString()
  return (
    <Card title={`Week of ${week.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`} action={
      <span className="flex gap-2"><button className="btn-ghost btn-sm" onClick={() => setWeek(new Date(week.getTime() - 7 * 86_400_000))}>← Previous</button><button className="btn-ghost btn-sm" onClick={() => setWeek(weekStart())}>This week</button><button className="btn-ghost btn-sm" onClick={() => setWeek(new Date(week.getTime() + 7 * 86_400_000))}>Next →</button></span>
    }>
      {loading ? <Spinner /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const list = rows.filter((r) => new Date(r.dueAt).toDateString() === d.toDateString())
            return (
              <div key={d.toISOString()} className={clsx('rounded-xl border p-2 min-h-32', d.toDateString() === todayKey ? 'border-accent bg-accent-soft/20' : 'border-line')}>
                <p className="text-[12px] font-semibold text-muted mb-1.5">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</p>
                <ul className="flex flex-col gap-1.5">
                  {list.map((r) => <li key={r.id}><Link to={`/leads/${r.lead.id}`} className={clsx('block rounded-lg px-2 py-1.5 text-[12px] hover:bg-soft', r.overdue ? 'bg-bad-soft text-bad' : 'bg-soft text-ink')}><b className="num">{new Date(r.dueAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</b> {r.lead.name}<span className="block text-faint">{TYPE[r.type]}</span></Link></li>)}
                  {!list.length && <li className="text-[12px] text-faint">—</li>}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function MoveModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [fu, setFu] = useState<FollowUpValue>(emptyFollowUp())
  const m = useAction(() => api(`/follow-ups/${row!.id}`, { method: 'PATCH', body: { dueAt: fu.dueAt } }), { success: 'Follow-up moved', invalidate: ['followups', 'lead', 'queue', 'dashboard'], onDone: () => { setFu(emptyFollowUp()); onClose() } })
  return (
    <Modal open={!!row} onClose={onClose} title={`Move follow-up · ${row?.lead.name ?? ''}`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}><FollowUpPicker value={fu} onChange={setFu} required /><button className="btn-primary self-end" disabled={!fu.dueAt || m.isPending}>Move</button></form>
    </Modal>
  )
}

function CancelModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [why, setWhy] = useState('')
  const m = useAction(() => api(`/follow-ups/${row!.id}`, { method: 'PATCH', body: { cancelReason: why } }), { success: 'Follow-up cancelled', invalidate: ['followups', 'lead', 'queue', 'dashboard'], onDone: () => { setWhy(''); onClose() } })
  return (
    <Modal open={!!row} onClose={onClose} title={`Cancel follow-up · ${row?.lead.name ?? ''}`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <label className="flex flex-col gap-1.5"><span className="label">Why? (kept in the history)</span><input className="field" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Customer travelling till next month" /></label>
        <button className="btn-primary self-end" disabled={!why.trim() || m.isPending}>Cancel follow-up</button>
      </form>
    </Modal>
  )
}
