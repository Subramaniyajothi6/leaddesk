import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { me, assertLeadAccess, ledTeamIds } from '../../lib/access.js'
import { badRequest, notFound, forbidden } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { localDate, dayBounds } from '../../lib/time.js'
import { maskPhone } from '../../lib/phone.js'
import { quickPicks, holidaySet } from '../../lib/workdays.js'
import { addFollowUp, refreshNextFollowUp } from '../work/service.js'

export const followUpsRouter = Router()

/** Overdue / Due today / Upcoming, type filter, list or calendar range (§8 items 3, 8). */
followUpsRouter.get('/', async (req, res) => {
  const u = me(req)
  const q = parse(z.object({
    tab: z.enum(['overdue', 'today', 'upcoming', 'all']).default('today'),
    type: z.enum(['CALL', 'WHATSAPP', 'MEETING', 'TASK']).optional(),
    userId: z.coerce.number().optional(), teamId: z.coerce.number().optional(),
    from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  }), req.query)
  const s = await getSettings()
  const now = new Date()
  const { start, end } = dayBounds(localDate(now, s.company.timeZone), s.company.timeZone)
  const where: Prisma.FollowUpWhereInput = { state: 'PENDING', lead: { deletedAt: null } }
  if (u.role === 'BDE') where.userId = u.id
  else if (u.role === 'TEAM_LEAD') {
    const teams = await ledTeamIds(u.id)
    if (q.teamId && !teams.includes(q.teamId)) throw forbidden('Not your team')
    where.lead = { deletedAt: null, teamId: { in: q.teamId ? [q.teamId] : teams } }
  } else if (q.teamId) where.lead = { deletedAt: null, teamId: q.teamId }
  if (q.userId && u.role !== 'BDE') where.userId = q.userId
  if (q.type) where.type = q.type
  if (q.from || q.to) where.dueAt = { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(q.to) }) }
  else if (q.tab === 'overdue') where.dueAt = { lt: now }
  else if (q.tab === 'today') where.dueAt = { gte: now, lt: end }
  else if (q.tab === 'upcoming') where.dueAt = { gte: end }
  const rows = await prisma.followUp.findMany({ where, orderBy: { dueAt: 'asc' }, take: 500, include: { lead: { select: { id: true, name: true, phoneE164: true, status: { select: { label: true, colour: true } }, version: true } } } })
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]))
  const counts = u.role === 'BDE' ? {
    overdue: await prisma.followUp.count({ where: { userId: u.id, state: 'PENDING', dueAt: { lt: now }, lead: { deletedAt: null } } }),
    today: await prisma.followUp.count({ where: { userId: u.id, state: 'PENDING', dueAt: { gte: now, lt: end }, lead: { deletedAt: null } } }),
    upcoming: await prisma.followUp.count({ where: { userId: u.id, state: 'PENDING', dueAt: { gte: end }, lead: { deletedAt: null } } }),
  } : undefined
  res.json({
    counts, dayStart: start,
    rows: rows.map((f) => ({ id: f.id, type: f.type, dueAt: f.dueAt, reason: f.reason, auto: f.auto, overdue: f.dueAt < now, owner: { id: f.userId, name: users.get(f.userId) }, lead: { ...f.lead, phoneE164: undefined, phone: u.role === 'BDE' ? maskPhone(f.lead.phoneE164) : f.lead.phoneE164 } })),
  })
})

/** Suggested times that skip holidays and week-offs, plus the status's default interval. */
followUpsRouter.get('/quick-picks', async (req, res) => {
  const statusId = parse(z.coerce.number().optional(), req.query.statusId)
  const st = statusId ? await prisma.status.findUnique({ where: { id: statusId } }) : null
  res.json(quickPicks(new Date(), await getSettings(), await holidaySet(), st?.followUpHours))
})

followUpsRouter.post('/lead/:leadId', async (req, res) => {
  const u = me(req)
  const leadId = parse(idParam, req.params.leadId)
  const b = parse(z.object({ dueAt: z.string().datetime({ offset: true }), type: z.enum(['CALL', 'WHATSAPP', 'MEETING', 'TASK']).default('CALL'), reason: z.string().trim().max(300).optional() }), req.body)
  const lead = await assertLeadAccess(u, leadId)
  const st = await prisma.status.findUniqueOrThrow({ where: { id: lead.statusId } })
  if (st.category !== 'OPEN') throw badRequest(`${st.label} is a final status; no follow-ups needed`)
  res.status(201).json(await tx((t) => addFollowUp(t, lead, u.id, b)))
})

/** Reschedule (pick a new time) or cancel with a reason. Completing happens only by logging a call or status. */
followUpsRouter.patch('/:id', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ dueAt: z.string().datetime({ offset: true }).optional(), cancelReason: z.string().trim().min(1).max(300).optional() }), req.body)
  if (!b.dueAt && !b.cancelReason) throw badRequest('Give a new time or a reason to cancel')
  const f = await prisma.followUp.findUnique({ where: { id } })
  if (!f || f.state !== 'PENDING') throw notFound('Pending follow-up')
  await assertLeadAccess(u, f.leadId)
  await tx(async (t) => {
    if (b.cancelReason) {
      await t.followUp.update({ where: { id }, data: { state: 'CANCELLED', reason: `${f.reason ?? ''} · cancelled: ${b.cancelReason}`.replace(/^ · /, '') } })
    } else {
      const d = new Date(b.dueAt!)
      if (d.getTime() < Date.now() - 60_000) throw badRequest('New time is in the past')
      await t.followUp.update({ where: { id }, data: { dueAt: d, remindedAt: null } })
    }
    await refreshNextFollowUp(t, f.leadId)
  })
  res.json({ ok: true })
})
