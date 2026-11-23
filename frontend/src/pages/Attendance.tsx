import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAction, thisMonth, today } from '../lib/hooks'
import { time, pct } from '../lib/format'
import { Card, PageHeader, Tabs, Table, Field, Badge, Spinner, Empty, Kpi, Avatar } from '../components/ui'
import { Modal } from '../components/Modal'

type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF' | null
interface Day { date: string; punchInAt: string | null; punchOutAt: string | null; working: boolean; dayStatus: DayStatus; workedMin: number; late: boolean; earlyOut: boolean; missingPunchOut: boolean }
interface Summary { present: number; halfDay: number; absent: number; leave: number; holiday: number; weekOff: number; late: number; earlyOut: number; missingPunchOut: number; attendanceBp: number | null }
interface Correction { id: number; date: string; user: string; reason: string; state: 'PENDING' | 'APPROVED' | 'REJECTED'; before: { punchInAt: string | null; punchOutAt: string | null }; after: { punchInAt: string | null; punchOutAt: string | null }; at: string }

const ST: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: 'Present', cls: 'bg-ok-soft text-ok' }, HALF_DAY: { label: 'Half day', cls: 'bg-warn-soft text-warn' }, ABSENT: { label: 'Absent', cls: 'bg-bad-soft text-bad' },
  LEAVE: { label: 'Leave', cls: 'bg-soft text-muted' }, HOLIDAY: { label: 'Holiday', cls: 'bg-soft text-muted' }, WEEK_OFF: { label: 'Week-off', cls: 'bg-soft text-faint' },
}

export function Attendance() {
  const { user } = useAuth()
  return user?.role === 'BDE' ? <MyAttendance /> : <TeamAttendance />
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="month" className="field h-10 w-44" aria-label="Month" value={value} max={thisMonth()} onChange={(e) => e.target.value && onChange(e.target.value)} />
}

function SummaryRow({ s }: { s: Summary }) {
  return (
    <section className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7 mb-5" aria-label="Month summary">
      <Kpi label="Attendance" value={s.attendanceBp == null ? '—' : pct(s.attendanceBp / 100)} sub="Half day counts 0.5" />
      <Kpi label="Present" value={s.present} /><Kpi label="Half days" value={s.halfDay} /><Kpi label="Absent" value={s.absent} />
      <Kpi label="Late" value={s.late} /><Kpi label="Early out" value={s.earlyOut} /><Kpi label="Missing punch-out" value={s.missingPunchOut} />
    </section>
  )
}

function Calendar({ days, onPick }: { days: Day[]; onPick?: (d: Day) => void }) {
  if (!days.length) return <Empty icon="calendar" title="No days yet" />
  const lead = (new Date(days[0].date + 'T00:00:00').getDay() + 6) % 7
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-[11.5px] text-faint font-semibold mb-1.5">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="text-center">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {days.map((d) => {
          const st = d.dayStatus ? ST[d.dayStatus] : null
          return (
            <button key={d.date} disabled={!onPick || !d.working} onClick={() => onPick?.(d)} title={st?.label ?? 'Not decided yet'}
              className={clsx('rounded-xl p-1.5 min-h-16 text-left flex flex-col text-[11.5px] border border-transparent', st?.cls ?? (d.working ? 'bg-surface border-line text-muted' : 'opacity-40'), onPick && d.working && 'hover:border-ink cursor-pointer')}>
              <b className="text-[13px] num">{Number(d.date.slice(8))}</b>
              <span className="max-sm:hidden">{st?.label ?? (d.working ? '—' : '')}</span>
              {d.punchInAt && <span className="num max-sm:hidden opacity-80">{time(d.punchInAt)}{d.punchOutAt ? `–${time(d.punchOutAt)}` : ''}</span>}
              <span className="flex gap-1 mt-auto">{d.late && <i className="size-1.5 rounded-full bg-warn" title="Late" />}{d.missingPunchOut && <i className="size-1.5 rounded-full bg-bad" title="Missing punch-out" />}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-faint mt-3 flex flex-wrap gap-x-4 gap-y-1"><span><i className="inline-block size-2 rounded-full bg-warn mr-1" />late</span><span><i className="inline-block size-2 rounded-full bg-bad mr-1" />missing punch-out</span><span>Status is final the morning after.</span></p>
    </div>
  )
}

// ---------------------------------------------------------------- BDE

