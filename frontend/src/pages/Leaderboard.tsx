import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { pct, int } from '../lib/format'
import { Card, PageHeader, Segmented, Spinner, Empty, Avatar, ErrorBox } from '../components/ui'

interface Row { rank: number; userId: number; name: string; team: string | null; conversions: number; conversionPct: number | null; counted: number; calls: number; me: boolean }

export function Leaderboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month')
  const [by, setBy] = useState<'conversions' | 'conversion_pct' | 'calls'>('conversions')
  const [teamId, setTeamId] = useState('')
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams'), enabled: user?.role === 'ADMIN' })
  const q = useQuery({ queryKey: ['leaderboard', period, by, teamId], queryFn: () => api<{ period: { label: string; rule: string }; rows: Row[] }>('/leaderboard', { query: { period, by, teamId } }) })
  const rows = q.data?.rows ?? []
  const value = (r: Row) => (by === 'calls' ? int(r.calls) : by === 'conversion_pct' ? pct(r.conversionPct) : int(r.conversions))
  return (
    <div className="fade-in">
      <PageHeader title="Leaderboard" sub={q.data ? `${q.data.period.label} · conversion % uses the ${q.data.period.rule.toLowerCase()} rule` : ' '}>
        {user?.role === 'ADMIN' && <select className="select" aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        <Segmented label="Rank by" value={by} onChange={setBy} options={[{ value: 'conversions', label: 'Conversions' }, { value: 'conversion_pct', label: 'Conv. %' }, { value: 'calls', label: 'Calls' }]} />
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </PageHeader>
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Spinner /> : !rows.length ? <Card><Empty icon="trophy" title="No results yet">The board fills up as leads are worked.</Empty></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-5">
            {rows.slice(0, 3).map((r) => (
              <div key={r.userId} className={clsx('card p-5 flex flex-col items-center text-center gap-2', r.rank === 1 && 'border-accent/60 bg-accent-soft/30', r.me && 'ring-2 ring-accent')}>
                <span className="display text-[34px] text-accent num">#{r.rank}</span>
                <Avatar id={r.userId} name={r.name} size={44} />
                <b className="text-ink">{r.name}{r.me && ' (you)'}</b><span className="text-[12.5px] text-muted">{r.team ?? ''}</span>
                <span className="display text-[28px] text-ink num">{value(r)}</span>
              </div>
            ))}
          </div>
          <Card>
            <ol className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.userId} className={clsx('flex items-center gap-3 py-2.5 num', r.me && 'bg-accent-soft/40 -mx-5 px-5')}>
                  <span className="w-8 text-faint font-semibold">{r.rank}</span><Avatar id={r.userId} name={r.name} size={28} />
                  <span className="flex-1 min-w-0"><b className="text-ink">{r.name}{r.me && ' (you)'}</b> <span className="text-[12.5px] text-muted">{r.team}</span></span>
                  <span className="text-[12.5px] text-muted max-sm:hidden">{int(r.conversions)} conv · {pct(r.conversionPct)} · {int(r.calls)} calls</span>
                  <b className="text-ink w-16 text-right">{value(r)}</b>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  )
}
