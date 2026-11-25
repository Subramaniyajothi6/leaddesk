import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useStatuses } from '../lib/refdata'
import { useAction } from '../lib/hooks'
import { ago, int } from '../lib/format'
import type { LeadRow, Page } from '../lib/types'
import { PageHeader, Spinner, ErrorBox, Empty, useToast, Avatar } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { AddLead } from '../components/AddLead'

type View = { id: string | number; name: string; filters: Record<string, unknown> }
const SORTS = [{ v: 'score', l: 'Best first (score)' }, { v: 'followup', l: 'Next follow-up' }, { v: 'activity', l: 'Last activity' }, { v: 'created', l: 'Newest' }, { v: 'name', l: 'Name A–Z' }]
const KEYS = ['view', 'status', 'q', 'sort', 'page', 'teamId', 'ownerId', 'overdue', 'fresh', 'unattended'] as const

function due(iso: string | null) {
  if (!iso) return <span className="text-faint">—</span>
  const d = new Date(iso)
  const late = d.getTime() < Date.now()
  return <span className={clsx('num', late && 'text-bad font-semibold')}>{late ? 'Overdue · ' : ''}{d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
}

export function Leads() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const params = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? undefined])) as Record<(typeof KEYS)[number], string | undefined>
  const view = params.view && ['all', 'mine', 'unassigned', 'company_pool'].includes(params.view) ? params.view : 'all'
  const statusKeys = params.status ? params.status.split(',') : []
  const page = Number(params.page ?? 1)
  const isManager = user?.role !== 'BDE'
  const [q, setQ] = useState(params.q ?? '')
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
    if (!('page' in patch)) next.delete('page')
    setSp(next, { replace: true })
  }
  useEffect(() => { const t = setTimeout(() => { if ((params.q ?? '') !== q) set({ q: q || undefined }) }, 300); return () => clearTimeout(t) }) // debounce search

  const statuses = useStatuses()
  const views = useQuery({ queryKey: ['lead-views'], queryFn: () => api<View[]>('/leads/views') })
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams'), enabled: isManager })
  const query = { view, status: params.status, q: params.q, sort: params.sort ?? 'score', page, pageSize: 50, teamId: params.teamId, ownerId: params.ownerId, overdue: params.overdue, fresh: params.fresh, unattended: params.unattended }
  const list = useQuery({ queryKey: ['leads', query], queryFn: () => api<Page<LeadRow>>('/leads', { query }), placeholderData: keepPreviousData })

  const [sel, setSel] = useState<Set<number>>(new Set())
  useEffect(() => setSel(new Set()), [sp])
  const rows = list.data?.rows ?? []
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const [assignOpen, setAssignOpen] = useState(false)
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <div className="fade-in">
      <PageHeader title={user?.role === 'BDE' ? 'My leads' : 'Leads'} sub={list.data ? `${int(list.data.total)} leads${params.q ? ` matching “${params.q}”` : ''}` : ' '}>
        <label className="relative">
          <span className="sr-only">Search</span>
          <Icon name="leads" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field pl-9 h-10 w-[min(300px,80vw)]" placeholder="Name, email or last 4 digits" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {user?.role === 'ADMIN' && <><Trash /><AddLead /></>}
      </PageHeader>

      {/* views */}
      <div className="flex flex-wrap items-center gap-2 mb-3" role="tablist" aria-label="Views">
        {views.data?.map((v) => {
          const active = typeof v.id === 'string' ? view === v.id && !params.status && !params.overdue && !params.fresh : false
          return (
            <button key={v.id} role="tab" aria-selected={active} onClick={() => setSp(new URLSearchParams(Object.entries(v.filters).map(([k, x]) => [k, String(x)])), { replace: true })}
              className={clsx('h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer', active ? 'bg-ink text-white border-ink' : 'bg-surface border-line hover:bg-soft')}>{v.name}</button>
          )
        })}
        <button className={clsx('h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer', params.overdue ? 'bg-bad text-white border-bad' : 'bg-surface border-line hover:bg-soft')} onClick={() => set({ overdue: params.overdue ? undefined : 'true' })}>Overdue follow-ups</button>
        {params.unattended && <button className="h-9 px-3.5 rounded-full text-[13px] font-semibold border bg-bad text-white border-bad cursor-pointer" onClick={() => set({ unattended: undefined })}>BDE inactive ✕</button>}
        <button className={clsx('h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer', params.fresh ? 'bg-ink text-white border-ink' : 'bg-surface border-line hover:bg-soft')} onClick={() => set({ fresh: params.fresh ? undefined : 'true' })}>Fresh (not called)</button>
        <SaveView filters={Object.fromEntries(KEYS.filter((k) => k !== 'page' && params[k]).map((k) => [k, params[k]!]))} />
      </div>

      {/* filters */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2 max-md:flex-nowrap max-md:overflow-x-auto max-md:[&>*]:shrink-0">
        <span className="kicker px-1">Status</span>
        {statuses.data?.filter((s) => s.active).map((s) => {
          const on = statusKeys.includes(s.key)
          return (
            <button key={s.key} aria-pressed={on} onClick={() => set({ status: (on ? statusKeys.filter((k) => k !== s.key) : [...statusKeys, s.key]).join(',') || undefined })}
              className={clsx('h-8 px-2.5 rounded-lg text-[12.5px] font-semibold border inline-flex items-center gap-1.5 cursor-pointer', on ? 'bg-accent-soft border-accent/40 text-accent-ink' : 'border-line hover:bg-soft')}>
              <span className="size-2 rounded-full" style={{ background: s.colour }} aria-hidden />{s.label}
            </button>
          )
        })}
        <span className="flex-1" />
        {isManager && (teams.data?.length ?? 0) > 1 && (
          <select className="select h-9" aria-label="Team" value={params.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || undefined })}>
            <option value="">All my teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select className="select h-9" aria-label="Sort" value={params.sort ?? 'score'} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
      </div>

      {isManager && sel.size > 0 && (
        <div className="sticky top-[72px] z-10 mb-3 card px-4 py-2.5 flex flex-wrap items-center gap-3 shadow-lg border-ink/70">
          <b className="text-ink">{sel.size} selected</b>
          <button className="btn-primary btn-sm" onClick={() => setAssignOpen(true)}>Assign to a BDE</button>
          <TakeBack ids={[...sel]} onDone={() => setSel(new Set())} />
          <button className="ml-auto text-[13px] text-muted hover:text-ink cursor-pointer" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {list.isLoading && <Spinner label="Loading leads" />}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.data && !rows.length && <div className="card"><Empty icon="leads" title="No leads here">{params.q || params.status || params.overdue || params.fresh ? 'Try removing a filter.' : user?.role === 'BDE' ? 'New leads appear here when your Team Lead gives them to you.' : 'Upload leads or give them out from the pool.'}</Empty></div>}

      {rows.length > 0 && (
        <>
          {/* desktop table */}
          <div className="card overflow-x-auto max-md:hidden">
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-[12px] text-faint border-b border-line">
                {isManager && <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all on this page" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                {['Lead', 'Status', ...(isManager ? ['Owner'] : []), 'Next follow-up', 'Last activity', 'Score'].map((h) => <th key={h} scope="col" className="py-3 px-3 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={clsx('border-b border-line/70 hover:bg-soft/60 cursor-pointer', sel.has(l.id) && 'bg-accent-soft/40')} onClick={() => nav(`/leads/${l.id}`)}>
                    {isManager && <td className="pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} onChange={() => toggle(l.id)} /></td>}
                    <td className="py-2.5 px-3"><Link to={`/leads/${l.id}`} className="font-semibold text-ink hover:underline" onClick={(e) => e.stopPropagation()}>{l.name}</Link><span className="block text-[12.5px] text-muted num">{l.phone}{l.source && ` · ${l.source}`}</span></td>
                    <td className="px-3"><StatusBadge label={l.status.label} colour={l.status.colour} />{l.attemptCount > 0 && <span className="block text-[11.5px] text-faint mt-0.5">{l.attemptCount} attempt{l.attemptCount > 1 ? 's' : ''}</span>}</td>
                    {isManager && <td className="px-3">{l.owner ? <span className="flex items-center gap-2"><Avatar id={l.owner.id} name={l.owner.name} size={24} />{l.owner.name}</span> : <span className="text-faint">{l.team ? `${l.team.name} pool` : 'Company pool'}</span>}</td>}
                    <td className="px-3">{due(l.nextFollowUpAt)}</td>
                    <td className="px-3 text-muted">{l.lastActivityAt ? ago(l.lastActivityAt) : 'Not touched'}</td>
                    <td className="px-3 num">{l.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* phone cards */}
          <ul className="md:hidden flex flex-col gap-2">
            {rows.map((l) => (
              <li key={l.id} className="card p-3.5 flex gap-3 items-start">
                {isManager && <input type="checkbox" className="mt-1" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} onChange={() => toggle(l.id)} />}
                <Link to={`/leads/${l.id}`} className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2"><b className="text-ink truncate">{l.name}</b><StatusBadge label={l.status.label} colour={l.status.colour} /></span>
                  <span className="block text-[12.5px] text-muted num mt-0.5">{l.phone}{l.owner && isManager ? ` · ${l.owner.name}` : ''}</span>
                  <span className="block text-[12.5px] mt-1">{l.nextFollowUpAt ? due(l.nextFollowUpAt) : <span className="text-faint">No follow-up booked</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
          <nav className="flex items-center justify-between mt-4 text-[13px]" aria-label="Pages">
            <span className="text-muted">Page {page} of {pages}</span>
            <span className="flex gap-2">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
              <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</button>
            </span>
          </nav>
        </>
      )}
      {isManager && <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} leadIds={[...sel]} onDone={() => { setAssignOpen(false); setSel(new Set()) }} />}
    </div>
  )
}

function SaveView({ filters }: { filters: Record<string, string> }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => post('/leads/views', { name, filters }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lead-views'] }); toast(`View “${name}” saved`); setOpen(false); setName('') },
    onError: (e) => toast((e as Error).message, 'bad'),
  })
  if (!Object.keys(filters).length) return null
  return (
    <>
      <button className="h-9 px-3 text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => setOpen(true)}>Save this view</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Save this view">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <label className="flex flex-col gap-1.5"><span className="label">Name</span><input className="field" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interested, Chennai" /></label>
          <button className="btn-primary self-end" disabled={!name.trim() || save.isPending}>Save view</button>
        </form>
      </Modal>
    </>
  )
}

function TakeBack({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const m = useMutation({
    mutationFn: () => post<{ count: number }>('/allocation/take-back', { leadIds: ids, to: 'TEAM_POOL' }),
    onSuccess: (r) => { toast(`${r.count} leads returned to the team pool`); qc.invalidateQueries({ queryKey: ['leads'] }); onDone() },
    onError: (e) => toast((e as Error).message, 'bad'),
  })
  return <button className="btn-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate()}>Return to team pool</button>
}

interface UserRow { id: number; name: string; role: string; state: string; team: { id: number; name: string } | null; openLeads: number }

/** Manual assignment (§5.4): pick a BDE; going over their max needs a typed reason, which the server records. */
export function AssignModal({ open, onClose, leadIds, onDone }: { open: boolean; onClose: () => void; leadIds: number[]; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const users = useQuery({ queryKey: ['users', 'BDE'], queryFn: () => api<UserRow[]>('/users', { query: { role: 'BDE', state: 'ACTIVE' } }), enabled: open })
  const [userId, setUserId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [needReason, setNeedReason] = useState<string | null>(null)
  useEffect(() => { if (open) { setUserId(null); setReason(''); setNeedReason(null) } }, [open])
  const grouped = useMemo(() => {
    const m = new Map<string, UserRow[]>()
    for (const u of users.data ?? []) { const k = u.team?.name ?? 'No team'; m.set(k, [...(m.get(k) ?? []), u]) }
    return [...m]
  }, [users.data])
  const m = useMutation({
    mutationFn: () => post<{ assigned: number; loadAfter: string; overMax: boolean }>('/allocation/assign', { leadIds, userId, ...(reason.trim() && { overMaxReason: reason.trim() }) }),
    onSuccess: (r) => { toast(`${r.assigned} lead(s) assigned · load now ${r.loadAfter}${r.overMax ? ' (over max)' : ''}`); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['lead'] }); onDone() },
    onError: (e) => {
      if (e instanceof ApiError && (e.details as { needsReason?: boolean })?.needsReason) setNeedReason(e.message)
      else toast((e as Error).message, 'bad')
    },
  })
  return (
    <Modal open={open} onClose={onClose} title={`Assign ${leadIds.length} lead${leadIds.length > 1 ? 's' : ''}`}>
      {users.isLoading && <Spinner label="Loading BDEs" />}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
          {grouped.map(([team, list]) => (
            <fieldset key={team}>
              <legend className="kicker mb-1.5">{team}</legend>
              {list.map((u) => (
                <label key={u.id} className={clsx('flex items-center gap-3 p-2.5 rounded-xl border mb-1.5 cursor-pointer', userId === u.id ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-soft')}>
                  <input type="radio" name="bde" checked={userId === u.id} onChange={() => { setUserId(u.id); setNeedReason(null) }} />
                  <Avatar id={u.id} name={u.name} size={28} />
                  <span className="flex-1"><b className="text-ink">{u.name}</b></span>
                  <span className="text-[12.5px] text-muted num">{u.openLeads} open</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {needReason && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] text-warn font-semibold bg-warn-soft rounded-lg px-3 py-2">{needReason}</span>
            <span className="label">Reason (saved in the audit log)</span>
            <input className="field" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Strong closer, these are referrals" />
          </label>
        )}
        <button className="btn-primary self-end" disabled={!userId || m.isPending || (!!needReason && !reason.trim())}>{needReason ? 'Assign over the max' : 'Assign'}</button>
      </form>
    </Modal>
  )
}

/** Deleted leads stay restorable for the trash period (setting). */
function Trash() {
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['leads', 'trash'], queryFn: () => api<{ id: number; name: string; phoneE164: string; deletedAt: string }[]>('/leads/trash'), enabled: open })
  const restore = useAction((id: number) => post(`/leads/${id}/restore`), { success: 'Lead restored', invalidate: ['leads', 'dashboard'] })
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>Trash</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Deleted leads">
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon="leads" title="Trash is empty" /> : (
          <ul className="divide-y divide-line">
            {q.data.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2.5"><span><b className="text-ink">{l.name}</b><span className="block text-[12.5px] text-muted num">{l.phoneE164} · deleted {ago(l.deletedAt)}</span></span><button className="btn-ghost btn-sm" disabled={restore.isPending} onClick={() => restore.mutate(l.id)}>Restore</button></li>)}
          </ul>
        )}
      </Modal>
    </>
  )
}
