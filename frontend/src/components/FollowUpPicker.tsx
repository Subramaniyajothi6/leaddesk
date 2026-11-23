import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'

export interface FollowUpValue { dueAt: string; type: 'CALL' | 'WHATSAPP' | 'MEETING' | 'TASK'; reason: string }
export const emptyFollowUp = (): FollowUpValue => ({ dueAt: '', type: 'CALL', reason: '' })

/** datetime-local works in local time; the API wants ISO with a time zone. */
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }

/** Quick picks from the server skip holidays and week-offs (§8 item 9); any time can still be typed. */
export function FollowUpPicker({ value, onChange, statusId, required }: { value: FollowUpValue; onChange: (v: FollowUpValue) => void; statusId?: number; required?: boolean }) {
  const picks = useQuery({ queryKey: ['quick-picks', statusId ?? 0], queryFn: () => api<{ label: string; at: string }[]>('/follow-ups/quick-picks', { query: { statusId } }), staleTime: 60_000 })
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="label mb-2">Next follow-up{required ? ' (required)' : ''}</legend>
      <div className="flex flex-wrap gap-2">
        {picks.data?.map((p) => (
          <button type="button" key={p.label} onClick={() => onChange({ ...value, dueAt: p.at })}
            className={clsx('h-9 px-3 rounded-lg border text-[13px] font-semibold cursor-pointer', value.dueAt === p.at ? 'bg-ink text-white border-ink' : 'border-line hover:bg-soft')}>
            {p.label}<span className="font-normal opacity-75"> · {new Date(p.at).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="flex flex-col gap-1"><span className="label">Date and time</span>
          <input type="datetime-local" className="field" value={value.dueAt ? toLocalInput(value.dueAt) : ''} onChange={(e) => onChange({ ...value, dueAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} />
        </label>
        <label className="flex flex-col gap-1"><span className="label">Type</span>
          <select className="field" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as FollowUpValue['type'] })}>
            <option value="CALL">Call</option><option value="WHATSAPP">WhatsApp</option><option value="MEETING">Meeting</option><option value="TASK">Task</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1"><span className="label">Reason (optional)</span>
        <input className="field" maxLength={300} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} placeholder="e.g. Send fee details, call after 6 pm" />
      </label>
    </fieldset>
  )
}

export const followUpBody = (v: FollowUpValue) => (v.dueAt ? { dueAt: v.dueAt, type: v.type, ...(v.reason.trim() && { reason: v.reason.trim() }) } : undefined)
