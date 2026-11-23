import type { CustomFieldDef, LeadSource } from '@prisma/client'
import { normalizePhone, EMAIL_RE } from '../../lib/phone.js'

/** One incoming lead (from a file row or the form) after mapping to field keys. */
export interface RawLead { name?: unknown; phone?: unknown; email?: unknown; source?: unknown; custom?: Record<string, unknown> }
export interface CleanLead { name: string; phoneE164: string; email: string | null; sourceId: number | null; sourceName: string | null; custom: Record<string, unknown> }

const str = (v: unknown) => (v == null ? '' : String(v).trim())

/** Field checks of §5.2 step 2. Returns the clean lead or the list of problems. */
export function validateLead(raw: RawLead, ctx: { country: string; fields: CustomFieldDef[]; sources: LeadSource[]; sourceRequired?: boolean }): { ok: true; lead: CleanLead } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const name = str(raw.name)
  if (!name) errors.push('Name is missing')
  else if (name.length > 120) errors.push('Name is longer than 120 characters')
  const phoneRaw = str(raw.phone)
  const phoneE164 = normalizePhone(phoneRaw, ctx.country)
  if (!phoneRaw) errors.push('Phone is missing')
  else if (!phoneE164) errors.push(`Phone "${phoneRaw}" is not a valid number`)
  const email = str(raw.email).toLowerCase() || null
  if (email && !EMAIL_RE.test(email)) errors.push(`Email "${email}" is not valid`)
  let sourceId: number | null = null
  let sourceName: string | null = null
  const srcRaw = str(raw.source)
  if (srcRaw) {
    const s = ctx.sources.find((x) => x.active && x.name.toLowerCase() === srcRaw.toLowerCase())
    if (!s) errors.push(`Source "${srcRaw}" is not in the list of sources`)
    else { sourceId = s.id; sourceName = s.name }
  } else if (ctx.sourceRequired) errors.push('Source is missing')

  const custom: Record<string, unknown> = {}
  for (const f of ctx.fields.filter((x) => x.active)) {
    const v = str(raw.custom?.[f.key])
    if (!v) { if (f.required) errors.push(`${f.label} is missing`); continue }
    if (f.type === 'number') { const n = Number(v.replace(/,/g, '')); if (Number.isNaN(n)) errors.push(`${f.label} must be a number`); else custom[f.key] = n }
    else if (f.type === 'date') { const d = toDate(v); if (!d) errors.push(`${f.label} must be a date`); else custom[f.key] = d }
    else if (f.type === 'select') {
      const opts = (f.options as string[] | null) ?? []
      const hit = opts.find((o) => o.toLowerCase() === v.toLowerCase())
      if (!hit) errors.push(`${f.label} "${v}" is not one of: ${opts.join(', ')}`); else custom[f.key] = hit
    } else custom[f.key] = v.slice(0, 500)
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, lead: { name, phoneE164: phoneE164!, email, sourceId, sourceName, custom } }
}

/** Accepts 2026-11-18, 18/11/2026, 18-11-2026 or an Excel serial number. */
function toDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{5}$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000).toISOString().slice(0, 10)
  return null
}
