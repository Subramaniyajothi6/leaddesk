import type { AllocMethod, EndReason } from '@prisma/client'
import type { Tx } from '../../db.js'
import { notify } from '../notifications/service.js'
import { getSettings } from '../../lib/settings.js'
import { firstCallDue, holidaySet } from '../../lib/workdays.js'

/**
 * Assignment primitives. History is never overwritten (§5.6 rule 3):
 * ending an assignment sets ended_at/end_reason, a new owner always gets a new row.
 * The partial unique index refuses a second open row per (lead, level).
 */

export async function endOpen(t: Tx, leadId: number, level: 'TEAM' | 'BDE', reason: EndReason, at = new Date()) {
  await t.leadAssignment.updateMany({ where: { leadId, level, endedAt: null }, data: { endedAt: at, endReason: reason } })
}

/** Company pool → team pool. */
export async function assignToTeam(t: Tx, a: { leadId: number; teamId: number; runId?: number; by?: number | null; reason?: object }) {
  await endOpen(t, a.leadId, 'TEAM', 'REASSIGNED')
  await t.leadAssignment.create({ data: { leadId: a.leadId, level: 'TEAM', teamId: a.teamId, runId: a.runId, assignedBy: a.by ?? null, reason: a.reason ?? {} } })
  await t.lead.update({ where: { id: a.leadId }, data: { teamId: a.teamId, ownerId: null, version: { increment: 1 } } })
}

/**
 * Team pool → BDE (or BDE → another BDE). Pending follow-ups move with the lead (§8 rule 6).
 * Returns the previous owner id (if any).
 */
export async function assignToBde(t: Tx, a: {
  leadId: number; teamId: number; userId: number; runId?: number; by?: number | null; reason?: object; overMax?: boolean
  endReason?: EndReason; notifyOwner?: boolean
}) {
  const lead = await t.lead.findUniqueOrThrow({ where: { id: a.leadId }, select: { ownerId: true, teamId: true } })
  await endOpen(t, a.leadId, 'BDE', a.endReason ?? 'REASSIGNED')
  if (lead.teamId !== a.teamId) {
    await endOpen(t, a.leadId, 'TEAM', 'TRANSFERRED')
    await t.leadAssignment.create({ data: { leadId: a.leadId, level: 'TEAM', teamId: a.teamId, runId: a.runId, assignedBy: a.by ?? null, reason: { via: 'BDE_ASSIGN' } } })
  }
  await t.leadAssignment.create({
    data: { leadId: a.leadId, level: 'BDE', teamId: a.teamId, userId: a.userId, runId: a.runId, assignedBy: a.by ?? null, reason: a.reason ?? {}, overMax: a.overMax ?? false },
  })
  await t.lead.update({ where: { id: a.leadId }, data: { teamId: a.teamId, ownerId: a.userId, version: { increment: 1 } } })
  const moved = await t.followUp.updateMany({ where: { leadId: a.leadId, state: 'PENDING', userId: { not: a.userId } }, data: { userId: a.userId } })
  // Automatic rule "First call" (§8.2): a fresh lead gets a call follow-up within the first-call target.
  const s = await getSettings()
  if (s.automation.firstCall.on) {
    const l = await t.lead.findUniqueOrThrow({ where: { id: a.leadId }, select: { status: { select: { key: true } } } })
    const pending = await t.followUp.count({ where: { leadId: a.leadId, state: 'PENDING' } })
    if (l.status.key === 'NEW' && !pending) {
      const dueAt = firstCallDue(new Date(), s.automation.firstCall.minutes, s, await holidaySet())
      await t.followUp.create({ data: { leadId: a.leadId, userId: a.userId, type: 'CALL', dueAt, reason: 'First call', auto: true } })
      await t.lead.update({ where: { id: a.leadId }, data: { nextFollowUpAt: dueAt } })
    }
  }
  if (moved.count && a.notifyOwner !== false) {
    await notify(t, a.userId, { type: 'FOLLOW_UPS_MOVED', title: `${moved.count} follow-up(s) moved to you`, link: `/leads/${a.leadId}` })
  }
  return lead.ownerId
}

/** BDE list → back to the team pool (exit, recycle, take back). Follow-ups stay attached to the lead. */
export async function returnToTeamPool(t: Tx, leadId: number, reason: EndReason) {
  await endOpen(t, leadId, 'BDE', reason)
  await t.lead.update({ where: { id: leadId }, data: { ownerId: null, version: { increment: 1 } } })
}

/** Team pool → company pool (team deactivated, Admin takes back). */
export async function returnToCompanyPool(t: Tx, leadId: number, reason: EndReason) {
  await endOpen(t, leadId, 'BDE', reason)
  await endOpen(t, leadId, 'TEAM', reason)
  await t.lead.update({ where: { id: leadId }, data: { ownerId: null, teamId: null, version: { increment: 1 } } })
}

export async function newRun(t: Tx, r: { level: 'TEAM' | 'BDE'; method: AllocMethod; teamId?: number | null; by?: number | null; params?: object; count: number }) {
  return t.allocationRun.create({ data: { level: r.level, method: r.method, teamId: r.teamId ?? null, startedBy: r.by ?? null, params: r.params ?? {}, leadCount: r.count } })
}
