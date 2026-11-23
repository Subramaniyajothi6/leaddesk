import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { int, pct, minutes, delta, time } from '../lib/format'
import { Card, Kpi, PageHeader, Segmented, Spinner, ErrorBox, Empty, Badge, Avatar, useToast } from '../components/ui'
import { Funnel, WeeklyBars, type FunnelStep } from '../components/charts'
import { PERIODS, good } from '../lib/dash'

type Period = 'today' | 'week' | 'month'
interface Row {
  userId: number; name: string; state: string; today: { status: string; punchInAt: string | null; late: boolean }
  load: { open: number; max: number; left: number }; fresh: number; callsToday: number; connectedPct: number | null; talkMinToday: number
  followUps: { dueToday: number; overdue: number }; counted: number; conversions: number; conversionPct: number | null; vsTeam: 'above' | 'below' | null
  speedToFirstCallMin: number | null; untouched: number; flags: string[]
}
interface TeamDash {
  period: { label: string; from: string; to: string; rule: string }
  team: { id: number; name: string; autoDistribute: boolean; method: string; rank: number | null; teamsRanked: number; pool: number }
  actions: { kind: string; userId: number; title: string; detail: string; action: string }[]
  kpis: { conversions: { value: number; target: number | null; prev: number }; conversionPct: { value: number | null; prev: number | null; counted: number }; speedToFirstCallMin: { value: number | null }; untouchedLeads: { value: number }; overdueFollowUps: { value: number; completionPct: number | null }; teamPool: { value: number } }
  received: number; distributed: number; bdes: Row[]
  totals: { open: number; max: number; fresh: number; callsToday: number; dueToday: number; overdue: number; counted: number; conversions: number; conversionPct: number | null }
  funnel: FunnelStep[]; trend: { weekEnding: string; conversions: number }[]
  today: { offDay: string | null; present: number; total: number; absent: number; late: number; today: number; usualByNow: number | null }
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  IN: { label: 'In', tone: 'ok' }, LATE: { label: 'Late', tone: 'warn' }, OUT: { label: 'Out', tone: 'neutral' }, NOT_IN: { label: 'Not in', tone: 'bad' },
  LEAVE: { label: 'Leave', tone: 'neutral' }, OFF: { label: 'Day off', tone: 'neutral' }, NOT_YET: { label: 'Not in yet', tone: 'neutral' }, INACTIVE: { label: 'Inactive', tone: 'bad' }, EXITED: { label: 'Left', tone: 'neutral' },
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

export function TeamDashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<Period>('month')
  const [teamId, setTeamId] = useState<number | undefined>(user?.teamIds[0])
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams'), enabled: (user?.teamIds.length ?? 0) > 1 })
  const q = useQuery({ queryKey: ['dashboard', 'team', period, teamId], queryFn: () => api<TeamDash>('/dashboard/team', { query: { period, teamId } }), refetchInterval: 60_000 })
  const qc = useQueryClient()
  const toast = useToast()

