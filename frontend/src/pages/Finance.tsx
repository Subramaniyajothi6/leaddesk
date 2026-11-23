import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post } from '../lib/api'
import { useAction, today } from '../lib/hooks'
import { inr, ago } from '../lib/format'
import { Card, PageHeader, Tabs, Table, Field, Badge, Spinner, Kpi, Empty } from '../components/ui'
import { Modal } from '../components/Modal'
import { MonthlyMoney, ShareBars } from '../components/charts'

interface Txn { id: number; kind: 'REVENUE' | 'INVESTMENT'; lead: { id: number; name: string } | null; amountPaise: number; method: string | null; referenceNo: string | null; receivedOn: string; state: 'PENDING' | 'CONFIRMED' | 'CANCELLED'; companyShareBp?: number | null; companySharePaise?: number | null; remainingPaise?: number | null; cancelReason: string | null; notes: string | null; createdAt: string }
interface Dash { period: { from: string; to: string }; shareRule: string; cards: { confirmedRevenuePaise: number; companySharePaise: number; remainingSharePaise: number; investmentPaise: number; profitPaise: number; pendingPaise: number; pendingCount: number }; monthly: { month: string; revenuePaise: number; investmentPaise: number }[]; byTeam: { team: string; revenuePaise: number }[]; bySource: { source: string; revenuePaise: number }[]; pending: Txn[]; unpaid: number; recentCalculations: Calc[] }
interface Calc { id: number; type: string; inputs: Record<string, string>; percentBp: number | null; resultPaise: number | null; remainingPaise: number | null; resultBp: number | null; note: string | null; at: string }

export function Finance() {
  const [tab, setTab] = useState<'overview' | 'transactions' | 'calculators'>('overview')
  const [record, setRecord] = useState(false)
  return (
    <div className="fade-in">
      <PageHeader title="Finance" sub="Admin only. Only confirmed payments count in totals."><button className="btn-primary" onClick={() => setRecord(true)}>Record money in / out</button></PageHeader>
      <Tabs label="Finance" value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'transactions', label: 'Transactions' }, { value: 'calculators', label: 'Calculators & history' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'transactions' && <Transactions />}
      {tab === 'calculators' && <Calculators />}
      <RecordModal open={record} onClose={() => setRecord(false)} admin />
    </div>
  )
}

function Overview() {
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  const q = useQuery({ queryKey: ['finance', 'dash', range], queryFn: () => api<Dash>('/finance/dashboard', { query: range }) })
  if (q.isLoading) return <Spinner />
  const d = q.data!
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="From"><input type="date" className="field h-10" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" className="field h-10" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        <p className="text-[12.5px] text-faint pb-2.5">{d.shareRule}</p>
      </div>
      <section className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Confirmed revenue" value={inr(d.cards.confirmedRevenuePaise)} />
        <Kpi label="Company share" value={inr(d.cards.companySharePaise)} />
        <Kpi label="Remaining share" value={inr(d.cards.remainingSharePaise)} />
        <Kpi label="Investment" value={inr(d.cards.investmentPaise)} />
        <Kpi label="Profit" value={inr(d.cards.profitPaise)} sub="Revenue − investment" />
        <Kpi label="Waiting to confirm" value={inr(d.cards.pendingPaise)} sub={`${d.cards.pendingCount} payment(s)`} />
      </section>
      <PendingList rows={d.pending} />
      {d.unpaid > 0 && <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-soft/50"><span className="text-warn font-semibold">{d.unpaid} converted lead(s) have no payment recorded yet</span><Link to="/leads?status=CONVERTED" className="btn-ghost btn-sm">See converted leads</Link></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Revenue vs investment" note="Last 12 months, confirmed" className="lg:col-span-2"><MonthlyMoney data={d.monthly} /></Card>
        <div className="flex flex-col gap-5">
          <Card title="Revenue by team"><Bars rows={d.byTeam.map((x) => ({ label: x.team, value: x.revenuePaise }))} /></Card>
          <Card title="Revenue by source"><Bars rows={d.bySource.map((x) => ({ label: x.source, value: x.revenuePaise }))} /></Card>
        </div>
      </div>
    </div>
  )
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  if (!rows.length) return <p className="text-muted text-[13px]">No confirmed revenue yet</p>
  const total = rows.reduce((a, r) => a + r.value, 0) || 1
  return <ShareBars rows={rows.map((r) => ({ label: r.label, value: (r.value / total) * 100, sub: inr(r.value) }))} />
}

