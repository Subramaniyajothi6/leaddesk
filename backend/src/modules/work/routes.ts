import { Router } from 'express'
import { z } from 'zod'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, assertLeadAccess } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, unprocessable } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { localDate, dayBounds } from '../../lib/time.js'
import { maskPhone } from '../../lib/phone.js'
import { changeStatus, registerAttempt, addFollowUp, refreshNextFollowUp } from './service.js'
import { staleConflict } from '../leads/routes.js'
import { checkLowLeads } from '../allocation/service.js'
import { rescore } from '../leads/scoring.js'

export const workRouter = Router()

const followUpIn = z.object({ dueAt: z.string().datetime({ offset: true }), type: z.enum(['CALL', 'WHATSAPP', 'MEETING', 'TASK']).default('CALL'), reason: z.string().trim().max(300).optional() })

/** After the response: low-lead check for the owner (§5.5). Never fails the request. */
function afterWork(ownerId: number | null) {
  if (ownerId && process.env.NODE_ENV !== 'test') checkLowLeads(ownerId).catch((e) => console.error('low-lead check', e))
}

async function lockVersion(t: import('../../db.js').Tx, leadId: number, version: number) {
  const r = await t.lead.updateMany({ where: { id: leadId, version }, data: { version: { increment: 1 } } })
  if (!r.count) throw await staleConflict(leadId)
  return t.lead.findUniqueOrThrow({ where: { id: leadId } })
}

const statusBody = z.object({
  version: z.number().int(),
  statusId: z.number().int().optional(), statusKey: z.string().optional(),
  remarks: z.string().trim().max(1000).optional(),
  followUp: followUpIn.optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  skipNextFollowUpReason: z.string().trim().max(300).optional(),
})

workRouter.post('/leads/:id/status', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(statusBody, req.body)
  await assertLeadAccess(u, id)
  const to = await prisma.status.findFirst({ where: b.statusId ? { id: b.statusId } : { key: (b.statusKey ?? '').toUpperCase() } })
  if (!to) throw badRequest('Pick a status')
  const r = await tx(async (t) => {
    const lead = await lockVersion(t, id, b.version)
    return changeStatus(t, { lead, to, user: u, remarks: b.remarks, followUp: b.followUp, fields: b.fields, skipNextFollowUpReason: b.skipNextFollowUpReason })
  })
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id }, include: { status: true } })
  if (r.wasFresh || r.recycle !== 'none' || r.to.category !== 'OPEN') afterWork(lead.ownerId ?? null)
  res.json({ ok: true, lead: { id, status: lead.status, version: lead.version, nextFollowUpAt: lead.nextFollowUpAt, ownerId: lead.ownerId }, ...r, from: r.from.key, to: r.to.key })
})

/**
 * Log a call (§8.1): the outcome is always recorded; only a connected call may change the status.
 * Not-connected outcomes add an attempt and leave the status as it is.
 */
workRouter.post('/leads/:id/calls', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({
    version: z.number().int(), outcomeId: z.number().int(), durationSec: z.number().int().min(0).max(6 * 3600).default(0),
    startedAt: z.string().datetime({ offset: true }).optional(), channel: z.enum(['CALL', 'WHATSAPP']).default('CALL'),
    remarks: z.string().trim().max(1000).optional(), statusId: z.number().int().optional(), followUp: followUpIn.optional(),
    fields: z.record(z.string(), z.unknown()).optional(), skipNextFollowUpReason: z.string().trim().max(300).optional(),
  }), req.body)
  await assertLeadAccess(u, id)
  const outcome = await prisma.callOutcome.findUnique({ where: { id: b.outcomeId } })
  if (!outcome || !outcome.active) throw badRequest('Pick a call outcome')
  if (b.statusId && !outcome.connected) throw unprocessable(`"${outcome.label}" was not a conversation, so the status stays as it is`)
  if (outcome.needsFollowUp && !b.followUp) throw unprocessable(`"${outcome.label}" needs a follow-up time`, { needsFollowUp: true })
  const s = await getSettings()
  const r = await tx(async (t) => {
    const lead = await lockVersion(t, id, b.version)
    const before = lead.statusId
    let change = null
    if (b.statusId) {
      const to = await t.status.findUniqueOrThrow({ where: { id: b.statusId } })
      change = await changeStatus(t, { lead, to, user: u, remarks: b.remarks, followUp: b.followUp, fields: b.fields, skipNextFollowUpReason: b.skipNextFollowUpReason })
    } else {
      // No status change: the call itself completes due follow-ups; book the next one if given.
      await t.followUp.updateMany({ where: { leadId: id, state: 'PENDING', dueAt: { lte: new Date(Date.now() + 2 * 3_600_000) } }, data: { state: 'DONE', completedAt: new Date() } })
      if (b.followUp) await addFollowUp(t, lead, u.id, b.followUp)
      else await refreshNextFollowUp(t, id)
      await t.lead.update({ where: { id }, data: { lastActivityAt: new Date() } })
    }
    let recycle: string = change?.recycle ?? 'none'
    if (outcome.countsAsAttempt && !b.statusId) {
      recycle = await registerAttempt(t, await t.lead.findUniqueOrThrow({ where: { id } }), s, u.id)
    }
    const after = (await t.lead.findUniqueOrThrow({ where: { id } })).statusId
    const call = await t.callLog.create({ data: { leadId: id, userId: u.id, channel: b.channel, startedAt: b.startedAt ? new Date(b.startedAt) : new Date(Date.now() - b.durationSec * 1000), durationSec: b.durationSec, outcomeId: outcome.id, statusBeforeId: before, statusAfterId: after, remarks: b.remarks } })
    await rescore(t, id)
    return { callId: call.id, statusChanged: before !== after, recycle, wasFresh: change?.wasFresh ?? false }
  })
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id }, include: { status: true } })
  if (r.wasFresh || r.recycle !== 'none') afterWork(lead.ownerId ?? u.id)
  res.status(201).json({ ...r, lead: { id, status: lead.status, version: lead.version, attemptCount: lead.attemptCount, nextFollowUpAt: lead.nextFollowUpAt, ownerId: lead.ownerId } })
})