function MyAttendance() {
  const [month, setMonth] = useState(thisMonth())
  const q = useQuery({ queryKey: ['attendance', 'me', month], queryFn: () => api<{ today: { punchInAt: string | null; punchOutAt: string | null } | null; days: Day[]; summary: Summary }>('/attendance/me', { query: { month } }) })
  const reqs = useQuery({ queryKey: ['attendance', 'corrections', 'mine'], queryFn: () => api<Correction[]>('/attendance/corrections') })
  const punch = useAction((k: 'in' | 'out') => post(`/attendance/punch-${k}`), { success: (_, k) => (k === 'in' ? 'Punched in' : 'Punched out'), invalidate: ['attendance', 'dashboard'] })
  const [fix, setFix] = useState<Day | null>(null)
  const t = q.data?.today
  return (
    <div className="fade-in">
      <PageHeader title="My attendance" sub="Times come from the server clock. You can’t edit them, but you can ask for a correction.">
        <MonthPicker value={month} onChange={setMonth} />
        {!t?.punchInAt ? <button className="btn-primary" onClick={() => punch.mutate('in')} disabled={punch.isPending}>Punch in</button>
          : !t.punchOutAt ? <button className="btn-ghost" onClick={() => punch.mutate('out')} disabled={punch.isPending}>Punch out · in since {time(t.punchInAt)}</button>
          : <span className="text-[13.5px] text-muted">Today: {time(t.punchInAt)} – {time(t.punchOutAt)}</span>}
      </PageHeader>
      {q.isLoading ? <Spinner /> : q.data && (
        <>
          <SummaryRow s={q.data.summary} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Month" note="Tap a day to ask for a correction"><Calendar days={q.data.days} onPick={setFix} /></Card>
            <Card title="My correction requests">
              <ul className="flex flex-col gap-3">
                {reqs.data?.map((r) => <li key={r.id} className="text-[13.5px] flex justify-between gap-3"><span><b className="text-ink">{r.date}</b><span className="block text-muted text-[12.5px]">{r.reason}</span></span><Badge tone={r.state === 'APPROVED' ? 'ok' : r.state === 'REJECTED' ? 'bad' : 'warn'}>{r.state.toLowerCase()}</Badge></li>)}
                {!reqs.data?.length && <li className="text-muted text-[13px]">None yet</li>}
              </ul>
            </Card>
          </div>
        </>
      )}
      <CorrectionModal day={fix} onClose={() => setFix(null)} />
    </div>
  )
}