function PendingList({ rows }: { rows: Txn[] }) {
  const [cancel, setCancel] = useState<Txn | null>(null)
  const confirm = useAction((id: number) => post<Txn>(`/finance/transactions/${id}/confirm`), { success: (t) => `Confirmed · company share ${inr(t.companySharePaise ?? 0)}`, invalidate: ['finance', 'dashboard'] })
  return (
    <Card title={`Payments to confirm (${rows.length})`} note="The company % in force today is copied in when you confirm" strong={rows.length > 0}>
      {!rows.length ? <Empty title="Nothing waiting" /> : (
        <Table head={['Received', 'Lead', 'Amount', 'Method', 'Reference', '']} minWidth={640}>
          {rows.map((t) => <tr key={t.id} className="num"><td>{t.receivedOn.slice(0, 10)}</td><td>{t.lead ? <Link to={`/leads/${t.lead.id}`} className="text-ink font-semibold hover:underline">{t.lead.name}</Link> : <span className="text-muted">Other income</span>}</td><td><b className="text-ink">{inr(t.amountPaise)}</b></td><td>{t.method ?? '—'}</td><td>{t.referenceNo ?? '—'}</td>
            <td className="text-right whitespace-nowrap"><button className="btn-primary btn-sm" disabled={confirm.isPending} onClick={() => confirm.mutate(t.id)}>Confirm</button> <button className="btn-ghost btn-sm" onClick={() => setCancel(t)}>Cancel</button></td></tr>)}
        </Table>
      )}
      <CancelTxn txn={cancel} onClose={() => setCancel(null)} />
    </Card>
  )
}