workRouter.post('/leads/:id/remarks', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body)
  await assertLeadAccess(u, id)
  const row = await prisma.leadRemark.create({ data: { leadId: id, byUserId: u.id, body: b.body } })
  await prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } })
  res.status(201).json(row)
})

/** WhatsApp click-to-chat with a template (§15): returns the wa.me link with the name filled in, logs the contact. */
workRouter.post('/leads/:id/whatsapp', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ templateId: z.number().int().optional() }), req.body ?? {})
  const lead = await assertLeadAccess(u, id)
  const s = await getSettings()
  let text = ''
  if (b.templateId) {
    const tpl = await prisma.messageTemplate.findUnique({ where: { id: b.templateId } })
    if (!tpl || !tpl.active) throw notFound('Template')
    text = tpl.body.replace(/\{\{\s*name\s*\}\}/g, lead.name.split(' ')[0]).replace(/\{\{\s*bde\s*\}\}/g, u.name).replace(/\{\{\s*company\s*\}\}/g, s.company.name)
  }
  await prisma.callLog.create({ data: { leadId: id, userId: u.id, channel: 'WHATSAPP', statusBeforeId: lead.statusId, statusAfterId: lead.statusId, remarks: text ? `Template: ${text.slice(0, 120)}` : null } })
  await prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } })
  await audit(prisma, { actorId: u.id, action: 'PHONE_REVEAL', entity: 'lead', entityId: id, after: { purpose: 'WHATSAPP' }, ip: clientIp(req) })
  res.json({ link: `https://wa.me/${lead.phoneE164.replace('+', '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`, text })
})

/**
 * BDE "Next to call" (§8 rule 5): overdue follow-ups → due today → fresh leads by score.
 * Leads already called today are left out unless a follow-up is due (setting).
 */
workRouter.get('/me/queue', allow('BDE', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const s = await getSettings()
  const { start, end } = dayBounds(localDate(new Date(), s.company.timeZone), s.company.timeZone)
  const now = new Date()
  const due = await prisma.followUp.findMany({ where: { userId: u.id, state: 'PENDING', dueAt: { lt: end }, lead: { deletedAt: null, ownerId: u.id } }, orderBy: { dueAt: 'asc' }, include: { lead: { include: { status: true } } } })
  const calledToday = new Set((await prisma.callLog.findMany({ where: { userId: u.id, startedAt: { gte: start } }, select: { leadId: true } })).map((c) => c.leadId))
  const fresh = await prisma.lead.findMany({ where: { ownerId: u.id, deletedAt: null, status: { key: 'NEW' }, ...(s.calls.leaveOutCalledToday && { id: { notIn: [...calledToday] } }) }, orderBy: [{ score: 'desc' }, { createdAt: 'asc' }], take: 50, include: { status: true } })
  const seen = new Set<number>()
  const item = (l: (typeof fresh)[number], why: string, dueAt?: Date) => ({ leadId: l.id, name: l.name, phone: maskPhone(l.phoneE164), status: l.status.label, score: l.score, why, dueAt: dueAt ?? null, version: l.version })
  const queue = []
  for (const f of due) if (!seen.has(f.leadId)) { seen.add(f.leadId); queue.push(item(f.lead, f.dueAt < now ? 'Overdue follow-up' : 'Follow-up due today', f.dueAt)) }
  for (const l of fresh) if (!seen.has(l.id)) { seen.add(l.id); queue.push(item(l, 'Fresh lead')) }
  res.json({ queue, counts: { overdue: due.filter((f) => f.dueAt < now).length, dueToday: due.filter((f) => f.dueAt >= now).length, fresh: fresh.length }, wrapUpSec: s.calls.wrapUpSec })
})
