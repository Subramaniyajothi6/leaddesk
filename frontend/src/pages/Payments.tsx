import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { inr, ago } from '../lib/format'
import { Card, PageHeader, Table, Badge, Spinner, Empty } from '../components/ui'
import { RecordModal } from './Finance'

/** Team Lead: record payments for converted leads of own teams; they stay pending until Admin confirms (§11.3). */
export function Payments() {
  const unpaid = useQuery({ queryKey: ['unpaid'], queryFn: () => api<{ id: number; name: string; statusChangedAt: string }[]>('/finance/unpaid') })
  const mine = useQuery({ queryKey: ['finance', 'mine'], queryFn: () => api<{ rows: { id: number; lead: { id: number; name: string } | null; amountPaise: number; receivedOn: string; state: string; method: string | null }[] }>('/finance/transactions') })
  const [lead, setLead] = useState<{ id: number; name: string } | null>(null)
  return (
    <div className="fade-in">
      <PageHeader title="Payments" sub="Record money received for converted leads. Admin confirms it before it counts." />
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Card title="Converted, payment not recorded" note="Converted more than the reminder days ago">
          {unpaid.isLoading ? <Spinner /> : !unpaid.data?.length ? <Empty title="Nothing missing" /> : (
            <ul className="divide-y divide-line">
              {unpaid.data.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-3 first:pt-0"><span><Link to={`/leads/${l.id}`} className="font-semibold text-ink hover:underline">{l.name}</Link><span className="block text-[12.5px] text-muted">Converted {ago(l.statusChangedAt)}</span></span><button className="btn-primary btn-sm" onClick={() => setLead(l)}>Record payment</button></li>)}
            </ul>
          )}
          <p className="text-[12.5px] text-faint mt-3">For a newer converted lead, open it from Leads → filter Converted.</p>
        </Card>
        <Card title="Payments I recorded">
          <Table head={['Received', 'Lead', 'Amount', 'State']} minWidth={420}>
            {mine.data?.rows.map((t) => <tr key={t.id} className="num"><td>{t.receivedOn.slice(0, 10)}</td><td className="text-ink">{t.lead?.name ?? '—'}</td><td><b>{inr(t.amountPaise)}</b></td><td><Badge tone={t.state === 'CONFIRMED' ? 'ok' : t.state === 'PENDING' ? 'warn' : 'neutral'}>{t.state.toLowerCase()}</Badge></td></tr>)}
            {!mine.data?.rows.length && <tr><td colSpan={4} className="text-center text-muted py-6">None yet</td></tr>}
          </Table>
        </Card>
      </div>
      <RecordModal open={!!lead} onClose={() => setLead(null)} lead={lead} />
    </div>
  )
}
