import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { post, ApiError } from '../lib/api'
import { useCustomFields, useSources } from '../lib/refdata'
import { useAction } from '../lib/hooks'
import { Modal } from './Modal'

type Form = { name: string; phone: string; email: string; source: string; custom: Record<string, string> }
const empty = (source = ''): Form => ({ name: '', phone: '', email: '', source, custom: {} })

/**
 * Admin adds one lead by hand: name, phone, email, source and every active custom field.
 * Same checks as an upload on the server (valid phone, duplicates, required / typed custom fields); goes to the company pool.
 */
export function AddLead({ label = 'Add a lead', className = 'btn-primary' }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const sources = useSources()
  const fields = useCustomFields()
  const active = fields.data?.filter((x) => x.active) ?? []
  const [f, setF] = useState<Form>(empty)
  const [error, setError] = useState<{ message: string; existingLeadId?: number } | null>(null)
  const [added, setAdded] = useState(0)
  const nav = useNavigate()

  const close = () => { setOpen(false); setError(null); setAdded(0) }
  const set = (patch: Partial<Form>) => { setF({ ...f, ...patch }); setError(null) }
  const setCustom = (key: string, v: string) => set({ custom: { ...f.custom, [key]: v } })

  const missing = !f.name.trim() || !f.phone.trim() || active.some((x) => x.required && !(f.custom[x.key] ?? '').trim())
  const m = useAction((again: boolean) => post<{ id: number }>('/leads', {
    name: f.name.trim(), phone: f.phone.trim(),
    ...(f.email.trim() && { email: f.email.trim() }), ...(f.source && { source: f.source }),
    custom: Object.fromEntries(Object.entries(f.custom).filter(([, v]) => v.trim() !== '')),
  }).then((r) => ({ ...r, again })), {
    success: (r) => r.again ? `${f.name.trim()} added. Next one.` : 'Lead added to the company pool',
    invalidate: ['leads', 'dashboard'],
    onDone: (r) => {
      if (r.again) { setF(empty(f.source)); setAdded((n) => n + 1) } // keep the source: a batch by hand usually shares it
      else { close(); setF(empty()); nav(`/leads/${r.id}`) }
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return false
      const d = e.details as { existingLeadId?: number } | undefined
      setError({ message: e.message, existingLeadId: e.status === 409 ? d?.existingLeadId : undefined })
      return true // shown in the form, not as a toast
    },
  })

  const input = (key: string, type: string, value: string, onChange: (v: string) => void, extra: Record<string, unknown> = {}) =>
    <input id={`al-${key}`} className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} {...extra} />
  const box = (key: string, text: string, required: boolean, control: ReactNode) => (
    <label key={key} htmlFor={`al-${key}`} className="flex flex-col gap-1.5">
      <span className="label">{text}{required ? <span className="text-bad"> *</span> : <span className="text-faint font-normal"> (optional)</span>}</span>
      {control}
    </label>
  )

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>{label}</button>
      <Modal open={open} onClose={close} title="Add a lead">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!missing) m.mutate(false) }}>
          {added > 0 && <p className="sm:col-span-2 text-[13px] text-ok font-medium">{added} added so far. They are in the company pool.</p>}
          {box('name', 'Name', true, input('name', 'text', f.name, (v) => set({ name: v }), { autoFocus: true, maxLength: 120 }))}
          {box('phone', 'Phone', true, input('phone', 'tel', f.phone, (v) => set({ phone: v }), { inputMode: 'tel', placeholder: '98765 43210' }))}
          {box('email', 'Email', false, input('email', 'email', f.email, (v) => set({ email: v })))}
          {box('source', 'Source', false,
            <select id="al-source" className="field" value={f.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">None</option>{sources.data?.filter((x) => x.active).map((x) => <option key={x.id}>{x.name}</option>)}
            </select>)}
          {active.map((x) => box(x.key, x.label, x.required, x.type === 'select'
            ? <select id={`al-${x.key}`} className="field" value={f.custom[x.key] ?? ''} onChange={(e) => setCustom(x.key, e.target.value)}><option value="">Choose…</option>{x.options?.map((o) => <option key={o}>{o}</option>)}</select>
            : input(x.key, x.type === 'number' ? 'number' : x.type === 'date' ? 'date' : 'text', f.custom[x.key] ?? '', (v) => setCustom(x.key, v))))}
          {error && (
            <div role="alert" className="sm:col-span-2 rounded-lg border border-bad/40 bg-bad-soft/40 px-3 py-2 text-[13.5px] text-bad">
              {error.message}
              {error.existingLeadId && <> · <Link className="font-semibold underline" to={`/leads/${error.existingLeadId}`} onClick={close}>Open the existing lead</Link></>}
            </div>
          )}
          <p className="sm:col-span-2 text-[12.5px] text-faint">New leads go to the company pool. Give them to teams from Allocation.</p>
          <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={missing || m.isPending} onClick={() => m.mutate(true)}>Add &amp; add another</button>
            <button type="submit" className="btn-primary" disabled={missing || m.isPending}>Add a lead</button>
          </div>
        </form>
      </Modal>
    </>
  )
}
