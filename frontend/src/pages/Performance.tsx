import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { pct, int, minutes } from '../lib/format'
import { thisMonth } from '../lib/hooks'
import { Card, PageHeader, Segmented, Spinner, Kpi } from '../components/ui'

interface Bde { period: { label: string; rule: string }; kpis: { counted: number; contacted: number; conversions: number; conversionTarget: number | null; conversionPct: number | null; prevConversionPct: number | null; contactRate: number | null; followUpCompletionPct: number | null; speedToFirstCallMin: number | null }; byStatus: { status: string; key: string; count: number }[]; rank: number | null; teamSize: number }

export function Performance() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month')
  const q = useQuery({ queryKey: ['dashboard', 'bde', period], queryFn: () => api<Bde>('/dashboard/bde', { query: { period } }) })
  const att = useQuery({ queryKey: ['attendance', 'me', thisMonth()], queryFn: () => api<{ summary: { attendanceBp: number | null; late: number } }>('/attendance/me', { query: { month: thisMonth() } }) })
  const k = q.data?.kpis
  return (
    <div className="fade-in">
      <PageHeader title="My performance" sub={q.data ? `${q.data.period.label} · ${q.data.period.rule === 'COHORT' ? 'of the leads you got in this period, how many converted so far' : 'conversions that happened in this period'}` : ' '}>
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </PageHeader>
      {q.isLoading || !k ? <Spinner /> : (
        <div className="flex flex-col gap-5">
          <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi label="Conversions" value={int(k.conversions)} sub={k.conversionTarget ? `Target ${k.conversionTarget}` : 'No target set'} meter={k.conversionTarget ? (k.conversions / k.conversionTarget) * 100 : null} />
            <Kpi label="Conversion %" value={pct(k.conversionPct)} sub={k.prevConversionPct != null ? `Last period ${pct(k.prevConversionPct)}` : `${int(k.counted)} leads counted`} />
            <Kpi label="Contact rate" value={pct(k.contactRate)} sub={`${int(k.contacted)} of ${int(k.counted)} reached`} />
            <Kpi label="Follow-ups on time" value={pct(k.followUpCompletionPct)} sub={`Speed to first call ${minutes(k.speedToFirstCallMin)}`} />
          </section>
          <div className="grid gap-5 md:grid-cols-3">
            <Card title="Team rank">{q.data!.rank ? <p className="display text-[40px] text-ink num">#{q.data!.rank} <span className="text-[16px] text-muted font-sans">of {q.data!.teamSize}</span></p> : <p className="text-muted">Not ranked yet</p>}<Link to="/leaderboard" className="text-[13px] font-semibold text-accent-ink hover:underline">See the leaderboard</Link></Card>
            <Card title="Attendance this month">{att.data && <p className="display text-[40px] text-ink num">{att.data.summary.attendanceBp == null ? '—' : pct(att.data.summary.attendanceBp / 100)}</p>}<p className="text-[13px] text-muted">{att.data?.summary.late ?? 0} late days · <Link to="/attendance" className="font-semibold text-accent-ink hover:underline">details</Link></p></Card>
            <Card title="My leads by status"><ul className="flex flex-col gap-1.5">{q.data!.byStatus.sort((a, b) => b.count - a.count).map((s) => <li key={s.key} className="flex justify-between text-[13.5px]"><span>{s.status}</span><b className="num text-ink">{s.count}</b></li>)}</ul></Card>
          </div>
        </div>
      )}
    </div>
  )
}