function CancelTxn({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const m = useAction(() => post(`/finance/transactions/${txn!.id}/cancel`, { reason }), { success: 'Cancelled (kept in history)', invalidate: ['finance', 'dashboard'], onDone: () => { setReason(''); onClose() } })
  return (
    <Modal open={!!txn} onClose={onClose} title={`Cancel ${txn ? inr(txn.amountPaise) : ''}`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <p className="text-[13px] text-muted">A transaction is never edited or deleted. Cancel it with a reason and record it again if needed.</p>
        <Field label="Reason"><input className="field" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn bg-bad text-white self-end" disabled={reason.trim().length < 3 || m.isPending}>Cancel transaction</button>
      </form>
    </Modal>
  )
}

function Transactions() {
  const [state, setState] = useState('')
  const [kind, setKind] = useState('')
  const q = useQuery({ queryKey: ['finance', 'txns', state, kind], queryFn: () => api<{ total: number; rows: Txn[] }>('/finance/transactions', { query: { state, kind } }) })
  const [cancel, setCancel] = useState<Txn | null>(null)
  return (
    <Card title="Transactions" note={q.data ? `${q.data.total} in total` : undefined} action={<span className="flex gap-2"><select className="select" value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">Any state</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option></select><select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">In and out</option><option value="REVENUE">Revenue</option><option value="INVESTMENT">Investment</option></select></span>}>
      {q.isLoading ? <Spinner /> : (
        <Table head={['Received', 'Kind', 'Lead', 'Amount', 'Company %', 'Company share', 'Remaining', 'State', '']} minWidth={900}>
          {q.data?.rows.map((t) => (
            <tr key={t.id} className={clsx('num', t.state === 'CANCELLED' && 'opacity-60')}>
              <td>{t.receivedOn.slice(0, 10)}</td><td>{t.kind === 'REVENUE' ? 'Revenue' : 'Investment'}</td><td>{t.lead?.name ?? '—'}</td><td><b className="text-ink">{inr(t.amountPaise)}</b></td>
              <td>{t.companyShareBp != null ? `${t.companyShareBp / 100}%` : '—'}</td><td>{t.companySharePaise != null ? inr(t.companySharePaise) : '—'}</td><td>{t.remainingPaise != null ? inr(t.remainingPaise) : '—'}</td>
              <td><Badge tone={t.state === 'CONFIRMED' ? 'ok' : t.state === 'PENDING' ? 'warn' : 'neutral'}>{t.state.toLowerCase()}</Badge>{t.cancelReason && <span className="block text-[11.5px] text-faint">{t.cancelReason}</span>}</td>
              <td className="text-right">{t.state !== 'CANCELLED' && <button className="text-[13px] text-muted hover:text-bad cursor-pointer" onClick={() => setCancel(t)}>Cancel</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      <CancelTxn txn={cancel} onClose={() => setCancel(null)} />
    </Card>
  )
}

const CALCS = [
  { type: 'revenue-share', label: 'Revenue share', fields: [['revenue', 'Total revenue (₹)'], ['companyPct', 'Company % (empty = setting)']] },
  { type: 'profit-share', label: 'Profit share', fields: [['investment', 'Investment (₹)'], ['revenue', 'Revenue (₹)'], ['companyPct', 'Company % (empty = setting)']] },
  { type: 'percent-of', label: 'Percent of', fields: [['amount', 'Amount (₹)'], ['pct', 'Percent']] },
  { type: 'discount', label: 'Discount', fields: [['price', 'Price (₹)'], ['pct', 'Discount %']] },
  { type: 'change', label: 'Increase / decrease', fields: [['amount', 'Amount (₹)'], ['pct', 'Percent'], ['direction', 'Direction']] },
  { type: 'growth', label: 'Growth', fields: [['previous', 'Previous (₹)'], ['current', 'Current (₹)']] },
] as const

function Calculators() {
  const [type, setType] = useState<(typeof CALCS)[number]['type']>('revenue-share')
  const [vals, setVals] = useState<Record<string, string>>({ direction: 'UP' })
  const [result, setResult] = useState<(Calc & { remainingPct?: number }) | null>(null)
  const calc = CALCS.find((c) => c.type === type)!
  const hist = useQuery({ queryKey: ['finance', 'calcs'], queryFn: () => api<{ total: number; rows: Calc[] }>('/finance/calculations') })
  const run = useAction(() => post<Calc & { remainingPct?: number }>(`/finance/calc/${type}`, Object.fromEntries(Object.entries(vals).filter(([k, v]) => v !== '' && calc.fields.some(([f]) => f === k)))), { invalidate: ['finance'], onDone: (r) => setResult(r) })
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start">
      <Card>
        <div role="tablist" aria-label="Calculator" className="flex flex-wrap gap-1.5 mb-5">
          {CALCS.map((c) => <button key={c.type} role="tab" aria-selected={type === c.type} onClick={() => { setType(c.type); setResult(null) }} className={clsx('h-9 px-3 rounded-lg text-[13px] font-semibold cursor-pointer', type === c.type ? 'bg-ink text-white' : 'bg-soft text-muted hover:text-ink')}>{c.label}</button>)}
        </div>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(undefined) }}>
          {calc.fields.map(([k, label]) => k === 'direction'
            ? <Field key={k} label={label}><select className="field" value={vals.direction} onChange={(e) => setVals({ ...vals, direction: e.target.value })}><option value="UP">Increase</option><option value="DOWN">Decrease</option></select></Field>
            : <Field key={k} label={label}><input className="field num" inputMode="decimal" value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>)}
          <button className="btn-primary self-end" disabled={run.isPending}>Calculate and save</button>
        </form>
        {result && (
          <div className="mt-5 rounded-2xl bg-accent-soft/50 p-4 fade-in">
            <p className="kicker">Result</p>
            {result.resultPaise != null && type !== 'growth' && <p className="display text-[30px] text-ink num">{inr(result.resultPaise)}</p>}
            {result.resultBp != null && <p className="display text-[30px] text-ink num">{result.resultBp >= 0 ? '+' : ''}{(result.resultBp / 100).toFixed(2)}%</p>}
            <p className="text-[14px] text-text mt-1">{result.note}</p>
          </div>
        )}
      </Card>
      <Card title="History" note="Every calculation is saved and can’t be edited">
        <Table head={['When', 'Calculator', 'Result']} minWidth={420}>
          {hist.data?.rows.map((c) => <tr key={c.id}><td className="text-muted text-[12.5px] whitespace-nowrap">{ago(c.at)}</td><td className="text-ink">{c.type.replace('_', ' ').toLowerCase()}</td><td className="text-[13px]">{c.note}</td></tr>)}
          {!hist.data?.rows.length && <tr><td colSpan={3} className="text-center text-muted py-6">No calculations yet</td></tr>}
        </Table>
      </Card>
    </div>
  )
}

/** Record a payment (Team Lead, for converted leads) or any money in / out (Admin). */
export function RecordModal({ open, onClose, admin, lead }: { open: boolean; onClose: () => void; admin?: boolean; lead?: { id: number; name: string } | null }) {
  const [f, setF] = useState({ kind: 'REVENUE', amount: '', method: 'UPI', referenceNo: '', receivedOn: today(), notes: '' })
  const m = useAction(() => post('/finance/transactions', { kind: f.kind, amount: f.amount, method: f.method, receivedOn: f.receivedOn, ...(lead && { leadId: lead.id }), ...(f.referenceNo && { referenceNo: f.referenceNo }), ...(f.notes && { notes: f.notes }) }), {
    success: admin ? 'Recorded: confirm it from Payments to confirm' : 'Payment recorded, waiting for Admin to confirm', invalidate: ['finance', 'dashboard', 'unpaid'], onDone: () => { setF({ ...f, amount: '', referenceNo: '', notes: '' }); onClose() },
  })
  return (
    <Modal open={open} onClose={onClose} title={lead ? `Payment from ${lead.name}` : 'Record money in / out'}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        {admin && !lead && <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="REVENUE">Revenue (other income)</option><option value="INVESTMENT">Investment</option></select></Field>}
        <Field label="Amount (₹)"><input className="field num" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="50000" /></Field>
        <Field label="Received on"><input className="field" type="date" max={today()} value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} /></Field>
        <Field label="Method"><select className="field" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['UPI', 'Bank transfer', 'Card', 'Cash', 'Cheque'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Reference (optional)"><input className="field" value={f.referenceNo} onChange={(e) => setF({ ...f, referenceNo: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Notes (optional)"><input className="field" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={!Number(f.amount.replace(/,/g, '')) || m.isPending}>Save</button></div>
      </form>
    </Modal>
  )
}
