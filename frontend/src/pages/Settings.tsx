import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post } from '../lib/api'
import { useAction, today } from '../lib/hooks'
import { useStatuses, useOutcomes, useSources, useCustomFields, useTemplates } from '../lib/refdata'
import type { Status } from '../lib/types'
import { Card, PageHeader, Table, Field, Badge, Spinner } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'

type Settings = Record<string, Record<string, unknown>>
type F = { path: string; label: string; type: 'text' | 'number' | 'bool' | 'select' | 'time' | 'weekdays' | 'pct' | 'roles' | 'list'; options?: [string, string][]; hint?: string }

/** Setting groups as forms. `pct` is stored in basis points and shown as %. */
const GROUPS: Record<string, { title: string; note: string; fields: F[] }> = {
  company: { title: 'Company', note: 'Name, time zone and what a lead is called', fields: [
    { path: 'name', label: 'Company name', type: 'text' }, { path: 'timeZone', label: 'Time zone', type: 'text', hint: 'e.g. Asia/Kolkata' },
    { path: 'country', label: 'Default phone country', type: 'text', hint: 'Two letters, e.g. IN' }, { path: 'currency', label: 'Currency', type: 'text' },
    { path: 'labels.lead', label: 'A lead is called', type: 'text', hint: 'Lead, Candidate, Student, Customer…' }, { path: 'labels.leads', label: 'Plural', type: 'text' },
  ] },
  allocation: { title: 'Allocation', note: 'Limits, weights and refills (§5.7)', fields: [
    { path: 'stage1Method', label: 'Default split to teams', type: 'select', options: [['EQUAL', 'Equal'], ['CAPACITY', 'By free capacity'], ['MANUAL', 'Manual']] },
    { path: 'maxOpen', label: 'Max open leads per BDE', type: 'number' }, { path: 'maxPerDay', label: 'Max new leads per BDE per day', type: 'number' },
    { path: 'weights.load', label: 'Smart weight: room left', type: 'number' }, { path: 'weights.match', label: 'Smart weight: matching', type: 'number' }, { path: 'weights.perf', label: 'Smart weight: performance', type: 'number' },
    { path: 'perfWindowDays', label: 'Performance window (days)', type: 'number' }, { path: 'perfMinLeads', label: 'Min leads before performance counts', type: 'number' },
    { path: 'punchInRequired', label: 'Only BDEs who punched in get leads', type: 'bool' }, { path: 'lowLeadMark', label: '“Needs leads” when fresh leads reach', type: 'number' },
    { path: 'refillSize', label: 'Auto-refill size', type: 'number' }, { path: 'autoReturnOnExit', label: 'Return open leads to the pool when a BDE leaves', type: 'bool' },
    { path: 'matching.enabled', label: 'Match leads to BDEs (language, city…)', type: 'bool' },
  ] },
  leads: { title: 'Leads', note: 'Duplicates, trash and uploads', fields: [
    { path: 'duplicateRule', label: 'A duplicate is the same', type: 'select', options: [['PHONE_OR_EMAIL', 'Phone or email'], ['PHONE', 'Phone'], ['EMAIL', 'Email']] },
    { path: 'trashDays', label: 'Keep deleted leads for (days)', type: 'number' }, { path: 'maxUploadMb', label: 'Max upload size (MB)', type: 'number' },
  ] },
  calls: { title: 'Calls', note: 'Power dialer behaviour', fields: [{ path: 'leaveOutCalledToday', label: 'Leave out leads already called today', type: 'bool' }, { path: 'wrapUpSec', label: 'Wrap-up seconds before the next call', type: 'number' }] },
  automation: { title: 'Automatic follow-ups', note: 'The three rules of §8.2', fields: [
    { path: 'firstCall.on', label: 'First call: book a call when a lead is assigned', type: 'bool' }, { path: 'firstCall.minutes', label: 'First call within (working minutes)', type: 'number' },
    { path: 'nextStep.on', label: 'Next step: book the status’s follow-up if none was booked', type: 'bool' }, { path: 'keepMoving.on', label: 'Keep it moving: ask for the next follow-up after one is done', type: 'bool' },
  ] },
  followUps: { title: 'Reminders', note: 'In-app and push reminders', fields: [{ path: 'reminderMinutes', label: 'Remind this many minutes before', type: 'number' }] },
  recycling: { title: 'Recycling', note: 'Leads that can’t be reached (§7.3)', fields: [
    { path: 'maxAttempts', label: 'Failed attempts before recycling', type: 'number' }, { path: 'minSpreadHours', label: 'Spread over at least (hours)', type: 'number' }, { path: 'maxRecycles', label: 'Recycles before the lead becomes Lost', type: 'number' },
  ] },
  attendance: { title: 'Attendance', note: 'Shift and day-status rules (§10.2)', fields: [
    { path: 'shiftStart', label: 'Shift start', type: 'time' }, { path: 'shiftEnd', label: 'Shift end', type: 'time' }, { path: 'weekOffs', label: 'Week-offs', type: 'weekdays' },
    { path: 'graceLateMin', label: 'Late after (minutes of grace)', type: 'number' }, { path: 'graceEarlyMin', label: 'Early out grace (minutes)', type: 'number' },
    { path: 'fullDayMin', label: 'Full day minimum (minutes)', type: 'number' }, { path: 'halfDayMin', label: 'Half day minimum (minutes)', type: 'number' },
    { path: 'absentCutoffMin', label: 'Absent if no punch-in this many minutes after start', type: 'number' }, { path: 'autoCloseAt', label: 'Close missing punch-outs at', type: 'time' },
    { path: 'missingPunchOutCounts', label: 'Missing punch-out counts as', type: 'select', options: [['HALF_DAY', 'Half day'], ['PRESENT', 'Present'], ['ABSENT', 'Absent']] },
    { path: 'officeIps', label: 'Office IP addresses (empty = anywhere)', type: 'list', hint: 'One per line; end with * for a range' },
    { path: 'captureLocation', label: 'Ask for location at punch-in', type: 'bool' }, { path: 'tlCanCorrect', label: 'Team Leads can correct their team’s attendance', type: 'bool' }, { path: 'tlPunch', label: 'Team Leads punch in too', type: 'bool' },
  ] },
  performance: { title: 'Performance', note: 'How conversion % is counted (§9.3)', fields: [
    { path: 'periodRule', label: 'Period rule', type: 'select', options: [['COHORT', 'Cohort: of the leads assigned in the period'], ['ACTIVITY', 'Activity: conversions that happened in the period']] },
    { path: 'redBelowPct', label: 'Show red below this % of target', type: 'number' }, { path: 'leaderboardVisibleTo', label: 'Leaderboard visible to', type: 'roles' },
  ] },
  reports: { title: 'Exports', note: 'Who can download what', fields: [{ path: 'tlCanExport', label: 'Team Leads can export their teams’ reports', type: 'bool' }, { path: 'bdeCanExportSummary', label: 'BDEs can export their own summary (never lead data)', type: 'bool' }] },
  finance: { title: 'Finance', note: 'Shares and payment rules', fields: [
    { path: 'companyShareBp', label: 'Company share %', type: 'pct', hint: 'Copied into each payment when it is confirmed' }, { path: 'unpaidReminderDays', label: 'Flag converted leads unpaid after (days)', type: 'number' },
    { path: 'tlCanRecordPayments', label: 'Team Leads can record payments', type: 'bool' },
  ] },
}
const SECTIONS: [string, string][] = [['company', 'Company'], ['statuses', 'Lead statuses'], ['allocation', 'Allocation'], ['leads', 'Leads, fields & sources'], ['calls', 'Calls & outcomes'], ['automation', 'Follow-ups & automation'], ['recycling', 'Recycling'], ['attendance', 'Attendance & holidays'], ['performance', 'Performance & targets'], ['messages', 'WhatsApp templates'], ['reports', 'Exports'], ['finance', 'Finance']]