  const give = useMutation({
    mutationFn: (v: { userId: number; count: number }) => post<{ rows: { name: string; given: number; loadAfter: string }[] }>('/allocation/assign-counts', { teamId: q.data!.team.id, counts: [v] }),
    onSuccess: (r) => { toast(`${r.rows[0].given} leads given to ${r.rows[0].name} (now ${r.rows[0].loadAfter})`); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not give leads', 'bad'),
  })

  const d = q.data
  return (
    <div className="fade-in">
      <PageHeader title={`${greeting()}, ${user?.name.split(' ')[0]}`} sub={d ? <>{d.team.name}{d.team.rank ? <> · rank {d.team.rank} of {d.team.teamsRanked} teams</> : null} · {d.period.label}</> : ' '}>
        {(user?.teamIds.length ?? 0) > 1 && (
          <select className="select" aria-label="Team" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
            {teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        <Link to="/distribute" className="btn-primary">Distribute pool{d ? ` (${int(d.team.pool)})` : ''}</Link>
      </PageHeader>

      {q.isLoading && <Spinner label="Loading your team" />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-5">
          <Card title={`Needs you now${d.actions.length ? ` (${d.actions.length})` : ''}`} strong={!!d.actions.length}>
            {d.actions.length ? (
              <ul className="divide-y divide-line">
                {d.actions.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0"><b className="text-ink text-[14.5px]">{a.title}</b>{a.detail && <p className="text-[13px] text-muted">{a.detail}</p>}</div>
                    {a.kind === 'NEEDS_LEADS' && d.team.pool > 0 ? (
                      <button className="btn-primary btn-sm" disabled={give.isPending} onClick={() => give.mutate({ userId: a.userId, count: Math.min(20, d.team.pool) })}>Give {Math.min(20, d.team.pool)}</button>
                    ) : a.kind === 'NEEDS_LEADS' ? (
                      <span className="text-[12.5px] text-muted">Team pool empty · Admin has been told</span>
                    ) : (
                      <Link className="btn-ghost btn-sm" to={a.kind === 'UNPAID' ? '/payments' : a.kind === 'CORRECTIONS' ? '/attendance' : a.kind === 'OVERDUE' ? `/leads?ownerId=${a.userId}&overdue=true` : `/leads?ownerId=${a.userId}`}>{a.action}</Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty title="All clear">Every BDE has leads and nothing is overdue.</Empty>}
          </Card>

          <section aria-label="Team numbers" className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Team conversions" value={int(d.kpis.conversions.value)} sub={d.kpis.conversions.target ? `Team target ${d.kpis.conversions.target}` : 'No target set'} meter={d.kpis.conversions.target ? (d.kpis.conversions.value / d.kpis.conversions.target) * 100 : null} delta={good(delta(d.kpis.conversions.value, d.kpis.conversions.prev), true)} />
            <Kpi label="Conversion %" value={pct(d.kpis.conversionPct.value)} sub={`${int(d.kpis.conversionPct.counted)} counted leads`} delta={good(delta(d.kpis.conversionPct.value, d.kpis.conversionPct.prev, ' pts'), true)} />
            <Kpi label="Speed to first call" value={minutes(d.kpis.speedToFirstCallMin.value)} sub="Assigned → first call" />
            <Kpi label="Untouched leads" value={int(d.kpis.untouchedLeads.value)} sub="Given 24 h+, never called" />
            <Kpi label="Overdue follow-ups" value={int(d.kpis.overdueFollowUps.value)} sub={d.kpis.overdueFollowUps.completionPct != null ? `${pct(d.kpis.overdueFollowUps.completionPct)} done on time` : ' '} />
            <Kpi label="Team pool" value={int(d.kpis.teamPool.value)} sub={`${int(d.received)} received · ${int(d.distributed)} given out`} />
          </section>

          <Card title="Your BDEs" note="Needs attention first · ▲▼ against the team average · calls are today">
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-[13.5px] min-w-[960px]">
                <thead><tr className="text-left text-[12px] text-faint border-b border-line">
                  {['BDE', 'Load (open / max)', 'Fresh', 'Calls today', 'Follow-ups due · overdue', 'Speed to 1st call', 'Converted', `Conv. % (team ${pct(d.totals.conversionPct)})`].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.bdes.map((b) => {
                    const st = STATUS[b.state !== 'ACTIVE' ? b.state : b.today.status] ?? STATUS.NOT_IN
                    const full = b.load.open >= b.load.max
                    return (
                      <tr key={b.userId} className={clsx('border-b border-line/70 num align-middle', b.flags.length && 'bg-accent-soft/25')}>
                        <td className="py-2.5 pr-3">
                          <span className="flex items-center gap-2.5"><Avatar id={b.userId} name={b.name} size={28} /><span><b className="block text-ink">{b.name}</b><span className="flex items-center gap-1.5 mt-0.5"><Badge tone={st.tone}>{st.label}</Badge>{b.today.punchInAt && <span className="text-[12px] text-faint">{time(b.today.punchInAt)}</span>}</span></span></span>
                        </td>
                        <td className="pr-3 min-w-36">
                          <span className={clsx(full && 'font-semibold text-bad')}>{b.load.open} / {b.load.max}</span> <span className="text-faint text-[12px]">{full ? 'at max' : `${b.load.left} left`}</span>
                          <span className="block h-1.5 rounded-full bg-line mt-1 overflow-hidden max-w-32" aria-hidden><i className={clsx('block h-full rounded-full', full ? 'bg-bad' : 'bg-accent/60')} style={{ width: `${Math.min(100, (b.load.open / b.load.max) * 100)}%` }} /></span>
                        </td>
                        <td className={clsx('pr-3', b.fresh <= 2 && 'font-semibold text-bad')}>{b.fresh}</td>
                        <td className="pr-3">{b.callsToday}{b.connectedPct != null && <span className="text-faint"> · {pct(b.connectedPct, 0)}</span>}</td>
                        <td className="pr-3">{b.followUps.dueToday} · <span className={clsx(b.followUps.overdue && 'font-semibold text-bad')}>{b.followUps.overdue} overdue</span></td>
                        <td className="pr-3">{minutes(b.speedToFirstCallMin)}</td>
                        <td className="pr-3">{b.conversions} <span className="text-faint">of {b.counted}</span></td>
                        <td><b className="text-ink">{pct(b.conversionPct)}</b> {b.vsTeam && <span className={b.vsTeam === 'above' ? 'text-ok' : 'text-bad'} aria-label={b.vsTeam === 'above' ? 'above team average' : 'below team average'}>{b.vsTeam === 'above' ? '▲' : '▼'}</span>}</td>
                      </tr>
                    )
                  })}
                  <tr className="font-semibold text-ink num">
                    <td className="py-2.5 pr-3">Team ({d.bdes.length})</td><td className="pr-3">{d.totals.open} / {d.totals.max}</td><td className="pr-3">{d.totals.fresh}</td><td className="pr-3">{d.totals.callsToday}</td>
                    <td className="pr-3">{d.totals.dueToday} · {d.totals.overdue}</td><td className="pr-3">{minutes(d.kpis.speedToFirstCallMin.value)}</td><td className="pr-3">{d.totals.conversions} of {d.totals.counted}</td><td>{pct(d.totals.conversionPct)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Where your leads are lost">{d.funnel.length ? <Funnel steps={d.funnel} /> : <Empty icon="chart" title="No leads yet" />}</Card>
            <Card title="Team conversions per week" note="Last 8 weeks"><WeeklyBars data={d.trend} /></Card>
            <Card title="Today so far" note={d.today.offDay ? `${d.today.offDay}: nobody is expected in` : 'Live'}>
              <dl className="grid grid-cols-2 gap-4">
                <div><dt className="text-[12px] text-faint">Present</dt><dd className="display num text-[26px] text-ink">{d.today.present} / {d.today.total}</dd><dd className="text-[12px] text-muted">{d.today.absent} not in · {d.today.late} late</dd></div>
                <div><dt className="text-[12px] text-faint">Calls</dt><dd className="display num text-[26px] text-ink">{int(d.today.today)}</dd><dd className="text-[12px] text-muted">{d.today.usualByNow != null ? `usual by now ${int(d.today.usualByNow)}` : 'no history yet'}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
