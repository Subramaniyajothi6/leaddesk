import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { int, inr, pct, minutes, delta } from '../lib/format'
import { Card, Kpi, PageHeader, Segmented, Spinner, ErrorBox, Empty, Badge, Avatar } from '../components/ui'
import { Funnel, WeeklyBars, ShareBars, type FunnelStep } from '../components/charts'
import { Icon } from '../components/Icon'
import { PERIODS, good, routeFor } from '../lib/dash'

type Period = 'today' | 'week' | 'month'

interface AdminDash {
  period: { label: string; from: string; to: string; rule: 'COHORT' | 'ACTIVITY' }
  setup: null | { done: number; total: number; items: { key: string; label: string; done: boolean; minutes: number }[] }
  actions: { kind: string; title: string; detail: string; action: string; link: string }[]
  kpis: {
    conversions: { value: number; target: number | null; prev: number }
    conversionPct: { value: number | null; targetPct: number | null; prev: number | null; counted: number; rule: string }
    revenuePaise: { value: number; target: number | null; prev: number; pendingPaise: number }
    speedToFirstCallMin: { value: number | null }
    untouchedLeads: { value: number }
    overdueFollowUps: { value: number; followUpCompletionPct: number | null }
  }
  counts: { companyPool: number; bdesActive: number; bdesInactive: number }
  funnel: FunnelStep[]
  teams: { teamId: number; team: string; teamLead: string | null; bdes: number; counted: number; conversions: number; conversionPct: number | null; inTeamPool: number; freshWithBdes: number; speedToFirstCallMin: number | null; untouched: number; overdueFollowUps: number; presentToday: string }[]
  teamLeads: { userId: number; name: string; teams: string[]; conversionPct: number | null; conversions: number }[]
  sources: { source: string; counted: number; conversions: number; conversionPct: number | null }[]
  bdes: { top: { userId: number; name: string; conversions: number; pct: number | null }[]; needsAttention: { userId: number; name: string; conversions: number; pct: number | null }[] }
  trend: { weekEnding: string; conversions: number }[]
  today: { presentCount: number; late: number; today: number; usualByNow: number | null }
}


