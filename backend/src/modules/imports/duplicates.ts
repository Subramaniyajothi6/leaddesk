import type { Db } from '../../db.js'

/**
 * Index → existing lead id for items that already exist as a live lead (§5.2 step 3).
 * Rule (setting): PHONE, EMAIL, or PHONE_OR_EMAIL.
 */
export async function findDuplicates(db: Db, items: { phone: string; email: string | null }[], rule: 'PHONE' | 'EMAIL' | 'PHONE_OR_EMAIL') {
  const out = new Map<number, number>()
  const usePhone = rule !== 'EMAIL'
  const useEmail = rule !== 'PHONE'
  const byPhone = new Map<string, number>()
  const byEmail = new Map<string, number>()
  const CHUNK = 1000
  if (usePhone) {
    const phones = [...new Set(items.map((i) => i.phone))]
    for (let i = 0; i < phones.length; i += CHUNK) {
      for (const l of await db.lead.findMany({ where: { deletedAt: null, phoneE164: { in: phones.slice(i, i + CHUNK) } }, select: { id: true, phoneE164: true } })) byPhone.set(l.phoneE164, l.id)
    }
  }
  if (useEmail) {
    const emails = [...new Set(items.map((i) => i.email).filter((e): e is string => !!e))]
    for (let i = 0; i < emails.length; i += CHUNK) {
      for (const l of await db.lead.findMany({ where: { deletedAt: null, email: { in: emails.slice(i, i + CHUNK) } }, select: { id: true, email: true } })) byEmail.set(l.email!, l.id)
    }
  }
  items.forEach((it, idx) => {
    const hit = (usePhone && byPhone.get(it.phone)) || (useEmail && it.email && byEmail.get(it.email))
    if (hit) out.set(idx, hit)
  })
  return out
}