const get = (o: Record<string, unknown>, p: string) => p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o)
function set(o: Record<string, unknown>, p: string, v: unknown) { const out = structuredClone(o); const ks = p.split('.'); let c = out; for (const k of ks.slice(0, -1)) c = (c[k] ??= {}) as Record<string, unknown>; c[ks.at(-1)!] = v; return out }

export function SettingsPage() {
  const [sec, setSec] = useState('company')
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })
  return (
    <div className="fade-in">
      <PageHeader title="Settings" sub="Every rule here is stored in the database. Each change is recorded with who and when (Audit log)." />
      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] items-start">
        <nav aria-label="Setting areas" className="card p-2 flex lg:flex-col gap-0.5 max-lg:overflow-x-auto lg:sticky lg:top-24">
          {SECTIONS.map(([k, l]) => <button key={k} onClick={() => setSec(k)} aria-current={sec === k ? 'page' : undefined} className={clsx('text-left px-3 py-2 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer', sec === k ? 'bg-ink text-white' : 'hover:bg-soft')}>{l}</button>)}
        </nav>
        <div className="flex flex-col gap-5 min-w-0">
          {!s.data ? <Spinner /> : (
            <>
              {GROUPS[sec] && <GroupForm group={sec} value={s.data[sec]} />}
              {sec === 'statuses' && <Statuses />}
              {sec === 'leads' && <><CustomFields /><Sources /><Scoring /></>}
              {sec === 'calls' && <Outcomes />}
              {sec === 'automation' && <GroupForm group="followUps" value={s.data.followUps} />}
              {sec === 'attendance' && <Holidays />}
              {sec === 'performance' && <Targets />}
              {sec === 'messages' && <Templates />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function GroupForm({ group, value }: { group: string; value: Record<string, unknown> }) {
  const g = GROUPS[group]
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const dirty = JSON.stringify(v) !== JSON.stringify(value)
  const save = useAction(() => api(`/settings/${group}`, { method: 'PATCH', body: v }), { success: `${g.title} saved`, invalidate: ['settings', 'ref', 'dashboard'] })
  const input = (f: F) => {
    const cur = get(v, f.path)
    const ch = (x: unknown) => setV(set(v, f.path, x))
    switch (f.type) {
      case 'bool': return <label key={f.path} className="flex items-center justify-between gap-4 py-2 text-[14px] sm:col-span-2"><span>{f.label}{f.hint && <span className="block text-[12px] text-faint">{f.hint}</span>}</span><input type="checkbox" className="size-5 accent-[#e11d48]" checked={!!cur} onChange={(e) => ch(e.target.checked)} /></label>
      case 'select': return <Field key={f.path} label={f.label} hint={f.hint}><select className="field" value={String(cur)} onChange={(e) => ch(e.target.value)}>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      case 'number': return <Field key={f.path} label={f.label} hint={f.hint}><input className="field num" type="number" value={String(cur ?? '')} onChange={(e) => ch(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
      case 'pct': return <Field key={f.path} label={f.label} hint={f.hint}><input className="field num" type="number" step="0.01" min={0} max={100} value={Number(cur) / 100} onChange={(e) => ch(Math.round(Number(e.target.value) * 100))} /></Field>
      case 'time': return <Field key={f.path} label={f.label}><input className="field" type="time" value={String(cur)} onChange={(e) => ch(e.target.value)} /></Field>
      case 'list': return <Field key={f.path} label={f.label} hint={f.hint}><textarea className="field h-20 py-2" value={((cur as string[]) ?? []).join('\n')} onChange={(e) => ch(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} /></Field>
      case 'weekdays': {
        const days = (cur as number[]) ?? []
        return <fieldset key={f.path} className="sm:col-span-2"><legend className="label mb-1.5">{f.label}</legend><div className="flex flex-wrap gap-1.5">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => ch(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())} className={clsx('h-9 w-12 rounded-lg border text-[13px] font-semibold cursor-pointer', days.includes(i) ? 'bg-ink text-white border-ink' : 'border-line')}>{d}</button>)}</div></fieldset>
      }
      case 'roles': {
        const roles = (cur as string[]) ?? []
        return <fieldset key={f.path} className="sm:col-span-2"><legend className="label mb-1.5">{f.label}</legend><div className="flex gap-4">{[['ADMIN', 'Admin'], ['TEAM_LEAD', 'Team Lead'], ['BDE', 'BDE']].map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={roles.includes(k)} onChange={() => ch(roles.includes(k) ? roles.filter((x) => x !== k) : [...roles, k])} />{l}</label>)}</div></fieldset>
      }
      default: return <Field key={f.path} label={f.label} hint={f.hint}><input className="field" value={String(cur ?? '')} onChange={(e) => ch(e.target.value)} /></Field>
    }
  }
  return (
    <Card title={g.title} note={g.note}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }}>
        {g.fields.map(input)}
        <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-line">
          {dirty && <button type="button" className="btn-ghost" onClick={() => setV(value)}>Discard</button>}
          <button className="btn-primary" disabled={!dirty || save.isPending}>Save changes</button>
        </div>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------- statuses

function Statuses() {
  const q = useStatuses()
  const fields = useCustomFields()
  const [edit, setEdit] = useState<Status | 'new' | null>(null)
  return (
    <Card title="Lead statuses" note="Allowed next statuses decide what a BDE can pick. Empty = any change allowed." action={<button className="btn-primary btn-sm" onClick={() => setEdit('new')}>Add status</button>}>
      <Table head={['Status', 'Type', 'Counts as contacted', 'Needs follow-up', 'Required fields', 'Can change to', '']} minWidth={860}>
        {q.data?.map((s) => (
          <tr key={s.id} className={clsx(!s.active && 'opacity-50')}>
            <td><StatusBadge label={s.label} colour={s.colour} /></td>
            <td><Badge tone={s.category === 'WON' ? 'ok' : s.category === 'OPEN' ? 'accent' : 'neutral'}>{s.category.toLowerCase()}</Badge></td>
            <td>{s.countsAsContact ? 'Yes' : 'No'}</td><td>{s.needsFollowUp ? `Yes${s.followUpHours ? ` · ${s.followUpHours} h` : ''}` : 'No'}</td>
            <td className="text-[12.5px]">{s.requiredFields.map((k) => fields.data?.find((f) => f.key === k)?.label ?? k).join(', ') || '—'}</td>
            <td className="text-[12.5px] text-muted max-w-64">{s.next.length ? s.next.map((id) => q.data!.find((x) => x.id === id)?.label).join(', ') : 'Any'}</td>
            <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => setEdit(s)}>Edit</button></td>
          </tr>
        ))}
      </Table>
      {edit && <StatusModal status={edit === 'new' ? null : edit} all={q.data ?? []} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function StatusModal({ status, all, onClose }: { status: Status | null; all: Status[]; onClose: () => void }) {
  const fields = useCustomFields()
  const [f, setF] = useState({ key: '', label: status?.label ?? '', category: status?.category ?? 'OPEN', countsAsContact: status?.countsAsContact ?? true, needsFollowUp: status?.needsFollowUp ?? false, followUpHours: status?.followUpHours ?? '', remarksRequired: status?.remarksRequired ?? false, requiredFields: status?.requiredFields ?? [], colour: status?.colour ?? '#64748b', active: status?.active ?? true })
  const [next, setNext] = useState<number[]>(status?.next ?? [])
  const save = useAction(async () => {
    const body = { label: f.label, category: f.category, countsAsContact: f.countsAsContact, needsFollowUp: f.needsFollowUp, followUpHours: f.followUpHours === '' ? null : Number(f.followUpHours), remarksRequired: f.remarksRequired, requiredFields: f.requiredFields, colour: f.colour, active: f.active }
    const s = status ? await api<Status>(`/statuses/${status.id}`, { method: 'PATCH', body }) : await post<Status>('/statuses', { ...body, key: f.key || f.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_') })
    await api(`/statuses/${s.id}/next`, { method: 'PUT', body: { next } })
  }, { success: 'Status saved', invalidate: ['ref', 'settings'], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={status ? `Edit ${status.label}` : 'New status'} wide>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }}>
        <Field label="Name"><input className="field" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Type"><select className="field" value={f.category} disabled={status?.key === 'NEW'} onChange={(e) => setF({ ...f, category: e.target.value as Status['category'] })}><option value="OPEN">Open (still being worked)</option><option value="WON">Won (counts as a conversion)</option><option value="LOST">Lost</option><option value="EXCLUDED">Excluded (not counted at all)</option></select></Field>
        <Field label="Colour"><input type="color" className="h-11 w-24 rounded-xl border border-line" value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value })} /></Field>
        <Field label="Default follow-up after (hours)" hint="Used by quick picks and the Next step rule"><input className="field" type="number" min={1} value={f.followUpHours} onChange={(e) => setF({ ...f, followUpHours: e.target.value })} /></Field>
        {([['countsAsContact', 'Counts as contacted'], ['needsFollowUp', 'Needs a follow-up date'], ['remarksRequired', 'Remarks required'], ['active', 'In use']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={!!f[k]} disabled={k === 'active' && status?.key === 'NEW'} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>)}
        <fieldset className="sm:col-span-2"><legend className="label mb-1.5">Fields that must be filled first</legend><div className="flex flex-wrap gap-3">{fields.data?.filter((x) => x.active).map((x) => <label key={x.key} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.requiredFields.includes(x.key)} onChange={() => setF({ ...f, requiredFields: f.requiredFields.includes(x.key) ? f.requiredFields.filter((k) => k !== x.key) : [...f.requiredFields, x.key] })} />{x.label}</label>)}{!fields.data?.length && <span className="text-[13px] text-faint">No custom fields yet</span>}</div></fieldset>
        <fieldset className="sm:col-span-2"><legend className="label mb-1.5">From this status a lead can change to</legend><div className="flex flex-wrap gap-2">{all.filter((s) => s.id !== status?.id || true).map((s) => <label key={s.id} className={clsx('flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] cursor-pointer', next.includes(s.id) ? 'border-ink bg-soft' : 'border-line')}><input type="checkbox" checked={next.includes(s.id)} onChange={() => setNext(next.includes(s.id) ? next.filter((x) => x !== s.id) : [...next, s.id])} />{s.label}</label>)}</div></fieldset>
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={!f.label.trim() || save.isPending}>Save</button></div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- simple lists

function SimpleList<T extends { id: number; active: boolean }>({ title, note, rows, columns, renderAdd, toggle }: { title: string; note?: string; rows?: T[]; columns: [string, (r: T) => React.ReactNode][]; renderAdd: React.ReactNode; toggle: (r: T) => void }) {
  return (
    <Card title={title} note={note}>
      <Table head={[...columns.map((c) => c[0]), '']} minWidth={480}>
        {rows?.map((r) => <tr key={r.id} className={clsx(!r.active && 'opacity-50')}>{columns.map(([h, fn]) => <td key={h}>{fn(r)}</td>)}<td className="text-right"><button className="text-[13px] font-semibold text-accent-ink hover:underline cursor-pointer" onClick={() => toggle(r)}>{r.active ? 'Turn off' : 'Turn on'}</button></td></tr>)}
      </Table>
      <div className="mt-4 pt-4 border-t border-line">{renderAdd}</div>
    </Card>
  )
}

function Outcomes() {
  const q = useOutcomes()
  const [f, setF] = useState({ label: '', connected: false, countsAsAttempt: true, needsFollowUp: false })
  const add = useAction(() => post('/call-outcomes', f), { success: 'Outcome added', invalidate: ['ref'], onDone: () => setF({ label: '', connected: false, countsAsAttempt: true, needsFollowUp: false }) })
  const toggle = useAction((r: { id: number; active: boolean }) => api(`/call-outcomes/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), { invalidate: ['ref'] })
  return (
    <SimpleList title="Call outcomes" note="Only a connected outcome can change the lead’s status" rows={q.data} toggle={(r) => toggle.mutate(r)}
      columns={[['Outcome', (r) => <b className="text-ink">{r.label}</b>], ['Connected', (r) => (r.connected ? 'Yes' : 'No')], ['Counts as attempt', (r) => (r.countsAsAttempt ? 'Yes' : 'No')], ['Needs follow-up', (r) => (r.needsFollowUp ? 'Yes' : 'No')]]}
      renderAdd={<form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}><Field label="New outcome"><input className="field h-10" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>{([['connected', 'Connected'], ['countsAsAttempt', 'Attempt'], ['needsFollowUp', 'Needs follow-up']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-[13px] h-10"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>)}<button className="btn-ghost h-10" disabled={!f.label.trim()}>Add</button></form>} />
  )
}

function Sources() {
  const q = useSources()
  const [name, setName] = useState('')
  const add = useAction(() => post('/sources', { name }), { success: 'Source added', invalidate: ['ref'], onDone: () => setName('') })
  const toggle = useAction((r: { id: number; active: boolean }) => api(`/sources/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), { invalidate: ['ref'] })
  return <SimpleList title="Lead sources" note="Reports show conversion % per source" rows={q.data} toggle={(r) => toggle.mutate(r)} columns={[['Source', (r) => <b className="text-ink">{r.name}</b>]]}
    renderAdd={<form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}><Field label="New source"><input className="field h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Facebook ads" /></Field><button className="btn-ghost h-10" disabled={!name.trim()}>Add</button></form>} />
}

function Templates() {
  const q = useTemplates()
  const [f, setF] = useState({ name: '', body: '' })
  const add = useAction(() => post('/templates', { ...f, channel: 'WHATSAPP' }), { success: 'Template added', invalidate: ['ref'], onDone: () => setF({ name: '', body: '' }) })
  const toggle = useAction((r: { id: number; active: boolean }) => api(`/templates/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), { invalidate: ['ref'] })
  return <SimpleList title="WhatsApp templates" note="{{name}}, {{bde}} and {{company}} are filled in automatically" rows={q.data} toggle={(r) => toggle.mutate(r)} columns={[['Name', (r) => <b className="text-ink">{r.name}</b>], ['Message', (r) => <span className="text-[13px]">{r.body}</span>]]}
    renderAdd={<form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}><Field label="Template name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Message"><textarea className="field h-20 py-2" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Hello {{name}}, this is {{bde}} from {{company}}…" /></Field><button className="btn-ghost justify-self-end" disabled={!f.name.trim() || !f.body.trim()}>Add template</button></form>} />
}

function CustomFields() {
  const q = useCustomFields()
  const [f, setF] = useState({ key: '', label: '', type: 'text', options: '', required: false })
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const key = f.key || slug(f.label)
  const save = useAction(() => api(`/custom-fields/${key}`, { method: 'PUT', body: { label: f.label, type: f.type, required: f.required, options: f.type === 'select' ? f.options.split(',').map((x) => x.trim()).filter(Boolean) : null } }), { success: 'Field saved', invalidate: ['ref'], onDone: () => setF({ key: '', label: '', type: 'text', options: '', required: false }) })
  return (
    <Card title="Custom fields" note="Your own lead fields (course, product, city…). They appear in uploads, the lead page and matching.">
      <Table head={['Field', 'Key', 'Type', 'Required', 'Options']} minWidth={520}>
        {q.data?.map((x) => <tr key={x.key}><td className="text-ink font-semibold">{x.label}</td><td className="font-mono text-[12px]">{x.key}</td><td>{x.type}</td><td>{x.required ? 'Yes' : 'No'}</td><td className="text-[12.5px]">{x.options?.join(', ') ?? '—'}</td></tr>)}
        {!q.data?.length && <tr><td colSpan={5} className="text-center text-muted py-4">None yet</td></tr>}
      </Table>
      <form className="grid gap-3 sm:grid-cols-4 items-end mt-4 pt-4 border-t border-line" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }}>
        <Field label="Label"><input className="field h-10" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Key" hint="lower_case, never changes"><input className="field h-10 font-mono" value={key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
        <Field label="Type"><select className="field h-10" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Pick from a list</option></select></Field>
        {f.type === 'select' ? <Field label="Options" hint="Comma separated"><input className="field h-10" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} /></Field> : <label className="flex items-center gap-2 h-10 text-[13.5px]"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />Required on upload</label>}
        <button className="btn-ghost sm:col-span-4 justify-self-end" disabled={!f.label.trim() || save.isPending}>Add field</button>
      </form>
    </Card>
  )
}

function Scoring() {
  const q = useQuery({ queryKey: ['ref', 'scoring'], queryFn: () => api<{ id: number; field: string; operator: string; value: string; points: number; active: boolean }[]>('/scoring-rules') })
  const [f, setF] = useState({ field: 'source', operator: 'eq', value: '', points: '10' })
  const add = useAction(() => post('/scoring-rules', { ...f, points: Number(f.points) }), { success: 'Rule added: new leads score with it', invalidate: ['ref'] })
  const toggle = useAction((r: { id: number; active: boolean }) => api(`/scoring-rules/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), { invalidate: ['ref'] })
  return <SimpleList title="Lead scoring" note="Higher scores are given out and called first" rows={q.data} toggle={(r) => toggle.mutate(r)} columns={[['When', (r) => <span>{r.field} {r.operator === 'eq' ? '=' : r.operator === 'gte' ? '≥' : '≤'} <b className="text-ink">{r.value}</b></span>], ['Points', (r) => <b className={r.points >= 0 ? 'text-ok' : 'text-bad'}>{r.points > 0 ? '+' : ''}{r.points}</b>]]}
    renderAdd={<form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}>
      <Field label="Field"><select className="field h-10" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}><option value="source">Source</option><option value="status">Status key</option><option value="attempts">Attempts</option></select></Field>
      <Field label="Is"><select className="field h-10" value={f.operator} onChange={(e) => setF({ ...f, operator: e.target.value })}><option value="eq">equal to</option><option value="gte">at least</option><option value="lte">at most</option></select></Field>
      <Field label="Value"><input className="field h-10 w-36" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="Referral" /></Field>
      <Field label="Points"><input className="field h-10 w-24" type="number" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></Field>
      <button className="btn-ghost h-10" disabled={!f.value.trim()}>Add rule</button></form>} />
}

function Holidays() {
  const q = useQuery({ queryKey: ['ref', 'holidays'], queryFn: () => api<{ date: string; name: string }[]>('/holidays') })
  const [f, setF] = useState({ date: today(), name: '' })
  const add = useAction(() => api(`/holidays/${f.date}`, { method: 'PUT', body: { name: f.name } }), { success: 'Holiday saved', invalidate: ['ref'], onDone: () => setF({ ...f, name: '' }) })
  const del = useAction((d: string) => api(`/holidays/${d}`, { method: 'DELETE' }), { success: 'Removed', invalidate: ['ref'] })
  return (
    <Card title="Holidays" note="Never counted as absent; follow-up quick picks skip them">
      <Table head={['Date', 'Holiday', '']} minWidth={360}>{q.data?.map((h) => <tr key={h.date}><td className="num">{h.date.slice(0, 10)}</td><td className="text-ink">{h.name}</td><td className="text-right"><button className="text-[13px] text-muted hover:text-bad cursor-pointer" onClick={() => del.mutate(h.date.slice(0, 10))}>Remove</button></td></tr>)}</Table>
      <form className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-line" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}><Field label="Date"><input className="field h-10" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="Name"><input className="field h-10" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Pongal" /></Field><button className="btn-ghost h-10" disabled={!f.name.trim()}>Add holiday</button></form>
    </Card>
  )
}

function Targets() {
  const q = useQuery({ queryKey: ['ref', 'targets'], queryFn: () => api<{ id: number; scope: string; scopeId: number; metric: string; period: string; value: number; fromDate: string }[]>('/targets') })
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ id: number; name: string }[]>('/teams') })
  const users = useQuery({ queryKey: ['users', 'BDE'], queryFn: () => api<{ id: number; name: string }[]>('/users', { query: { role: 'BDE', state: 'ACTIVE' } }) })
  const [f, setF] = useState({ scope: 'COMPANY', scopeId: '0', metric: 'conversions', period: 'MONTH', value: '', fromDate: today().slice(0, 8) + '01' })
  const toStore = (m: string, v: string) => (m === 'revenue' ? Math.round(Number(v) * 100) : m === 'conversion_pct' ? Math.round(Number(v) * 100) : Number(v))
  const show = (m: string, v: number) => (m === 'revenue' ? `₹${(v / 100).toLocaleString('en-IN')}` : m === 'conversion_pct' ? `${v / 100}%` : v.toLocaleString('en-IN'))
  const add = useAction(() => post('/targets', { scope: f.scope, scopeId: Number(f.scopeId), metric: f.metric, period: f.period, value: toStore(f.metric, f.value), fromDate: f.fromDate }), { success: 'Target saved (from that date on)', invalidate: ['ref', 'dashboard'], onDone: () => setF({ ...f, value: '' }) })
  const who = (s: string, id: number) => (s === 'COMPANY' ? 'Company' : s === 'TEAM' ? teams.data?.find((t) => t.id === id)?.name : users.data?.find((u) => u.id === id)?.name) ?? `#${id}`
  return (
    <Card title="Targets" note="A new target replaces the old one from its start date. Dashboards compare against them.">
      <Table head={['For', 'Metric', 'Per', 'Target', 'From']} minWidth={480}>{q.data?.map((t) => <tr key={t.id} className="num"><td className="text-ink">{who(t.scope, t.scopeId)}</td><td>{t.metric.replace('_', ' ')}</td><td>{t.period.toLowerCase()}</td><td><b>{show(t.metric, t.value)}</b></td><td>{t.fromDate.slice(0, 10)}</td></tr>)}{!q.data?.length && <tr><td colSpan={5} className="text-center text-muted py-4">No targets yet</td></tr>}</Table>
      <form className="grid gap-3 sm:grid-cols-3 items-end mt-4 pt-4 border-t border-line" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined) }}>
        <Field label="For"><select className="field h-10" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, scopeId: e.target.value === 'COMPANY' ? '0' : '' })}><option value="COMPANY">Whole company</option><option value="TEAM">A team</option><option value="USER">A BDE</option></select></Field>
        {f.scope !== 'COMPANY' ? <Field label={f.scope === 'TEAM' ? 'Team' : 'BDE'}><select className="field h-10" value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}><option value="">Choose…</option>{(f.scope === 'TEAM' ? teams.data : users.data)?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field> : <span />}
        <Field label="Metric"><select className="field h-10" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}><option value="conversions">Conversions</option><option value="conversion_pct">Conversion %</option><option value="revenue">Revenue (₹)</option><option value="calls">Calls</option><option value="contacts">Contacts</option></select></Field>
        <Field label="Per"><select className="field h-10" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="MONTH">Month</option><option value="WEEK">Week</option><option value="DAY">Day</option></select></Field>
        <Field label="Target"><input className="field h-10 num" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="From"><input className="field h-10" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
        <button className="btn-ghost sm:col-span-3 justify-self-end" disabled={!f.value || !f.scopeId || add.isPending}>Save target</button>
      </form>
    </Card>
  )
}
