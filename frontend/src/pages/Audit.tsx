import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, PageHeader, Table, Field, Spinner, Badge } from '../components/ui'

interface Row { id: number; actorId: number | null; action: string; entity: string; entityId: string | null; before: unknown; after: unknown; ip: string | null; at: string }
const ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'USER_CREATE', 'USER_STATE', 'USER_TRANSFER', 'SETTINGS_CHANGE', 'IMPORT', 'ALLOCATE_TEAMS', 'DISTRIBUTE', 'ASSIGN', 'ASSIGN_OVER_MAX', 'TAKE_BACK', 'BULK_UNDO', 'STATUS_REOPEN', 'PHONE_REVEAL', 'EXPORT', 'ATTENDANCE_CORRECT', 'TXN_RECORD', 'TXN_CONFIRM', 'TXN_CANCEL', 'LEAD_DELETE']

/** Read-only: the API has no way to change or delete these rows, and the database refuses it too. */
export function Audit() {
  const [f, setF] = useState({ action: '', entity: '', from: '', to: '', page: 1 })
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api<{ rows: Row[]; total: number; pageSize: number }>('/audit', { query: f }) })
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => api<{ id: number; name: string }[]>('/users') })
  const who = (id: number | null) => (id ? users.data?.find((u) => u.id === id)?.name ?? `#${id}` : 'System')
  const [open, setOpen] = useState<number | null>(null)
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1
  return (
    <div className="fade-in">
      <PageHeader title="Audit log" sub="Who changed what and when. Nothing here can be edited or deleted." />
      <Card>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <Field label="Action"><select className="field h-10" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}><option value="">All</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="About"><select className="field h-10" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value, page: 1 })}><option value="">Anything</option>{['user', 'team', 'lead', 'settings', 'allocation_run', 'attendance', 'transaction', 'report', 'import_batch', 'status'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="From"><input type="date" className="field h-10" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} /></Field>
          <Field label="To"><input type="date" className="field h-10" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} /></Field>
        </div>
        {q.isLoading ? <Spinner /> : (
          <Table head={['When', 'Who', 'Action', 'About', 'Details']} minWidth={760}>
            {q.data?.rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="num whitespace-nowrap text-[12.5px]">{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                <td className="text-ink">{who(r.actorId)}{r.ip && <span className="block text-[11.5px] text-faint">{r.ip}</span>}</td>
                <td><Badge tone={r.action.includes('FAILED') || r.action.includes('OVER_MAX') || r.action.includes('CANCEL') ? 'warn' : 'neutral'}>{r.action.toLowerCase().replace(/_/g, ' ')}</Badge></td>
                <td className="text-[13px]">{r.entity}{r.entityId && ` #${r.entityId}`}</td>
                <td className="text-[12px]">
                  {(r.before != null || r.after != null) && <button className="font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Show'}</button>}
                  {open === r.id && <div className="grid gap-2 mt-2 md:grid-cols-2">{r.before != null && <pre className="bg-soft rounded-lg p-2 overflow-auto max-h-48 text-[11px]"><b>Before</b>{'\n'}{JSON.stringify(r.before, null, 1)}</pre>}{r.after != null && <pre className="bg-soft rounded-lg p-2 overflow-auto max-h-48 text-[11px]"><b>After</b>{'\n'}{JSON.stringify(r.after, null, 1)}</pre>}</div>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <nav className="flex items-center justify-between mt-4 text-[13px]" aria-label="Pages"><span className="text-muted">{q.data?.total ?? 0} entries · page {f.page} of {pages}</span><span className="flex gap-2"><button className="btn-ghost btn-sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button><button className="btn-ghost btn-sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></span></nav>
      </Card>
    </div>
  )
}
