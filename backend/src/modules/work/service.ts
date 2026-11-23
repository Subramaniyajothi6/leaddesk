import type { Lead, Status, FollowUpType } from '@prisma/client'
import type { Tx } from '../../db.js'
import type { AuthUser } from '../../lib/access.js'
import { getSettings, type Settings } from '../../lib/settings.js'
import { unprocessable, badRequest } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'
import { endOpen } from '../allocation/assign.js'
import { rescore } from '../leads/scoring.js'
import { notifyMany, teamLeadersOf } from '../notifications/service.js'

export interface FollowUpIn { dueAt: string; type?: FollowUpType; reason?: string }

const FINAL = ['WON', 'LOST', 'EXCLUDED']

/** Recompute the lead's next pending follow-up time (used for "Next to call" ordering). */
export async function refreshNextFollowUp(t: Tx, leadId: number) {
  const next = await t.followUp.findFirst({ where: { leadId, state: 'PENDING' }, orderBy: { dueAt: 'asc' }, select: { dueAt: true } })
  await t.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } })
}

export async function addFollowUp(t: Tx, lead: Lead, userId: number, f: FollowUpIn, auto = false) {
  const dueAt = new Date(f.dueAt)
  if (Number.isNaN(dueAt.getTime())) throw badRequest('Follow-up time is not valid')
  if (dueAt.getTime() < Date.now() - 5 * 60_000) throw badRequest('Follow-up time is in the past')
  const owner = lead.ownerId ?? userId
  const row = await t.followUp.create({ data: { leadId: lead.id, userId: owner, type: f.type ?? 'CALL', dueAt, reason: f.reason?.slice(0, 300), auto } })
  await refreshNextFollowUp(t, lead.id)
  return row
}

/**
 * A follow-up is done only by logging what happened (§8 rule 4): any call or status change
 * completes the lead's pending follow-ups that are due by now (+ a small grace window).
 */
async function completeDueFollowUps(t: Tx, leadId: number) {
  const r = await t.followUp.updateMany({ where: { leadId, state: 'PENDING', dueAt: { lte: new Date(Date.now() + 2 * 3_600_000) } }, data: { state: 'DONE', completedAt: new Date() } })
  return r.count
}

/** Attempts and recycling (§7.3 rule 4). Returns what happened. */
export async function registerAttempt(t: Tx, lead: Lead, s: Settings, byUserId: number) {
  const now = new Date()
  const first = lead.firstAttemptAt ?? now
  const attempts = lead.attemptCount + 1
  await t.lead.update({ where: { id: lead.id }, data: { attemptCount: attempts, firstAttemptAt: first } })
  return maybeRecycle(t, { ...lead, attemptCount: attempts, firstAttemptAt: first }, s, byUserId)
}

/**
 * Enough failed attempts spread over enough time → recycle: back to the team pool as fresh, never to the same BDE.
 * After the max number of recycles the lead becomes Lost.
 */
export async function maybeRecycle(t: Tx, lead: Pick<Lead, 'id' | 'attemptCount' | 'firstAttemptAt' | 'recycleCount' | 'ownerId' | 'teamId' | 'statusId'>, s: Settings, byUserId: number | null) {
  const r = s.recycling
  if (!lead.ownerId || lead.attemptCount < r.maxAttempts || !lead.firstAttemptAt) return 'none' as const
  if (Date.now() - lead.firstAttemptAt.getTime() < r.minSpreadHours * 3_600_000) return 'waiting' as const
  const cur = await t.status.findUniqueOrThrow({ where: { id: lead.statusId } })
  if (cur.category !== 'OPEN') return 'none' as const
  if (lead.recycleCount >= r.maxRecycles) {
    const lost = await t.status.findUniqueOrThrow({ where: { key: 'LOST' } })
    await t.lead.update({ where: { id: lead.id }, data: { statusId: lost.id, statusChangedAt: new Date(), version: { increment: 1 } } })
    await t.statusHistory.create({ data: { leadId: lead.id, fromStatusId: lead.statusId, toStatusId: lost.id, byUserId: byUserId ?? 0, ownerId: lead.ownerId, teamId: lead.teamId, remarks: `Not reachable after ${r.maxRecycles} recycles (automatic)` } })
    await t.followUp.updateMany({ where: { leadId: lead.id, state: 'PENDING' }, data: { state: 'CANCELLED' } })
    return 'lost' as const
  }
  const fresh = await t.status.findUniqueOrThrow({ where: { key: 'NEW' } })
  await endOpen(t, lead.id, 'BDE', 'RECYCLED')
  await t.lead.update({ where: { id: lead.id }, data: { ownerId: null, statusId: fresh.id, statusChangedAt: new Date(), attemptCount: 0, firstAttemptAt: null, recycleCount: { increment: 1 }, version: { increment: 1 } } })
  await t.statusHistory.create({ data: { leadId: lead.id, fromStatusId: lead.statusId, toStatusId: fresh.id, byUserId: byUserId ?? 0, ownerId: lead.ownerId, teamId: lead.teamId, remarks: `Recycled after ${lead.attemptCount} failed attempts (automatic)` } })
  await t.followUp.updateMany({ where: { leadId: lead.id, state: 'PENDING' }, data: { state: 'CANCELLED' } })
  await t.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: null } })
  return 'recycled' as const
}