export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('month')
  const [teamId, setTeamId] = useState<string>('')
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams') })
  const q = useQuery({ queryKey: ['dashboard', 'admin', period, teamId], queryFn: () => api<AdminDash>('/dashboard/admin', { query: { period, teamId } }), refetchInterval: 60_000 })
  const d = q.data

  return (
    <div className="fade-in">
      <PageHeader title="Dashboard" sub={<>Whole company{d && <> · {d.period.label}</>} · updates live</>}>
        <label className="sr-only" htmlFor="team">Team</label>
        <select id="team" className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </PageHeader>

      {q.isLoading && <Spinner label="Loading the dashboard" />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-5">
          {d.setup && <Setup s={d.setup} />}

          <Card title={`Waiting on you${d.actions.length ? ` (${d.actions.length})` : ''}`} note={d.actions.length ? 'Fix these first' : undefined} strong={!!d.actions.length}>
            {d.actions.length ? (
              <ul className="divide-y divide-line">
                {d.actions.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0"><b className="text-ink text-[14.5px]">{a.title}</b><p className="text-[13px] text-muted">{a.detail}</p></div>
                    <Link to={routeFor(a.link)} className={i === 0 ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>{a.action}</Link>
                  </li>
                ))}
              </ul>
            ) : <Empty title="All clear">Nothing is waiting on you right now.</Empty>}
          </Card>

          <section aria-label="Key numbers" className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Conversions" value={int(d.kpis.conversions.value)}
              sub={d.kpis.conversions.target ? `Target ${int(d.kpis.conversions.target)} · ${Math.round((d.kpis.conversions.value / d.kpis.conversions.target) * 100)}%` : 'No target set'}
              meter={d.kpis.conversions.target ? (d.kpis.conversions.value / d.kpis.conversions.target) * 100 : null}
              delta={good(delta(d.kpis.conversions.value, d.kpis.conversions.prev), true)} />
            <Kpi label="Conversion %" value={pct(d.kpis.conversionPct.value)}
              sub={d.kpis.conversionPct.targetPct != null ? `Target ${pct(d.kpis.conversionPct.targetPct)}` : `${int(d.kpis.conversionPct.counted)} counted leads`}
              delta={good(delta(d.kpis.conversionPct.value, d.kpis.conversionPct.prev, ' pts'), true)} />
            <Kpi label="Confirmed revenue" value={inr(d.kpis.revenuePaise.value)}
              sub={d.kpis.revenuePaise.pendingPaise ? `${inr(d.kpis.revenuePaise.pendingPaise)} waiting to confirm` : d.kpis.revenuePaise.target ? `Target ${inr(d.kpis.revenuePaise.target)}` : 'Only confirmed payments'}
              meter={d.kpis.revenuePaise.target ? (d.kpis.revenuePaise.value / d.kpis.revenuePaise.target) * 100 : null} />
            <Kpi label="Speed to first call" value={minutes(d.kpis.speedToFirstCallMin.value)} sub="Assigned → first call, average" />
            <Kpi label="Untouched leads" value={int(d.kpis.untouchedLeads.value)} sub="Given out 24 h+, never called" />
            <Kpi label="Overdue follow-ups" value={int(d.kpis.overdueFollowUps.value)} sub={d.kpis.overdueFollowUps.followUpCompletionPct != null ? `${pct(d.kpis.overdueFollowUps.followUpCompletionPct)} done on time` : 'Due time passed, not done'} />
          </section>
          <p className="text-[12px] text-faint -mt-2">{d.period.rule === 'COHORT' ? `Cohort rule: of the leads assigned ${d.period.from} to ${d.period.to}, how many converted so far.` : 'Activity rule: conversions in the period ÷ leads assigned in the period.'} Company pool: {int(d.counts.companyPool)} leads · BDEs {d.counts.bdesActive} active, {d.counts.bdesInactive} inactive.</p>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Where leads are lost" note="Leads given out in this period">{d.funnel.length ? <Funnel steps={d.funnel} /> : <Empty icon="chart" title="No leads yet" />}</Card>
            <Card title="Conversions per week" note="Last 8 weeks, all teams"><WeeklyBars data={d.trend} /></Card>
          </div>

          <Card title="Teams side by side" note="Bold rows need attention">
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-[13.5px] min-w-[860px]">
                <thead><tr className="text-left text-[12px] text-faint border-b border-line">
                  {['Team', 'Team Lead', 'BDEs', 'Counted', 'Conv.', 'Conv. %', 'Team pool', 'Fresh with BDEs', 'Speed to 1st call', 'Untouched', 'Overdue f/u', 'Present'].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.teams.map((t) => {
                    const warn = !t.teamLead || (t.inTeamPool === 0 && t.freshWithBdes === 0 && t.bdes > 0) || t.untouched > 10
                    return (
                      <tr key={t.teamId} className={clsx('border-b border-line/70 num', warn && 'font-semibold')}>
                        <td className="py-2.5 pr-3 text-ink">{t.team}</td>
                        <td className="pr-3">{t.teamLead ?? <Badge tone="warn">None (you)</Badge>}</td>
                        <td className="pr-3">{t.bdes}</td><td className="pr-3">{int(t.counted)}</td><td className="pr-3">{int(t.conversions)}</td>
                        <td className="pr-3 text-ink">{pct(t.conversionPct)}</td><td className="pr-3">{int(t.inTeamPool)}</td><td className="pr-3">{int(t.freshWithBdes)}</td>
                        <td className="pr-3">{minutes(t.speedToFirstCallMin)}</td><td className="pr-3">{int(t.untouched)}</td><td className="pr-3">{int(t.overdueFollowUps)}</td><td>{t.presentToday}</td>
                      </tr>
                    )
                  })}
                  {!d.teams.length && <tr><td colSpan={12} className="py-6 text-center text-muted">No teams yet. Create them in Teams &amp; people.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            <Card title="Team Leads">
              <ul className="flex flex-col gap-3">
                {d.teamLeads.map((t) => <li key={t.userId} className="flex items-center gap-3"><Avatar id={t.userId} name={t.name} /><span className="flex-1 min-w-0"><b className="block text-ink text-[13.5px]">{t.name}</b><span className="text-[12px] text-faint">{t.teams.join(', ')}</span></span><b className="num text-ink">{pct(t.conversionPct)}</b></li>)}
                {!d.teamLeads.length && <li className="text-muted text-sm">No Team Leads linked</li>}
              </ul>
            </Card>
            <Card title="Conversion % by source"><ShareBars rows={d.sources.map((s) => ({ label: s.source, value: s.conversionPct, sub: `of ${int(s.counted)}` }))} /></Card>
            <Card title="BDEs" action={<Link to="/leaderboard" className="text-[13px] font-semibold text-accent-ink hover:underline">Leaderboard</Link>}>
              <p className="kicker mb-2">Top</p>
              <ol className="flex flex-col gap-2 mb-4">{d.bdes.top.map((b, i) => <li key={b.userId} className="flex items-center gap-2 text-[13.5px]"><span className="w-4 text-faint num">{i + 1}</span><span className="flex-1 truncate">{b.name}</span><b className="num text-ink">{b.conversions}</b><span className="text-faint num w-12 text-right">{pct(b.pct)}</span></li>)}</ol>
              <p className="kicker mb-2">Needs attention</p>
              <ul className="flex flex-col gap-2">{d.bdes.needsAttention.map((b) => <li key={b.userId} className="flex items-center gap-2 text-[13.5px]"><span className="flex-1 truncate">{b.name}</span><span className="text-faint num">{pct(b.pct)}</span></li>)}{!d.bdes.needsAttention.length && <li className="text-muted text-[13px]">Not enough data yet</li>}</ul>
            </Card>
            <Card title="Today so far" note="Live">
              <dl className="grid grid-cols-2 gap-4">
                <div><dt className="text-[12px] text-faint">Present</dt><dd className="display num text-[26px] text-ink">{d.today.presentCount}</dd><dd className="text-[12px] text-muted">{d.today.late} late</dd></div>
                <div><dt className="text-[12px] text-faint">Calls</dt><dd className="display num text-[26px] text-ink">{int(d.today.today)}</dd><dd className="text-[12px] text-muted">{d.today.usualByNow != null ? `usual by now ${int(d.today.usualByNow)}` : 'no history yet'}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Setup({ s }: { s: NonNullable<AdminDash['setup']> }) {
  const next = s.items.find((i) => !i.done)
  return (
    <Card title={`Set up your company: ${s.done} of ${s.total} done`} note="This card disappears once setup is finished" className="border-dashed">
      <div className="h-2 rounded-full bg-line overflow-hidden mb-4" role="progressbar" aria-valuenow={Math.round((s.done / s.total) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><i className="block h-full bg-accent rounded-full" style={{ width: `${(s.done / s.total) * 100}%` }} /></div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {s.items.map((i) => (
          <li key={i.key} className="flex items-center gap-2 text-[13.5px]">
            <span className={clsx('size-5 rounded-full grid place-items-center flex-none', i.done ? 'bg-ok text-white' : 'border border-line text-transparent')}><Icon name="check" size={12} /></span>
            <span className={i.done ? 'text-muted line-through' : 'text-ink'}>{i.label}</span>
            {!i.done && <span className="text-faint text-[12px]">· {i.minutes} min</span>}
          </li>
        ))}
      </ul>
      {next && <Link to={next.key === 'upload' ? '/upload' : next.key === 'teams' || next.key === 'people' ? '/teams' : '/settings'} className="btn-primary btn-sm mt-4">Next: {next.label}</Link>}
    </Card>
  )
}
