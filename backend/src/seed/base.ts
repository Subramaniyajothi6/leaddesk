import type { PrismaClient } from '@prisma/client'

/** Defaults from SYSTEM-DESIGN.md §7.1, §7.2, §8.1. Admin can rename, add, hide and reorder them later. */
export const DEFAULT_STATUSES = [
  { key: 'NEW', label: 'New', category: 'OPEN', countsAsContact: false, colour: '#64748b' },
  { key: 'CONTACTED', label: 'Contacted', category: 'OPEN', countsAsContact: true, colour: '#2563eb' },
  { key: 'INTERESTED', label: 'Interested', category: 'OPEN', countsAsContact: true, needsFollowUp: true, followUpHours: 24, colour: '#7c3aed' },
  { key: 'FOLLOW_UP', label: 'Follow-up Required', category: 'OPEN', countsAsContact: true, needsFollowUp: true, followUpHours: 24, colour: '#d97706' },
  { key: 'NOT_REACHABLE', label: 'Not Reachable', category: 'OPEN', countsAsContact: false, colour: '#9ca3af' },
  { key: 'CONVERTED', label: 'Converted', category: 'WON', countsAsContact: true, colour: '#16a34a' },
  { key: 'NOT_INTERESTED', label: 'Not Interested', category: 'LOST', countsAsContact: true, colour: '#dc2626' },
  { key: 'LOST', label: 'Lost', category: 'LOST', countsAsContact: false, colour: '#991b1b' },
  { key: 'DND', label: 'Do Not Call', category: 'EXCLUDED', countsAsContact: false, colour: '#111827' },
  { key: 'INVALID', label: 'Invalid Number', category: 'EXCLUDED', countsAsContact: false, colour: '#6b7280' },
  { key: 'DUPLICATE', label: 'Duplicate', category: 'EXCLUDED', countsAsContact: false, colour: '#6b7280' },
] as const

export const DEFAULT_TRANSITIONS: [string, string][] = [
  ['NEW', 'CONTACTED'], ['NEW', 'NOT_REACHABLE'], ['NEW', 'INVALID'],
  ['NOT_REACHABLE', 'CONTACTED'], ['NOT_REACHABLE', 'NOT_REACHABLE'], ['NOT_REACHABLE', 'INVALID'],
  ['CONTACTED', 'INTERESTED'], ['CONTACTED', 'NOT_INTERESTED'], ['CONTACTED', 'FOLLOW_UP'],
  ['INTERESTED', 'FOLLOW_UP'], ['INTERESTED', 'CONVERTED'], ['INTERESTED', 'NOT_INTERESTED'],
  ['FOLLOW_UP', 'INTERESTED'], ['FOLLOW_UP', 'CONVERTED'], ['FOLLOW_UP', 'NOT_INTERESTED'], ['FOLLOW_UP', 'LOST'], ['FOLLOW_UP', 'FOLLOW_UP'],
  // Not Reachable as the result of many failed attempts → Lost (recycling, §7.3)
  ['NOT_REACHABLE', 'LOST'],
]

export const DEFAULT_OUTCOMES = [
  { label: 'Answered', connected: true, countsAsAttempt: false, needsFollowUp: false },
  { label: 'No answer', connected: false, countsAsAttempt: true, needsFollowUp: false },
  { label: 'Busy', connected: false, countsAsAttempt: true, needsFollowUp: false },
  { label: 'Switched off', connected: false, countsAsAttempt: true, needsFollowUp: false },
  { label: 'Wrong number', connected: false, countsAsAttempt: false, needsFollowUp: false },
  { label: 'Call back later', connected: true, countsAsAttempt: false, needsFollowUp: true },
]

export async function seedBase(db: PrismaClient) {
  for (const [i, s] of DEFAULT_STATUSES.entries()) {
    await db.status.upsert({ where: { key: s.key }, update: {}, create: { ...s, order: i } })
  }
  const ids = new Map((await db.status.findMany()).map((s) => [s.key, s.id]))
  const dnd = ids.get('DND')!
  const pairs = [...DEFAULT_TRANSITIONS, ...DEFAULT_STATUSES.filter((s) => s.key !== 'DND').map((s) => [s.key, 'DND'] as [string, string])]
  await db.statusTransition.createMany({ data: pairs.map(([f, t]) => ({ fromStatusId: ids.get(f)!, toStatusId: t === 'DND' ? dnd : ids.get(t)! })), skipDuplicates: true })
  // Converted needs an amount note? Left empty by default; Admin picks required fields per status (§15.1 #5).
  for (const [i, o] of DEFAULT_OUTCOMES.entries()) await db.callOutcome.upsert({ where: { label: o.label }, update: {}, create: { ...o, order: i } })
  for (const name of ['Website', 'Referral', 'Walk-in', 'Campaign']) await db.leadSource.upsert({ where: { name }, update: {}, create: { name } })
  if (!(await db.messageTemplate.count())) {
    await db.messageTemplate.create({ data: { name: 'First message', channel: 'WHATSAPP', body: 'Hello {{name}}, this is {{bde}} from {{company}}. Thank you for your interest. Is this a good time to talk?' } })
  }
}
