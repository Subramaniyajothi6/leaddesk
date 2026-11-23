import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useStatuses, useOutcomes, useTemplates, useCustomFields, useSources } from '../lib/refdata'
import { useAction } from '../lib/hooks'
import { ago, time } from '../lib/format'
import type { LeadDetail, Status, TimelineItem, CustomField } from '../lib/types'
import { Card, Spinner, ErrorBox, Badge, useToast } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { FollowUpPicker, emptyFollowUp, followUpBody, type FollowUpValue } from '../components/FollowUpPicker'
import { AssignModal } from './Leads'
import { RecordModal } from './Finance'

const FINAL = ['WON', 'LOST', 'EXCLUDED']

/** Invalidate everything a change to one lead can affect. */
function useRefresh(id: number) {
  const qc = useQueryClient()
  return () => ['lead', 'leads', 'queue', 'dashboard', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: k === 'lead' ? ['lead', id] : [k] }))
}

export function LeadPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const { user } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const q = useQuery({ queryKey: ['lead', id, filter], queryFn: () => api<LeadDetail>(`/leads/${id}`, { query: { filter } }), enabled: Number.isFinite(id) })
  const statuses = useStatuses()
  const [modal, setModal] = useState<null | 'call' | 'status' | 'followup' | 'whatsapp' | 'assign' | 'note' | 'payment'>(null)
  const [presetStatus, setPresetStatus] = useState<number | null>(null)
  useEffect(() => { if (sp.get('call') === '1' && q.data) { setModal('call'); sp.delete('call'); setSp(sp, { replace: true }) } }, [sp, q.data, setSp])

  if (q.isLoading) return <Spinner label="Opening the lead" />
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const l = q.data!
  const isFinal = FINAL.includes(l.status.category)
  const allowed = (statuses.data ?? []).filter((s) => l.allowedNextStatusIds.includes(s.id) && s.active)
  const quick = allowed.filter((s) => s.category === 'WON' || s.key === 'NOT_INTERESTED' || s.key === 'LOST')
  const manager = user?.role !== 'BDE'
  const openStatus = (sid: number | null) => { setPresetStatus(sid); setModal('status') }

  return (
    <div className="fade-in">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-3"><span aria-hidden>←</span> {user?.role === 'BDE' ? 'My leads' : 'Leads'}</Link>

      <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="display text-[34px] sm:text-[40px] leading-[1.05]">{l.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
            <StatusBadge label={l.status.label} colour={l.status.colour} />
            <span>{l.daysInStatus === 0 ? 'Since today' : `${l.daysInStatus} day${l.daysInStatus > 1 ? 's' : ''} in this status`}</span>
            {l.dnd && <Badge tone="bad">Do not call</Badge>}
            <span>· Score {l.score}</span>
            {l.owner ? <span>· {l.owner.name}{l.team ? `, ${l.team.name}` : ''}</span> : <span>· {l.team ? `${l.team.name} pool` : 'Company pool'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isFinal && !l.dnd && <button className="btn-primary" onClick={() => setModal('call')}><Icon name="phone" size={16} />Call</button>}
          {!l.dnd && <button className="btn-ghost" onClick={() => setModal('whatsapp')}>WhatsApp</button>}
          {quick.map((s) => <button key={s.id} className="btn-ghost" onClick={() => openStatus(s.id)}><span className="size-2 rounded-full" style={{ background: s.colour }} aria-hidden />{s.label}</button>)}
          {manager && l.status.category === 'OPEN' && <button className="btn-ghost" onClick={() => setModal('assign')}>{l.owner ? 'Reassign' : 'Assign'}</button>}
          {manager && l.status.category === 'WON' && <button className="btn-primary" onClick={() => setModal('payment')}>Record payment</button>}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5 min-w-0">
          <NextFollowUp lead={l} onBook={() => setModal('followup')} />

          <Card title="Log what happened" note="A call or a status change also completes the follow-ups that are due">
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost btn-sm" onClick={() => openStatus(null)} disabled={isFinal && !manager}>{isFinal ? 'Reopen…' : 'Change status'}</button>
              {!isFinal && <button className="btn-ghost btn-sm" onClick={() => setModal('followup')}><Icon name="calendar" size={15} />Follow-up</button>}
              <button className="btn-ghost btn-sm" onClick={() => setModal('note')}><Icon name="log" size={15} />Note</button>
            </div>
            {isFinal && !manager && <p className="text-[13px] text-muted mt-3">{l.status.label} is a final status. Ask your Team Lead if it needs to be reopened.</p>}
          </Card>

          <Card title="History" action={
            <div role="tablist" aria-label="Filter history" className="flex flex-wrap gap-1">
              {[['all', 'All'], ['calls', 'Calls'], ['status', 'Status'], ['notes', 'Notes'], ['followups', 'Follow-ups'], ['assignments', 'Assignments'], ['payments', 'Payments']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={clsx('h-7 px-2.5 rounded-md text-[12.5px] font-semibold cursor-pointer', filter === k ? 'bg-ink text-white' : 'text-muted hover:bg-soft')}>{label}</button>
              ))}
            </div>
          }>
            <Timeline items={l.timeline} />
          </Card>
        </div>

        <Details lead={l} />
      </div>

      <CallModal open={modal === 'call'} onClose={() => setModal(null)} lead={l} statuses={statuses.data ?? []} />
      <StatusModal open={modal === 'status'} onClose={() => setModal(null)} lead={l} statuses={statuses.data ?? []} preset={presetStatus} />
      <FollowUpModal open={modal === 'followup'} onClose={() => setModal(null)} lead={l} />
      <NoteModal open={modal === 'note'} onClose={() => setModal(null)} leadId={l.id} />
      <WhatsAppModal open={modal === 'whatsapp'} onClose={() => setModal(null)} lead={l} />
      {manager && <RecordModal open={modal === 'payment'} onClose={() => setModal(null)} lead={{ id: l.id, name: l.name }} />}
      {manager && <AssignModal open={modal === 'assign'} onClose={() => setModal(null)} leadIds={[l.id]} onDone={() => setModal(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- side panels

function NextFollowUp({ lead, onBook }: { lead: LeadDetail; onBook: () => void }) {
  const f = lead.nextFollowUp
  const refresh = useRefresh(lead.id)
  const toast = useToast()
  const [mode, setMode] = useState<null | 'move' | 'cancel'>(null)
  const [fu, setFu] = useState<FollowUpValue>(emptyFollowUp())
  const [why, setWhy] = useState('')
  const m = useMutation({
    mutationFn: () => api(`/follow-ups/${f!.id}`, { method: 'PATCH', body: mode === 'move' ? { dueAt: fu.dueAt } : { cancelReason: why } }),
    onSuccess: () => { toast(mode === 'move' ? 'Follow-up moved' : 'Follow-up cancelled'); setMode(null); refresh() },
    onError: (e) => toast((e as Error).message, 'bad'),
  })
  if (FINAL.includes(lead.status.category)) return null
  if (!f) return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-3 border-dashed">
      <span className="text-muted text-[13.5px]">No follow-up booked for this lead.</span>
      <button className="btn-ghost btn-sm" onClick={onBook}>Book one</button>
    </div>
  )
  const overdue = new Date(f.dueAt).getTime() < Date.now()
  return (
    <div className={clsx('card p-4 flex flex-col gap-3', overdue ? 'border-bad/50 bg-bad-soft/30' : 'border-accent/40 bg-accent-soft/30')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="kicker">{overdue ? 'Overdue follow-up' : 'Next follow-up'}</p>
          <p className="text-ink font-semibold text-[15px]">{f.type[0] + f.type.slice(1).toLowerCase()} · {new Date(f.dueAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          {f.reason && <p className="text-[13px] text-muted">{f.reason}{f.auto && ' (booked automatically)'}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setMode(mode === 'move' ? null : 'move')}>Move</button>
          <button className="btn-ghost btn-sm" onClick={() => setMode(mode === 'cancel' ? null : 'cancel')}>Cancel</button>
        </div>
      </div>
      {mode === 'move' && <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex flex-col gap-3 border-t border-line pt-3"><FollowUpPicker value={fu} onChange={setFu} /><button className="btn-primary btn-sm self-end" disabled={!fu.dueAt || m.isPending}>Move follow-up</button></form>}
      {mode === 'cancel' && <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex flex-wrap gap-2 items-end border-t border-line pt-3"><label className="flex-1 min-w-48 flex flex-col gap-1"><span className="label">Why cancel?</span><input className="field" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Customer travelling" /></label><button className="btn-primary btn-sm" disabled={!why.trim() || m.isPending}>Cancel follow-up</button></form>}
    </div>
  )
}

function Details({ lead }: { lead: LeadDetail }) {
  const fields = useCustomFields()
  const { user } = useAuth()
  const nav = useNavigate()
  const [edit, setEdit] = useState(false)
  const del = useAction(() => api(`/leads/${lead.id}`, { method: 'DELETE' }), { success: 'Lead moved to the trash (Leads → Trash to restore)', invalidate: ['leads', 'dashboard'], onDone: () => nav('/leads') })
  const rows: [string, React.ReactNode][] = [
    ['Phone', <span className="num">{lead.phone}</span>],
    ['Email', lead.email ?? '—'],
    ['Source', lead.source?.name ?? '—'],
    ...(fields.data ?? []).filter((f) => f.active).map((f) => [f.label, String(lead.custom[f.key] ?? '—')] as [string, React.ReactNode]),
    ['Call attempts', `${lead.attemptCount}${lead.recycleCount ? ` · recycled ${lead.recycleCount}×` : ''}`],
    ['Last activity', lead.lastActivityAt ? ago(lead.lastActivityAt) : 'Not touched yet'],
    ['Added', new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + (lead.batch ? ` · ${lead.batch.fileName}` : '')],
  ]
  return (
    <Card title="Details" className="self-start" action={<span className="flex gap-3">
      <button className="text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => setEdit(true)}>Edit</button>
      {user?.role === 'ADMIN' && <button className="text-[13px] font-semibold text-muted hover:text-bad cursor-pointer" disabled={del.isPending} onClick={() => { if (window.confirm(`Move ${lead.name} to the trash? It can be restored for the trash period.`)) del.mutate(undefined) }}>Delete</button>}
    </span>}>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2.5 text-[13.5px]"><dt className="text-muted">{k}</dt><dd className="text-ink text-right min-w-0 break-words">{v}</dd></div>)}
      </dl>
      <EditDetails open={edit} onClose={() => setEdit(false)} lead={lead} />
    </Card>
  )
}

/** Edit fields with the version check (a second save over someone else's change is refused, §7.3 rule 6). */
function EditDetails({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: LeadDetail }) {
  const { user } = useAuth()
  const fields = useCustomFields()
  const sources = useSources()
  const refresh = useRefresh(lead.id)
  const init = () => ({ name: lead.name, email: lead.email ?? '', sourceId: lead.source?.id ? String(lead.source.id) : '', phone: '', custom: Object.fromEntries(Object.entries(lead.custom).map(([k, v]) => [k, v == null ? '' : String(v)])) as Record<string, string> })
  const [f, setF] = useState(init)
  useEffect(() => { if (open) setF(init()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = useAction(() => api(`/leads/${lead.id}`, { method: 'PATCH', body: {
    version: lead.version, name: f.name.trim(), email: f.email.trim() || null, sourceId: f.sourceId ? Number(f.sourceId) : null,
    custom: Object.fromEntries(Object.entries(f.custom).filter(([, v]) => v !== '')), ...(f.phone.trim() && { phone: f.phone.trim() }),
  } }), { success: 'Details saved', onDone: () => { refresh(); onClose() }, onError: (e) => { if ((e as ApiError).status === 409) refresh() } })
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${lead.name}`}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <label className="flex flex-col gap-1.5"><span className="label">Name</span><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="flex flex-col gap-1.5"><span className="label">Email</span><input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="flex flex-col gap-1.5"><span className="label">Source</span><select className="field" value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })}><option value="">None</option>{sources.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {user?.role === 'ADMIN' && <label className="flex flex-col gap-1.5"><span className="label">New phone (Admin only)</span><input className="field" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Leave empty to keep" /></label>}
        {fields.data?.filter((x) => x.active).map((x) => (
          <label key={x.key} className="flex flex-col gap-1.5"><span className="label">{x.label}</span>
            {x.type === 'select'
              ? <select className="field" value={f.custom[x.key] ?? ''} onChange={(e) => setF({ ...f, custom: { ...f.custom, [x.key]: e.target.value } })}><option value="">—</option>{x.options?.map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="field" type={x.type === 'number' ? 'number' : x.type === 'date' ? 'date' : 'text'} value={f.custom[x.key] ?? ''} onChange={(e) => setF({ ...f, custom: { ...f.custom, [x.key]: e.target.value } })} />}
          </label>
        ))}
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={!f.name.trim() || m.isPending}>Save</button></div>
      </form>
    </Modal>
  )
}

const KIND: Record<TimelineItem['kind'], { icon: Parameters<typeof Icon>[0]['name']; tone: string }> = {
  call: { icon: 'phone', tone: 'bg-accent-soft text-accent-ink' }, status: { icon: 'check', tone: 'bg-ok-soft text-ok' }, note: { icon: 'log', tone: 'bg-soft text-muted' },
  follow_up: { icon: 'calendar', tone: 'bg-warn-soft text-warn' }, assignment: { icon: 'split', tone: 'bg-soft text-muted' }, payment: { icon: 'rupee', tone: 'bg-ok-soft text-ok' },
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-muted text-[13.5px] py-4 text-center">Nothing here yet</p>
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-line">
      {items.map((t, i) => {
        const k = KIND[t.kind]
        const d = t.data ?? {}
        const extra = [d.remarks, d.reason && typeof d.reason === 'string' ? d.reason : null].filter(Boolean) as string[]
        return (
          <li key={i} className="relative flex gap-3">
            <span className={clsx('relative z-10 size-8 rounded-full grid place-items-center flex-none', k.tone)}><Icon name={k.icon} size={15} /></span>
            <div className="min-w-0 pt-1">
              <p className="text-[13.5px] text-ink"><b className="font-semibold">{t.text}</b>{t.kind === 'follow_up' && typeof d.dueAt === 'string' && <span className="text-muted"> · due {new Date(d.dueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</p>
              {extra.map((x, j) => <p key={j} className="text-[13px] text-text mt-0.5 whitespace-pre-line">{x}</p>)}
              <p className="text-[12px] text-faint mt-0.5">{t.by ?? 'System'} · {new Date(t.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- required custom fields

function FieldInputs({ keys, fields, values, onChange }: { keys: string[]; fields: CustomField[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  if (!keys.length) return null
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label mb-2">Needed for this status</legend>
      {keys.map((k) => {
        const f = fields.find((x) => x.key === k)
        const label = f?.label ?? k
        const set = (v: string) => onChange({ ...values, [k]: v })
        return (
          <label key={k} className="flex flex-col gap-1"><span className="label">{label}</span>
            {f?.type === 'select'
              ? <select className="field" value={values[k] ?? ''} onChange={(e) => set(e.target.value)}><option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="field" type={f?.type === 'number' ? 'number' : f?.type === 'date' ? 'date' : 'text'} value={values[k] ?? ''} onChange={(e) => set(e.target.value)} />}
          </label>
        )
      })}
    </fieldset>
  )
}

/** Shared form for "what is the new status": allowed next statuses, remarks, follow-up, required fields, skip reason. */
interface FormOpts { hideStatus?: boolean; allowNoStatus?: boolean; followUpAlways?: boolean; followUpRequired?: boolean }
function useStatusForm(lead: LeadDetail, statuses: Status[], preset: number | null, o: FormOpts = {}) {
  const { user } = useAuth()
  const fields = useCustomFields()
  const isFinal = FINAL.includes(lead.status.category)
  const options = useMemo(() => {
    if (isFinal) return user?.role === 'BDE' ? statuses.filter((s) => s.key === 'DND') : statuses.filter((s) => s.category === 'OPEN' && s.active) // reopen (§7.2)
    return statuses.filter((s) => lead.allowedNextStatusIds.includes(s.id) && s.active)
  }, [statuses, lead, isFinal, user])
  const [statusId, setStatusId] = useState<number | null>(preset)
  const [remarks, setRemarks] = useState('')
  const [fu, setFu] = useState<FollowUpValue>(emptyFollowUp())
  const [vals, setVals] = useState<Record<string, string>>({})
  const [need, setNeed] = useState<{ followUp?: boolean; next?: boolean; message?: string }>({})
  const [skip, setSkip] = useState('')
  const reset = (p: number | null) => { setStatusId(p); setRemarks(''); setFu(emptyFollowUp()); setVals({}); setNeed({}); setSkip('') }
  const chosen = statuses.find((s) => s.id === statusId) ?? null
  const missing = (chosen?.requiredFields ?? []).filter((k) => lead.custom[k] == null || lead.custom[k] === '')
  const showFollowUp = chosen ? chosen.category === 'OPEN' : !!o.followUpAlways && !FINAL.includes(lead.status.category)
  const followUpRequired = !!need.followUp || !!o.followUpRequired || (!!chosen?.needsFollowUp && !chosen.followUpHours)
  const remarksRequired = !!chosen?.remarksRequired || (isFinal && chosen?.category === 'OPEN')
  const body = () => ({
    ...(statusId && !o.hideStatus && { statusId }), ...(remarks.trim() && { remarks: remarks.trim() }), followUp: showFollowUp ? followUpBody(fu) : undefined,
    ...(missing.length && { fields: Object.fromEntries(missing.map((k) => [k, vals[k]])) }), ...(skip.trim() && { skipNextFollowUpReason: skip.trim() }),
  })
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 422) {
      const d = (e.details ?? {}) as { needsFollowUp?: boolean; needsNextFollowUp?: boolean }
      setNeed({ followUp: d.needsFollowUp || d.needsNextFollowUp, next: d.needsNextFollowUp, message: e.message })
      return true
    }
    return false
  }
  const form = (
    <div className="flex flex-col gap-4">
      {need.message && <p role="alert" className="text-[13.5px] text-warn bg-warn-soft rounded-lg px-3 py-2 font-medium">{need.message}</p>}
      {!o.hideStatus && <label className="flex flex-col gap-1.5"><span className="label">{isFinal ? 'Reopen to' : o.allowNoStatus ? 'New status (optional)' : 'New status'}</span>
        <select className="field" value={statusId ?? ''} onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{o.allowNoStatus ? `Keep ${lead.status.label}` : 'Choose…'}</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>}
      <FieldInputs keys={missing} fields={fields.data ?? []} values={vals} onChange={setVals} />
      <label className="flex flex-col gap-1.5"><span className="label">{remarksRequired ? (isFinal ? 'Reason to reopen (required)' : 'Remarks (required)') : 'Remarks'}</span>
        <textarea className="field h-20 py-2.5" maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What did they say?" />
      </label>
      {showFollowUp && <FollowUpPicker value={fu} onChange={setFu} statusId={chosen?.id} required={followUpRequired} />}
      {showFollowUp && chosen?.needsFollowUp && chosen.followUpHours && !fu.dueAt && <p className="text-[12.5px] text-faint -mt-2">Left empty, the next step is booked automatically.</p>}
      {need.next && <label className="flex flex-col gap-1.5"><span className="label">Or skip the next follow-up, with a reason</span><input className="field" value={skip} onChange={(e) => setSkip(e.target.value)} placeholder="e.g. Customer will call back" /></label>}
    </div>
  )
  const valid = (!!statusId || !!o.allowNoStatus || !!o.hideStatus) && missing.every((k) => vals[k]?.trim()) && (!remarksRequired || !!remarks.trim()) && (!followUpRequired || !!fu.dueAt || !!skip.trim())
  return { form, body, reset, valid, onError, chosen }
}

// ---------------------------------------------------------------- modals

function StatusModal({ open, onClose, lead, statuses, preset }: { open: boolean; onClose: () => void; lead: LeadDetail; statuses: Status[]; preset: number | null }) {
  const f = useStatusForm(lead, statuses, preset)
  const refresh = useRefresh(lead.id)
  const toast = useToast()
  useEffect(() => { if (open) f.reset(preset) }, [open, preset]) // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => post<{ to: string }>(`/leads/${lead.id}/status`, { version: lead.version, ...f.body() }),
    onSuccess: () => { toast(`Status changed to ${f.chosen?.label}`); refresh(); onClose() },
    onError: (e) => { if (!f.onError(e)) { toast((e as Error).message, 'bad'); if ((e as ApiError).status === 409) refresh() } },
  })
  return (
    <Modal open={open} onClose={onClose} title={FINAL.includes(lead.status.category) ? 'Reopen lead' : 'Change status'}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex flex-col gap-5">
        {f.form}
        <div className="sticky -bottom-5 -mx-5 -mb-5 px-5 py-3 bg-surface/95 backdrop-blur border-t border-line flex justify-end"><button className="btn-primary" disabled={!f.valid || m.isPending}>{m.isPending ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

/**
 * Call (§8.1, §12.3): the full number is fetched only now (and logged), the dialer opens, a timer runs.
 * Then the outcome: only a conversation can change the status; Save & next opens the next lead in the queue.
 */
function CallModal({ open, onClose, lead, statuses }: { open: boolean; onClose: () => void; lead: LeadDetail; statuses: Status[] }) {
  const { user } = useAuth()
  const outcomes = useOutcomes()
  const refresh = useRefresh(lead.id)
  const toast = useToast()
  const nav = useNavigate()
  const [step, setStep] = useState<'dial' | 'outcome'>('dial')
  const [number, setNumber] = useState<string | null>(null)
  const [started, setStarted] = useState(0)
  const [secs, setSecs] = useState(0)
  const [outcomeId, setOutcomeId] = useState<number | null>(null)
  const outcome = outcomes.data?.find((o) => o.id === outcomeId)
  const f = useStatusForm(lead, statuses, null, { hideStatus: !!outcome && !outcome.connected, allowNoStatus: true, followUpAlways: true, followUpRequired: !!outcome?.needsFollowUp })
  useEffect(() => {
    if (!open) return
    setStep('dial'); setNumber(null); setOutcomeId(null); f.reset(null)
    post<{ phone: string; tel: string }>(`/leads/${lead.id}/reveal-phone`, { purpose: 'CALL' }).then((r) => {
      setNumber(r.phone); setStarted(Date.now())
      if (window.matchMedia('(pointer: coarse)').matches) window.location.href = r.tel // phones: open the dialer straight away
    }).catch((e) => toast((e as Error).message, 'bad'))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || step !== 'dial' || !started) return
    const t = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(t)
  }, [open, step, started])
  const save = useMutation({
    mutationFn: async (next: boolean) => {
      const b = f.body()
      await post(`/leads/${lead.id}/calls`, {
        version: lead.version, outcomeId, durationSec: secs, startedAt: new Date(started || Date.now()).toISOString(),
        ...b,
      })
      return next
    },
    onSuccess: async (next) => {
      toast('Call saved')
      refresh()
      onClose()
      if (next) {
        const qd = await api<{ queue: { leadId: number }[] }>('/me/queue').catch(() => ({ queue: [] }))
        const n = qd.queue.find((x) => x.leadId !== lead.id)
        if (n) nav(`/leads/${n.leadId}?call=1`); else { toast('That was the last lead in your queue'); nav('/') }
      }
    },
    onError: (e) => { if (!f.onError(e)) { toast((e as Error).message, 'bad'); if ((e as ApiError).status === 409) { refresh(); onClose() } } },
  })
  const mm = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0')
  const canSave = !!outcome && f.valid
  return (
    <Modal open={open} onClose={onClose} title={step === 'dial' ? `Calling ${lead.name}` : 'How did the call go?'}>
      {step === 'dial' ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <span className="size-16 rounded-full bg-accent-soft text-accent grid place-items-center shadow-[0_0_0_10px_rgba(225,29,72,.08)]"><Icon name="phone" size={26} /></span>
          {number ? <a href={`tel:${number}`} className="display text-[30px] num text-ink">{number}</a> : <Spinner label="Getting the number" />}
          <p className="font-mono text-[28px] text-ink" aria-live="off">{mm}</p>
          <p className="text-[12.5px] text-muted max-w-xs">On a laptop, dial from your phone. The number shown here is logged for security.</p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => { setSecs(0); setStep('outcome') }}>Didn’t connect</button>
            <button className="btn-primary" onClick={() => setStep('outcome')}>End call</button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(false) }} className="flex flex-col gap-5">
          <fieldset>
            <legend className="label mb-2">Outcome · {mm}</legend>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {outcomes.data?.filter((o) => o.active).map((o) => (
                <button type="button" key={o.id} aria-pressed={outcomeId === o.id} onClick={() => setOutcomeId(o.id)}
                  className={clsx('h-11 px-3 rounded-xl border text-[13.5px] font-semibold cursor-pointer', outcomeId === o.id ? 'bg-ink text-white border-ink' : 'border-line hover:bg-soft')}>{o.label}</button>
              ))}
            </div>
          </fieldset>
          {outcome && !outcome.connected && <p className="text-[13px] text-muted -mb-2">Not a conversation, so the status stays <b className="text-ink">{lead.status.label}</b>{outcome.countsAsAttempt ? ' and this counts as a call attempt' : ''}.</p>}
          {outcome && f.form}
          <div className="sticky -bottom-5 -mx-5 -mb-5 px-5 py-3 bg-surface/95 backdrop-blur border-t border-line flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" disabled={!canSave || save.isPending}>Save</button>
            {user?.role === 'BDE' && <button type="button" className="btn-primary" disabled={!canSave || save.isPending} onClick={() => save.mutate(true)}>Save &amp; next lead <Icon name="arrow" size={16} /></button>}
          </div>
        </form>
      )}
    </Modal>
  )
}

function FollowUpModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: LeadDetail }) {
  const [fu, setFu] = useState<FollowUpValue>(emptyFollowUp())
  const refresh = useRefresh(lead.id)
  const toast = useToast()
  useEffect(() => { if (open) setFu(emptyFollowUp()) }, [open])
  const m = useMutation({
    mutationFn: () => post(`/follow-ups/lead/${lead.id}`, followUpBody(fu)),
    onSuccess: () => { toast(`Follow-up booked for ${time(fu.dueAt)}`); refresh(); onClose() },
    onError: (e) => toast((e as Error).message, 'bad'),
  })
  return (
    <Modal open={open} onClose={onClose} title="Book a follow-up">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex flex-col gap-5">
        <FollowUpPicker value={fu} onChange={setFu} statusId={lead.statusId} required />
        <button className="btn-primary self-end" disabled={!fu.dueAt || m.isPending}>Book follow-up</button>
      </form>
    </Modal>
  )
}

function NoteModal({ open, onClose, leadId }: { open: boolean; onClose: () => void; leadId: number }) {
  const [body, setBody] = useState('')
  const refresh = useRefresh(leadId)
  const toast = useToast()
  useEffect(() => { if (open) setBody('') }, [open])
  const m = useMutation({ mutationFn: () => post(`/leads/${leadId}/remarks`, { body }), onSuccess: () => { toast('Note added'); refresh(); onClose() }, onError: (e) => toast((e as Error).message, 'bad') })
  return (
    <Modal open={open} onClose={onClose} title="Add a note">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="flex flex-col gap-4">
        <textarea className="field h-32 py-2.5" autoFocus maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything the next person should know" />
        <button className="btn-primary self-end" disabled={!body.trim() || m.isPending}>Add note</button>
      </form>
    </Modal>
  )
}

function WhatsAppModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: LeadDetail }) {
  const templates = useTemplates()
  const [tpl, setTpl] = useState<number | null>(null)
  const refresh = useRefresh(lead.id)
  const toast = useToast()
  const m = useMutation({
    mutationFn: () => post<{ link: string; text: string }>(`/leads/${lead.id}/whatsapp`, tpl ? { templateId: tpl } : {}),
    onSuccess: (r) => { window.open(r.link, '_blank', 'noopener'); toast('WhatsApp opened and logged'); refresh(); onClose() },
    onError: (e) => toast((e as Error).message, 'bad'),
  })
  return (
    <Modal open={open} onClose={onClose} title={`WhatsApp ${lead.name}`}>
      <div className="flex flex-col gap-3">
        {templates.data?.filter((t) => t.active && t.channel === 'WHATSAPP').map((t) => (
          <label key={t.id} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer', tpl === t.id ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-soft')}>
            <input type="radio" name="tpl" checked={tpl === t.id} onChange={() => setTpl(t.id)} />
            <span><b className="text-ink block">{t.name}</b><span className="text-[13px] text-muted">{t.body}</span></span>
          </label>
        ))}
        <label className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer', tpl === null ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-soft')}>
          <input type="radio" name="tpl" checked={tpl === null} onChange={() => setTpl(null)} /><b className="text-ink">No template, I’ll type it</b>
        </label>
        <button className="btn-primary self-end mt-2" disabled={m.isPending} onClick={() => m.mutate()}>Open WhatsApp</button>
      </div>
    </Modal>
  )
}