function CorrectionModal({ day, onClose, userId }: { day: Day | null; onClose: () => void; userId?: number }) {
  const [f, setF] = useState({ in: '', out: '', reason: '' })
  const toIso = (date: string, hhmm: string) => (hhmm ? new Date(`${date}T${hhmm}:00`).toISOString() : undefined)
  const m = useAction(() => {
    const body = { date: day!.date, punchInAt: toIso(day!.date, f.in), punchOutAt: f.out ? toIso(f.out < f.in ? nextDay(day!.date) : day!.date, f.out) : undefined, reason: f.reason }
    return userId ? api(`/attendance/${userId}/${day!.date}`, { method: 'PUT', body }) : post('/attendance/corrections', body)
  }, { success: userId ? 'Attendance corrected' : 'Request sent to your Team Lead', invalidate: ['attendance'], onDone: () => { setF({ in: '', out: '', reason: '' }); onClose() } })
  return (
    <Modal open={!!day} onClose={onClose} title={`${userId ? 'Correct' : 'Ask to correct'} ${day?.date ?? ''}`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <p className="text-[13px] text-muted">Recorded: {day?.punchInAt ? time(day.punchInAt) : 'no punch-in'} – {day?.punchOutAt ? time(day.punchOutAt) : 'no punch-out'}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Correct punch-in"><input className="field" type="time" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} /></Field>
          <Field label="Correct punch-out"><input className="field" type="time" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><input className="field" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Forgot to punch out, left at 18:40" /></Field>
        <button className="btn-primary self-end" disabled={(!f.in && !f.out) || f.reason.trim().length < 3 || m.isPending}>{userId ? 'Save correction' : 'Send request'}</button>
      </form>
    </Modal>
  )
}
const nextDay = (ymd: string) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ---------------------------------------------------------------- Team Lead / Admin

function TeamAttendance() {
  const [tab, setTab] = useState<'today' | 'month' | 'corrections' | 'timeoff'>('today')
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams') })
  const [teamId, setTeamId] = useState('')
  const pending = useQuery({ queryKey: ['attendance', 'corrections', 'PENDING'], queryFn: () => api<Correction[]>('/attendance/corrections', { query: { state: 'PENDING' } }) })
  return (
    <div className="fade-in">
      <PageHeader title="Attendance" sub="Server time only. Holidays, week-offs and leave never count as absent.">
        {(teams.data?.length ?? 0) > 1 && <select className="select" aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      </PageHeader>
      <Tabs label="Attendance" value={tab} onChange={setTab} tabs={[{ value: 'today', label: 'Today' }, { value: 'month', label: 'Month' }, { value: 'corrections', label: 'Corrections', count: pending.data?.length }, { value: 'timeoff', label: 'Time off' }]} />
      {tab === 'today' && <TodayBoard teamId={teamId} />}
      {tab === 'month' && <MonthReport teamId={teamId} />}
      {tab === 'corrections' && <Corrections />}
      {tab === 'timeoff' && <TimeOff />}
    </div>
  )
}

function TodayBoard({ teamId }: { teamId: string }) {
  const q = useQuery({ queryKey: ['attendance', 'today', teamId], queryFn: () => api<{ date: string; present: number; absent: number; late: number; onLeave: number; total: number; rows: { userId: number; name: string; state: string; punchInAt: string | null; punchOutAt: string | null; late: boolean }[] }>('/attendance/today', { query: { teamId } }), refetchInterval: 60_000 })
  if (q.isLoading) return <Spinner />
  const d = q.data!
  const tone = { IN: 'ok', OUT: 'neutral', ABSENT: 'bad', NOT_YET: 'neutral', LEAVE: 'neutral' } as const
  const label = { IN: 'In', OUT: 'Out', ABSENT: 'Absent', NOT_YET: 'Not in yet', LEAVE: 'Leave' } as Record<string, string>
  return (
    <>
      <section className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-5"><Kpi label="Present" value={`${d.present} / ${d.total}`} /><Kpi label="Absent" value={d.absent} sub="After the cut-off" /><Kpi label="Late" value={d.late} /><Kpi label="On leave" value={d.onLeave} /></section>
      <Card title={`Today · ${d.date}`}>
        <Table head={['BDE', 'State', 'In', 'Out']} minWidth={420}>
          {d.rows.map((r) => <tr key={r.userId}><td><span className="flex items-center gap-2"><Avatar id={r.userId} name={r.name} size={26} /><b className="text-ink">{r.name}</b></span></td><td><Badge tone={tone[r.state as keyof typeof tone] ?? 'neutral'}>{label[r.state] ?? r.state}</Badge>{r.late && <> <Badge tone="warn">late</Badge></>}</td><td className="num">{time(r.punchInAt)}</td><td className="num">{time(r.punchOutAt)}</td></tr>)}
          {!d.rows.length && <tr><td colSpan={4} className="text-center text-muted py-6">No BDEs</td></tr>}
        </Table>
      </Card>
    </>
  )
}

function MonthReport({ teamId }: { teamId: string }) {
  const [month, setMonth] = useState(thisMonth())
  const [person, setPerson] = useState<{ id: number; name: string } | null>(null)
  const q = useQuery({ queryKey: ['attendance', 'month', month, teamId], queryFn: () => api<{ rows: { user: { id: number; name: string; empCode: string }; summary: Summary }[] }>('/attendance', { query: { month, teamId } }) })
  const one = useQuery({ queryKey: ['attendance', 'person', person?.id, month], queryFn: () => api<{ rows: { days: Day[]; summary: Summary }[] }>('/attendance', { query: { month, userId: person!.id } }), enabled: !!person })
  const [fix, setFix] = useState<Day | null>(null)
  return (
    <Card title="Month report" action={<MonthPicker value={month} onChange={setMonth} />}>
      {q.isLoading ? <Spinner /> : (
        <Table head={['Name', 'Attendance', 'Present', 'Half', 'Absent', 'Leave', 'Late', 'Early out', 'Missing out']} minWidth={760}>
          {q.data?.rows.map((r) => (
            <tr key={r.user.id} className="num">
              <td><button className="font-semibold text-ink hover:underline cursor-pointer" onClick={() => setPerson(r.user)}>{r.user.name}</button></td>
              <td><b className="text-ink">{r.summary.attendanceBp == null ? '—' : pct(r.summary.attendanceBp / 100)}</b></td>
              <td>{r.summary.present}</td><td>{r.summary.halfDay}</td><td className={clsx(r.summary.absent && 'text-bad font-semibold')}>{r.summary.absent}</td><td>{r.summary.leave}</td><td>{r.summary.late}</td><td>{r.summary.earlyOut}</td><td>{r.summary.missingPunchOut}</td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!person} onClose={() => setPerson(null)} title={`${person?.name ?? ''} · ${month}`} wide>
        {one.isLoading ? <Spinner /> : one.data?.rows[0] && <><p className="text-[13px] text-muted mb-3">Click a day to correct it (saved with before / after and your name).</p><Calendar days={one.data.rows[0].days} onPick={setFix} /></>}
      </Modal>
      {person && <CorrectionModal day={fix} userId={person.id} onClose={() => setFix(null)} />}
    </Card>
  )
}

function Corrections() {
  const [state, setState] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')
  const q = useQuery({ queryKey: ['attendance', 'corrections', state], queryFn: () => api<Correction[]>('/attendance/corrections', { query: { state } }) })
  const decide = useAction((v: { id: number; approve: boolean }) => post(`/attendance/corrections/${v.id}/decide`, { approve: v.approve }), { success: (_, v) => (v.approve ? 'Approved and recalculated' : 'Rejected'), invalidate: ['attendance'] })
  return (
    <Card title="Correction requests" action={<select className="select" value={state} onChange={(e) => setState(e.target.value as typeof state)}><option value="PENDING">Waiting</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select>}>
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty title="Nothing waiting" /> : (
        <Table head={['Who', 'Day', 'Recorded', 'Asked for', 'Reason', '']} minWidth={760}>
          {q.data.map((c) => (
            <tr key={c.id}>
              <td className="text-ink font-semibold">{c.user}</td><td className="num">{c.date}</td>
              <td className="num text-muted">{time(c.before.punchInAt)} – {time(c.before.punchOutAt)}</td><td className="num text-ink">{time(c.after.punchInAt)} – {time(c.after.punchOutAt)}</td>
              <td className="text-[13px]">{c.reason}</td>
              <td className="text-right whitespace-nowrap">{c.state === 'PENDING' ? <><button className="btn-primary btn-sm" onClick={() => decide.mutate({ id: c.id, approve: true })}>Approve</button> <button className="btn-ghost btn-sm" onClick={() => decide.mutate({ id: c.id, approve: false })}>Reject</button></> : <Badge tone={c.state === 'APPROVED' ? 'ok' : 'bad'}>{c.state.toLowerCase()}</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

function TimeOff() {
  const q = useQuery({ queryKey: ['attendance', 'timeoff'], queryFn: () => api<{ id: number; userId: number; fromDate: string; toDate: string; kind: string }[]>('/attendance/time-off') })
  const users = useQuery({ queryKey: ['users', 'BDE'], queryFn: () => api<{ id: number; name: string }[]>('/users', { query: { role: 'BDE', state: 'ACTIVE' } }) })
  const [f, setF] = useState({ userId: '', from: today(), to: today(), kind: 'LEAVE' })
  const add = useAction(() => post('/attendance/time-off', { ...f, userId: Number(f.userId) }), { success: 'Time off saved: not absent, and no new leads on those days', invalidate: ['attendance', 'eligibility'] })
  const del = useAction((id: number) => api(`/attendance/time-off/${id}`, { method: 'DELETE' }), { success: 'Removed', invalidate: ['attendance', 'eligibility'] })
  const name = (id: number) => users.data?.find((u) => u.id === id)?.name ?? `#${id}`
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
      <Card title="Mark planned leave">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}>
          <Field label="Who"><select className="field" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Choose…</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="From"><input className="field" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><input className="field" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
          <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="LEAVE">Leave</option><option value="OTHER">Other</option></select></Field>
          <button className="btn-primary self-end" disabled={!f.userId || add.isPending}>Save</button>
        </form>
      </Card>
      <Card title="Leave in the last 60 days and ahead">
        <Table head={['Who', 'From', 'To', 'Kind', '']} minWidth={420}>
          {q.data?.map((t) => <tr key={t.id} className="num"><td className="text-ink">{name(t.userId)}</td><td>{t.fromDate.slice(0, 10)}</td><td>{t.toDate.slice(0, 10)}</td><td>{t.kind.toLowerCase()}</td><td className="text-right"><button className="text-[13px] text-muted hover:text-bad cursor-pointer" onClick={() => del.mutate(t.id)}>Remove</button></td></tr>)}
          {!q.data?.length && <tr><td colSpan={5} className="text-center text-muted py-6">None</td></tr>}
        </Table>
      </Card>
    </div>
  )
}
