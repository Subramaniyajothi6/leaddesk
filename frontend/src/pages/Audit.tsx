import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { Card, PageHeader, Field, Spinner, Empty, Avatar } from '../components/ui'

interface Row { id: number; actorId: number | null; action: string; entity: string; entityId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip: string | null; at: string }

const PAGE_SIZE = 12

/** Plain-language groups for the one filter. Each maps to the audit actions it covers. */
const GROUPS: [string, string[]][] = [
  ['Sign-ins', ['LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'PASSWORD_RESET']],
  ['People & teams', ['USER_CREATE', 'USER_UPDATE', 'USER_STATE', 'USER_TRANSFER', 'MATCH_VALUES', 'TEAM_CREATE', 'TEAM_UPDATE', 'TEAM_LEAD_LINK', 'TEAM_MEMBER_ADD', 'TEAM_DEACTIVATE']],
  ['Leads', ['LEAD_CREATE', 'LEAD_UPDATE', 'LEAD_DELETE', 'LEAD_RESTORE', 'LEAD_MERGE', 'IMPORT', 'STATUS_REOPEN', 'PHONE_REVEAL']],
  ['Allocation', ['ALLOCATE_TEAMS', 'DISTRIBUTE', 'ASSIGN', 'ASSIGN_OVER_MAX', 'TAKE_BACK', 'MOVE_POOL', 'BULK_UNDO', 'LIMIT_SET']],
  ['Attendance', ['ATTENDANCE_CORRECT', 'ATTENDANCE_REJECT', 'TIME_OFF', 'TIME_OFF_DELETE']],
  ['Finance', ['TXN_RECORD', 'TXN_CONFIRM', 'TXN_CANCEL']],
  ['Settings', ['SETTINGS_CHANGE', 'STATUS_CREATE', 'STATUS_UPDATE', 'STATUS_TRANSITIONS', 'CUSTOM_FIELD', 'HOLIDAY_SET', 'HOLIDAY_DELETE', 'TARGET_SET', 'CALLOUTCOME_CREATE', 'CALLOUTCOME_UPDATE', 'LEADSOURCE_CREATE', 'LEADSOURCE_UPDATE', 'MESSAGETEMPLATE_CREATE', 'MESSAGETEMPLATE_UPDATE', 'SCORINGRULE_CREATE', 'SCORINGRULE_UPDATE']],
  ['Exports', ['EXPORT']],
]

const val = (r: Row, k: string) => (r.after?.[k] ?? r.before?.[k]) as string | number | undefined
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>

/** Turn one audit row into a short sentence (what was done, to what). */
function describe(r: Row, userName: (id: number) => string): ReactNode {
  const id = r.entityId
  const lead = <Link to={`/leads/${id}`} className="font-semibold text-accent-ink hover:underline">{val(r, 'name') ?? `lead #${id}`}</Link>
  const user = <B>{val(r, 'name') ?? (id ? userName(Number(id)) : 'a user')}</B>
  const name = (fallback: string) => <B>{val(r, 'name') ?? val(r, 'label') ?? fallback}</B>
  switch (r.action) {
    case 'LOGIN': return 'signed in'
    case 'LOGIN_FAILED': return <span className="text-warn font-semibold">failed to sign in</span>
    case 'PASSWORD_CHANGE': return 'changed their password'
    case 'PASSWORD_RESET': return <>reset the password of {user}</>
    case 'USER_CREATE': return <>added {user}</>
    case 'USER_UPDATE': return <>edited {user}’s details</>
    case 'USER_STATE': return <>set {id ? <B>{userName(Number(id))}</B> : 'a user'} to <B>{String(val(r, 'state')).toLowerCase() === 'exited' ? 'left the company' : String(val(r, 'state') ?? '').toLowerCase()}</B></>
    case 'USER_TRANSFER': return <>moved <B>{userName(Number(id))}</B> to another team</>
    case 'MATCH_VALUES': return <>set what <B>{userName(Number(id))}</B> can handle for matching</>
    case 'TEAM_CREATE': return <>created team {name('#' + id)}</>
    case 'TEAM_UPDATE': return <>edited team {name('#' + id)}</>
    case 'TEAM_LEAD_LINK': return <>changed the Team Lead of team #{id}</>
    case 'TEAM_MEMBER_ADD': return <>added a BDE to team #{id}</>
    case 'TEAM_DEACTIVATE': return <>deactivated team #{id}</>
    case 'SETTINGS_CHANGE': return <>changed the <B>{id}</B> settings</>
    case 'STATUS_CREATE': return <>added the status {name('')}</>
    case 'STATUS_UPDATE': return <>edited the status {name('')}</>
    case 'STATUS_TRANSITIONS': return <>changed which statuses can follow status #{id}</>
    case 'CUSTOM_FIELD': return <>saved the custom field {name(String(id))}</>
    case 'HOLIDAY_SET': return <>set a holiday on <B>{id}</B></>
    case 'HOLIDAY_DELETE': return <>removed the holiday on <B>{id}</B></>
    case 'TARGET_SET': return <>set a <B>{String(val(r, 'metric') ?? '').replace('_', ' ')}</B> target</>
    case 'LIMIT_SET': return <>changed lead limits ({id?.toLowerCase().replace(':', ' #')})</>
    case 'IMPORT': return <>uploaded <B>{String(val(r, 'file') ?? 'a file')}</B>: {val(r, 'added') ?? 0} added, {val(r, 'duplicates') ?? 0} duplicates, {val(r, 'rejected') ?? 0} errors</>
    case 'LEAD_CREATE': return <>added {lead} by hand</>
    case 'LEAD_UPDATE': return <>edited {lead}</>
    case 'LEAD_DELETE': return <>deleted {lead}</>
    case 'LEAD_RESTORE': return <>restored {lead}</>
    case 'LEAD_MERGE': return <>merged upload data into {lead}</>
    case 'STATUS_REOPEN': return <>reopened {lead}: {String(val(r, 'reason') ?? '')}</>
    case 'PHONE_REVEAL': return <>viewed the phone number of {lead}{val(r, 'purpose') === 'WHATSAPP' ? ' (WhatsApp)' : ''}</>
    case 'ALLOCATE_TEAMS': return <>gave leads from the company pool to teams</>
    case 'DISTRIBUTE': return <>gave <B>{val(r, 'given') ?? 0}</B> leads from a team pool to BDEs ({String(val(r, 'method') ?? '').toLowerCase()})</>
    case 'ASSIGN': return <>assigned leads by hand</>
    case 'ASSIGN_OVER_MAX': return <>assigned leads <span className="text-warn font-semibold">over a BDE’s max</span>{val(r, 'reason') ? `: “${val(r, 'reason')}”` : ''}</>
    case 'TAKE_BACK': return <>took back <B>{val(r, 'count') ?? ''}</B> leads to the {val(r, 'to') === 'COMPANY_POOL' ? 'company' : 'team'} pool</>
    case 'MOVE_POOL': return <>moved <B>{val(r, 'moved') ?? ''}</B> leads between team pools</>
    case 'BULK_UNDO': return <>undid an allocation ({val(r, 'restored') ?? 0} leads put back)</>
    case 'ATTENDANCE_CORRECT': return <>corrected attendance</>
    case 'ATTENDANCE_REJECT': return <>rejected an attendance correction</>
    case 'TIME_OFF': return <>marked leave for <B>{userName(Number(val(r, 'userId')))}</B></>
    case 'TIME_OFF_DELETE': return <>removed a leave entry</>
    case 'TXN_RECORD': return <>recorded a payment</>
    case 'TXN_CONFIRM': return <>confirmed a payment</>
    case 'TXN_CANCEL': return <span>cancelled a payment</span>
    case 'EXPORT': return <>exported the <B>{id}</B> report ({String(val(r, 'format') ?? '').toUpperCase()})</>
    default: {
      const m = /^(CALLOUTCOME|LEADSOURCE|MESSAGETEMPLATE|SCORINGRULE)_(CREATE|UPDATE)$/.exec(r.action)
      if (m) return <>{m[2] === 'CREATE' ? 'added' : 'edited'} the {{ CALLOUTCOME: 'call outcome', LEADSOURCE: 'lead source', MESSAGETEMPLATE: 'WhatsApp template', SCORINGRULE: 'scoring rule' }[m[1]]} {name('#' + id)}</>
      return r.action.toLowerCase().replace(/_/g, ' ')
    }
  }
}

/** ::1 / 127.0.0.1 = the same computer the app runs on. */
const place = (ip: string | null) => (!ip ? 'unknown' : ip === '::1' || ip === '127.0.0.1' ? 'this computer (local)' : ip)

/** Read-only: the API has no way to change or delete these rows, and the database refuses it too. */
export function Audit() {
  const [f, setF] = useState({ group: '', from: '', to: '', page: 1 })
  const action = GROUPS.find(([g]) => g === f.group)?.[1].join(',')
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api<{ rows: Row[]; names: Record<string, string>; total: number }>('/audit', { query: { action, from: f.from, to: f.to, page: f.page, pageSize: PAGE_SIZE } }) })
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => api<{ id: number; name: string }[]>('/users') })
  const userName = (id: number) => q.data?.names[id] ?? users.data?.find((u) => u.id === id)?.name ?? `user #${id}`
  const [open, setOpen] = useState<number | null>(null)
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch, page: patch.page ?? 1 })

  return (
    <div className="fade-in">
      <PageHeader title="Audit log" sub="Who did what and when. Nothing here can be edited or deleted." />
      <Card>
        <div className="flex flex-wrap gap-3 items-end mb-2">
          <Field label="What"><select className="field h-10 w-52" value={f.group} onChange={(e) => set({ group: e.target.value })}><option value="">Everything</option>{GROUPS.map(([g]) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="From"><input type="date" className="field h-10" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To"><input type="date" className="field h-10" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          {(f.group || f.from || f.to) && <button className="btn-ghost h-10" onClick={() => setF({ group: '', from: '', to: '', page: 1 })}>Clear</button>}
        </div>

        {q.isLoading ? <Spinner /> : !q.data?.rows.length ? <Empty icon="log" title="Nothing recorded for this filter" /> : (
          <ul className="divide-y divide-line">
            {q.data.rows.map((r) => {
              const hasDetails = r.before != null || r.after != null || !!r.ip
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-start gap-3">
                    {r.actorId ? <Avatar id={r.actorId} name={userName(r.actorId)} size={30} /> : <span className="size-[30px] rounded-full bg-soft grid place-items-center text-[11px] font-bold text-muted flex-none">SYS</span>}
                    <p className="flex-1 min-w-0 text-[14px] leading-snug pt-1">
                      <B>{r.actorId ? userName(r.actorId) : 'System'}</B> {describe(r, userName)}
                    </p>
                    <span className="text-[12.5px] text-faint num whitespace-nowrap pt-1">{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {hasDetails && <button className="text-[12.5px] font-semibold text-accent-ink hover:underline cursor-pointer pt-1 w-12 text-right" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button>}
                  </div>
                  {open === r.id && (
                    <div className="mt-2 ml-[42px] flex flex-col gap-2 text-[12px]">
                      <p className="text-muted">From: {place(r.ip)} · exact time {new Date(r.at).toLocaleString('en-IN')} · {r.entity}{r.entityId ? ` #${r.entityId}` : ''}</p>
                      <div className={clsx('grid gap-2', r.before && r.after && 'md:grid-cols-2')}>
                        {r.before != null && <pre className="bg-soft rounded-lg p-2.5 overflow-auto max-h-56"><b>Before</b>{'\n'}{JSON.stringify(r.before, null, 1)}</pre>}
                        {r.after != null && <pre className="bg-soft rounded-lg p-2.5 overflow-auto max-h-56"><b>After</b>{'\n'}{JSON.stringify(r.after, null, 1)}</pre>}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <nav className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-4 border-t border-line text-[13px]" aria-label="Pages">
          <span className="text-muted">{q.data ? `${((f.page - 1) * PAGE_SIZE + 1).toLocaleString('en-IN')}–${Math.min(f.page * PAGE_SIZE, q.data.total).toLocaleString('en-IN')} of ${q.data.total.toLocaleString('en-IN')}` : ''}</span>
          <span className="flex items-center gap-2">
            <button className="btn-ghost btn-sm" disabled={f.page <= 1} onClick={() => set({ page: f.page - 1 })}>Previous</button>
            <span className="text-muted num">Page {f.page} of {pages}</span>
            <button className="btn-ghost btn-sm" disabled={f.page >= pages} onClick={() => set({ page: f.page + 1 })}>Next</button>
          </span>
        </nav>
      </Card>
    </div>
  )
}
