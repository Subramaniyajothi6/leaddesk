import type { ScoringRule } from '@prisma/client'
import { prisma, type Db } from '../../db.js'

/**
 * Lead score (§15): sum of the active Admin rules, e.g. "source = Referral → +20",
 * "status = INTERESTED → +30", "attempts ≥ 3 → −15", "custom.city = Chennai → +5". Higher is called first.
 */
export interface ScoreInput { sourceName?: string | null; statusKey?: string | null; attemptCount?: number; custom?: Record<string, unknown> }

export function scoreOf(rules: ScoringRule[], l: ScoreInput): number {
  let s = 0
  for (const r of rules) {
    if (!r.active) continue
    let v: unknown
    if (r.field === 'source') v = l.sourceName
    else if (r.field === 'status') v = l.statusKey
    else if (r.field === 'attempts') v = l.attemptCount ?? 0
    else if (r.field.startsWith('custom.')) v = l.custom?.[r.field.slice(7)]
    else continue
    if (v == null || v === '') continue
    const ok = r.operator === 'eq' ? String(v).toLowerCase() === r.value.toLowerCase()
      : r.operator === 'gte' ? Number(v) >= Number(r.value)
      : r.operator === 'lte' ? Number(v) <= Number(r.value) : false
    if (ok) s += r.points
  }
  return s
}

export const activeRules = (db: Db = prisma) => db.scoringRule.findMany({ where: { active: true } })

/** Recalculate and store one lead's score (after a status change or a call). */
export async function rescore(db: Db, leadId: number, rules?: ScoringRule[]) {
  const l = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { source: true, status: true } })
  const score = scoreOf(rules ?? (await activeRules(db)), { sourceName: l.source?.name, statusKey: l.status.key, attemptCount: l.attemptCount, custom: l.custom as Record<string, unknown> })
  if (score !== l.score) await db.lead.update({ where: { id: leadId }, data: { score } })
  return score
}
