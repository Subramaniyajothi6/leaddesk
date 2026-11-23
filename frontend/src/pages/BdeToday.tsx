import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { int, pct, time, minutes } from '../lib/format'
import { Card, Kpi, PageHeader, Spinner, ErrorBox, Empty, Badge, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

interface BdeDash {
  period: { label: string; rule: string }
  today: { punchInAt: string | null; punchOutAt: string | null; late: boolean; calls: number; connected: number; talkMin: number; callTarget: number | null; followUpsDue: number; overdue: number; fresh: number; noLeads: string | null }
  kpis: { counted: number; contacted: number; conversions: number; conversionTarget: number | null; conversionPct: number | null; prevConversionPct: number | null; contactRate: number | null; followUpCompletionPct: number | null; speedToFirstCallMin: number | null }
  byStatus: { status: string; key: string; count: number }[]
  rank: number | null; teamSize: number
}
interface Queue { queue: { leadId: number; name: string; phone: string; status: string; score: number; why: string; dueAt: string | null }[]; counts: { overdue: number; dueToday: number; fresh: number } }

export function BdeToday() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const d = useQuery({ queryKey: ['dashboard', 'bde'], queryFn: () => api<BdeDash>('/dashboard/bde', { query: { period: 'month' } }), refetchInterval: 60_000 })
  const q = useQuery({ queryKey: ['queue'], queryFn: () => api<Queue>('/me/queue'), refetchInterval: 60_000 })
  const punch = useMutation({
    mutationFn: (kind: 'in' | 'out') => post<{ punchInAt: string; punchOutAt: string | null; late: boolean }>(`/attendance/punch-${kind}`),
    onSuccess: (r, kind) => { toast(kind === 'in' ? `Punched in at ${time(r.punchInAt)}${r.late ? ' (late)' : ''}` : `Punched out at ${time(r.punchOutAt)}`); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not punch', 'bad'),
  })

  const t = d.data?.today
  const k = d.data?.kpis
  return (
    <div className="fade-in">
      <PageHeader title="Today" sub={`Hello ${user?.name.split(' ')[0]} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
        {t && !t.punchInAt && <button className="btn-primary" disabled={punch.isPending} onClick={() => punch.mutate('in')}><Icon name="clock" size={16} />Punch in</button>}
        {t?.punchInAt && !t.punchOutAt && (
          <>
            <span className="text-[13.5px] text-muted">In since <b className="text-ink">{time(t.punchInAt)}</b>{t.late && <> · <Badge tone="warn">Late</Badge></>}</span>
            <button className="btn-ghost" disabled={punch.isPending} onClick={() => punch.mutate('out')}>Punch out</button>
          </>
        )}
        {t?.punchOutAt && <span className="text-[13.5px] text-muted">Day closed: {time(t.punchInAt)} – {time(t.punchOutAt)}</span>}
      </PageHeader>

      {(d.isLoading || q.isLoading) && <Spinner label="Getting your day ready" />}
      {d.error && <ErrorBox error={d.error} onRetry={() => d.refetch()} />}
      {t && k && (
        <div className="flex flex-col gap-5">
          {t.noLeads && <div role="status" className="card p-4 border-warn/40 bg-warn-soft flex items-center gap-3 text-warn font-medium"><Icon name="bell" />{t.noLeads} Your follow-ups below still need you.</div>}

          <section aria-label="Today in numbers" className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi label="Calls today" value={int(t.calls)} sub={t.callTarget ? `Target ${t.callTarget}` : `${t.connected} connected · ${t.talkMin} min talk`} meter={t.callTarget ? (t.calls / t.callTarget) * 100 : null} />
            <Kpi label="Follow-ups due today" value={int(t.followUpsDue)} sub="Call these first" />
            <Kpi label="Overdue" value={int(t.overdue)} sub={t.overdue ? 'Past their time' : 'Nothing overdue'} />
            <Kpi label="Fresh leads" value={int(t.fresh)} sub="Not called yet" />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Next to call" note="Overdue follow-ups, then due today, then fresh leads by score" action={q.data && <span className="text-[12.5px] text-faint">{q.data.counts.overdue} overdue · {q.data.counts.dueToday} due · {q.data.counts.fresh} fresh</span>}>
              {q.data?.queue.length ? (
                <ol className="divide-y divide-line">
                  {q.data.queue.slice(0, 12).map((l, i) => (
                    <li key={l.leadId} className="flex items-center gap-3 py-3 first:pt-0">
                      <span className="w-5 text-faint num text-[13px]">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <b className="block text-ink truncate">{l.name}</b>
                        <span className="text-[12.5px] text-muted num">{l.phone} · {l.status}{l.dueAt && <> · {time(l.dueAt)}</>}</span>
                      </span>
                      <Badge tone={l.why === 'Overdue follow-up' ? 'bad' : l.why === 'Fresh lead' ? 'neutral' : 'accent'}>{l.why}</Badge>
                      <Link to={`/leads/${l.leadId}?call=1`} className={clsx(i === 0 ? 'btn-primary' : 'btn-ghost', 'btn-sm')} aria-label={`Call ${l.name}`}><Icon name="phone" size={15} /><span className="max-sm:hidden">Call</span></Link>
                    </li>
                  ))}
                </ol>
              ) : <Empty title="Nothing to call right now">New leads and due follow-ups appear here.</Empty>}
            </Card>

            <div className="flex flex-col gap-5">
              <Card title="This month" note={k.conversionTarget ? `Target ${k.conversionTarget} conversions` : undefined}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><dt className="text-[12px] text-faint">Conversions</dt><dd className="display num text-[28px] text-ink">{k.conversions}</dd></div>
                  <div><dt className="text-[12px] text-faint">Conversion %</dt><dd className="display num text-[28px] text-ink">{pct(k.conversionPct)}</dd></div>
                  <div><dt className="text-[12px] text-faint">Leads counted</dt><dd className="num font-semibold text-ink">{int(k.counted)}</dd></div>
                  <div><dt className="text-[12px] text-faint">Contact rate</dt><dd className="num font-semibold text-ink">{pct(k.contactRate)}</dd></div>
                  <div><dt className="text-[12px] text-faint">Follow-ups on time</dt><dd className="num font-semibold text-ink">{pct(k.followUpCompletionPct)}</dd></div>
                  <div><dt className="text-[12px] text-faint">Speed to first call</dt><dd className="num font-semibold text-ink">{minutes(k.speedToFirstCallMin)}</dd></div>
                </dl>
                {k.conversionTarget ? <div className="h-2 rounded-full bg-line mt-4 overflow-hidden" aria-hidden><i className="block h-full bg-accent rounded-full" style={{ width: `${Math.min(100, (k.conversions / k.conversionTarget) * 100)}%` }} /></div> : null}
                {d.data!.rank && <p className="mt-4 text-[13.5px]"><Icon name="trophy" size={15} className="inline -mt-0.5 mr-1 text-accent" />Rank <b className="text-ink">{d.data!.rank}</b> of {d.data!.teamSize} in your team · <Link to="/leaderboard" className="font-semibold text-accent-ink hover:underline">Leaderboard</Link></p>}
              </Card>
              <Card title="My leads by status">
                <ul className="flex flex-col gap-2">
                  {d.data!.byStatus.sort((a, b) => b.count - a.count).map((s) => <li key={s.key} className="flex justify-between text-[13.5px]"><span>{s.status}</span><b className="num text-ink">{s.count}</b></li>)}
                  {!d.data!.byStatus.length && <li className="text-muted text-[13px]">No leads yet</li>}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