export interface StatusChange {
  lead: Lead
  to: Status
  user: AuthUser
  remarks?: string
  followUp?: FollowUpIn
  fields?: Record<string, unknown>
  skipNextFollowUpReason?: string
}

/** Every rule of §7.3 in one place. Caller has checked access and the version. */
export async function changeStatus(t: Tx, c: StatusChange) {
  const s = await getSettings()
  const from = await t.status.findUniqueOrThrow({ where: { id: c.lead.statusId } })
  const to = c.to
  if (!to.active) throw unprocessable(`${to.label} is not in use`)
  const reopen = FINAL.includes(from.category) && to.category === 'OPEN'
  if (FINAL.includes(from.category) && from.id !== to.id) {
    if (!reopen && to.key !== 'DND') throw unprocessable(`${from.label} is a final status. Reopen it to an open status first.`)
    if (reopen) {
      if (c.user.role === 'BDE') throw unprocessable('Only a Team Lead or Admin can reopen a lead with a final status')
      if (!c.remarks?.trim()) throw unprocessable('Give a reason to reopen this lead')
    }
  }
  if (!reopen) {
    const allowed = await t.statusTransition.findMany({ where: { fromStatusId: from.id }, select: { toStatusId: true } })
    if (allowed.length && !allowed.some((a) => a.toStatusId === to.id)) throw unprocessable(`${from.label} → ${to.label} is not allowed`)
  }
  if (to.remarksRequired && !c.remarks?.trim()) throw unprocessable(`Remarks are required for ${to.label}`)

  // Required fields per status (§15.1 #5), checked on the server.
  const custom = { ...(c.lead.custom as Record<string, unknown>), ...(c.fields ?? {}) }
  const req = (to.requiredFields as string[]) ?? []
  const missing = req.filter((k) => custom[k] == null || custom[k] === '')
  if (missing.length) {
    const defs = await t.customFieldDef.findMany({ where: { key: { in: missing } } })
    throw unprocessable(`Fill ${missing.map((k) => defs.find((d) => d.key === k)?.label ?? k).join(', ')} before setting ${to.label}`, { missingFields: missing })
  }

  // A status that needs a follow-up must have one in the same save, unless the "Next step" rule books it (§7.3 rule 3, §8.2).
  let followUp = c.followUp
  let autoFollowUp = false
  if (to.needsFollowUp && !followUp) {
    if (s.automation.nextStep.on && to.followUpHours) {
      const { quickPicks, holidaySet } = await import('../../lib/workdays.js')
      followUp = { dueAt: quickPicks(new Date(), s, await holidaySet(), to.followUpHours)[0].at, type: 'CALL', reason: `Next step after ${to.label}` }
      autoFollowUp = true
    } else throw unprocessable(`${to.label} needs a follow-up date`, { needsFollowUp: true })
  }

  const completed = await completeDueFollowUps(t, c.lead.id)
  // "Keep it moving" (§8.2): finishing a follow-up on a lead that stays open asks for the next one.
  if (completed && to.category === 'OPEN' && !followUp && s.automation.keepMoving.on && !c.skipNextFollowUpReason?.trim()) {
    const stillPending = await t.followUp.count({ where: { leadId: c.lead.id, state: 'PENDING' } })
    if (!stillPending) throw unprocessable('Book the next follow-up, or give a reason to skip it', { needsNextFollowUp: true })
  }

  const now = new Date()
  await t.lead.update({
    where: { id: c.lead.id },
    data: { statusId: to.id, statusChangedAt: from.id === to.id ? undefined : now, lastActivityAt: now, custom: custom as object, dnd: to.key === 'DND' ? true : undefined, version: { increment: 1 } },
  })
  await t.statusHistory.create({
    data: { leadId: c.lead.id, fromStatusId: from.id, toStatusId: to.id, byUserId: c.user.id, ownerId: c.lead.ownerId, teamId: c.lead.teamId, remarks: [c.remarks?.trim(), c.skipNextFollowUpReason ? `No next follow-up: ${c.skipNextFollowUpReason}` : null].filter(Boolean).join(' · ') || null, reopen },
  })
  if (reopen) await audit(t, { actorId: c.user.id, action: 'STATUS_REOPEN', entity: 'lead', entityId: c.lead.id, before: { status: from.key }, after: { status: to.key, reason: c.remarks } })
  if (FINAL.includes(to.category)) await t.followUp.updateMany({ where: { leadId: c.lead.id, state: 'PENDING' }, data: { state: 'CANCELLED' } })
  if (followUp && !FINAL.includes(to.category)) await addFollowUp(t, { ...c.lead, ownerId: c.lead.ownerId ?? c.user.id }, c.user.id, followUp, autoFollowUp)
  else await refreshNextFollowUp(t, c.lead.id)

  let recycle: string = 'none'
  if (to.key === 'NOT_REACHABLE') {
    const fresh = await t.lead.findUniqueOrThrow({ where: { id: c.lead.id } })
    recycle = await registerAttempt(t, fresh, s, c.user.id)
    if (recycle === 'recycled' && c.lead.teamId) await notifyMany(t, await teamLeadersOf(t, c.lead.teamId), { type: 'LEAD_RECYCLED', title: `${c.lead.name} was recycled to the team pool`, link: `/leads/${c.lead.id}` })
  }
  await rescore(t, c.lead.id)
  return { from, to, reopen, completedFollowUps: completed, autoFollowUp, recycle, wasFresh: from.key === 'NEW' }
}
