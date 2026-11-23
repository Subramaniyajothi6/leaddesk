import { Router } from 'express'
import { z } from 'zod'
import crypto from 'node:crypto'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, ledTeamIds } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, conflict } from '../../lib/errors.js'
import { getSetting } from '../../lib/settings.js'
import { openStatusIds } from '../../lib/statuses.js'
import { hashPassword } from '../auth/routes.js'
import { returnToTeamPool, assignToBde, endOpen } from '../allocation/assign.js'
import { notifyMany, teamLeadersOf } from '../notifications/service.js'

export const usersRouter = Router()

const pub = { id: true, empCode: true, name: true, email: true, phone: true, role: true, state: true, joinedOn: true, exitedOn: true, lastLoginAt: true, mustChangePassword: true } as const

/** A readable temporary password, shown once to the Admin. */
const tempPassword = () => `Ld-${crypto.randomBytes(4).toString('hex')}9`

usersRouter.get('/', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const q = parse(z.object({ role: z.enum(['ADMIN', 'TEAM_LEAD', 'BDE']).optional(), state: z.enum(['ACTIVE', 'INACTIVE', 'EXITED']).optional(), teamId: z.coerce.number().optional(), q: z.string().optional() }), req.query)
  const u = me(req)
  const where: Record<string, unknown> = {}
  if (q.role) where.role = q.role
  if (q.state) where.state = q.state
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { empCode: { contains: q.q, mode: 'insensitive' } }]
  let teamFilter = q.teamId ? [q.teamId] : null
  if (u.role === 'TEAM_LEAD') {
    const mine = await ledTeamIds(u.id)
    teamFilter = teamFilter ? teamFilter.filter((t) => mine.includes(t)) : mine
  }
  if (teamFilter) where.memberships = { some: { teamId: { in: teamFilter }, toAt: null } }
  const users = await prisma.user.findMany({
    where, orderBy: { name: 'asc' },
    select: { ...pub, memberships: { where: { toAt: null }, select: { teamId: true, team: { select: { name: true } } } }, leadLinks: { where: { toAt: null }, select: { teamId: true } } },
  })
  const open = await openStatusIds()
  const counts = await prisma.lead.groupBy({ by: ['ownerId'], where: { deletedAt: null, statusId: { in: open }, ownerId: { in: users.map((x) => x.id) } }, _count: true })
  const byOwner = new Map(counts.map((c) => [c.ownerId, c._count]))
  res.json(users.map(({ memberships, leadLinks, ...x }) => ({
    ...x, team: memberships[0] ? { id: memberships[0].teamId, name: memberships[0].team.name } : null,
    leadsTeams: leadLinks.map((l) => l.teamId), openLeads: byOwner.get(x.id) ?? 0,
  })))
})

const createSchema = z.object({
  empCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).optional(),
  role: z.enum(['ADMIN', 'TEAM_LEAD', 'BDE']),
  teamId: z.number().int().positive().optional(),
  joinedOn: z.string().date().optional(),
})

usersRouter.post('/', allow('ADMIN'), async (req, res) => {
  const b = parse(createSchema, req.body)
  if (b.teamId && b.role !== 'BDE') throw badRequest('Only BDEs are members of a team. Link a Team Lead from the team page.')
  const dupe = await prisma.user.findFirst({ where: { OR: [{ email: b.email }, { empCode: b.empCode }] } })
  if (dupe) throw conflict(dupe.email === b.email ? 'This email is already used' : 'This employee code is already used')
  const password = tempPassword()
  const user = await tx(async (t) => {
    const u = await t.user.create({ data: { empCode: b.empCode, name: b.name, email: b.email, phone: b.phone, role: b.role, passwordHash: await hashPassword(password), joinedOn: b.joinedOn ? new Date(b.joinedOn) : undefined }, select: pub })
    if (b.teamId) {
      const team = await t.team.findUnique({ where: { id: b.teamId } })
      if (!team || team.state !== 'ACTIVE') throw badRequest('Team not found or inactive')
      await t.teamMembership.create({ data: { teamId: b.teamId, userId: u.id } })
    }
    await audit(t, { actorId: me(req).id, action: 'USER_CREATE', entity: 'user', entityId: u.id, after: { ...u, teamId: b.teamId }, ip: clientIp(req) })
    return u
  })
  res.status(201).json({ user, temporaryPassword: password })
})

usersRouter.patch('/:id', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ name: z.string().trim().min(1).optional(), email: z.string().trim().toLowerCase().email().optional(), phone: z.string().trim().max(20).nullable().optional(), empCode: z.string().trim().min(1).optional() }), req.body)
  const before = await prisma.user.findUnique({ where: { id }, select: pub })
  if (!before) throw notFound('User')
  try {
    const after = await prisma.user.update({ where: { id }, data: b, select: pub })
    await audit(prisma, { actorId: me(req).id, action: 'USER_UPDATE', entity: 'user', entityId: id, before, after, ip: clientIp(req) })
    res.json(after)
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('Email or employee code already used')
    throw e
  }
})

usersRouter.post('/:id/reset-password', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const password = tempPassword()
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } })
  await audit(prisma, { actorId: me(req).id, action: 'PASSWORD_RESET', entity: 'user', entityId: id, ip: clientIp(req) })
  res.json({ temporaryPassword: password })
})

/**
 * Active / Inactive / Exited (§6). Users are never deleted.
 * Inactive: can't log in, keeps leads (they show as unattended). Exited: leaves the team; open leads
 * return to the team pool when the auto-return setting is on.
 */
usersRouter.post('/:id/state', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ state: z.enum(['ACTIVE', 'INACTIVE', 'EXITED']), exitedOn: z.string().date().optional() }), req.body)
  const actor = me(req)
  if (id === actor.id) throw badRequest('You cannot change your own state')
  const u = await prisma.user.findUnique({ where: { id } })
  if (!u) throw notFound('User')
  if (u.state === b.state) return res.json({ ok: true, unchanged: true })
  const alloc = await getSetting('allocation')
  const result = await tx(async (t) => {
    let returned = 0
    if (b.state === 'EXITED') {
      const team = await t.teamMembership.findFirst({ where: { userId: id, toAt: null } })
      if (u.role === 'BDE' && alloc.autoReturnOnExit) {
        const open = await openStatusIds(t)
        const leads = await t.lead.findMany({ where: { ownerId: id, deletedAt: null, statusId: { in: open } }, select: { id: true } })
        for (const l of leads) await returnToTeamPool(t, l.id, 'USER_EXITED')
        returned = leads.length
        if (team && returned) await notifyMany(t, await teamLeadersOf(t, team.teamId), { type: 'LEADS_RETURNED', title: `${u.name} left: ${returned} leads back in the team pool`, link: `/allocation?teamId=${team.teamId}` })
      }
      await t.teamMembership.updateMany({ where: { userId: id, toAt: null }, data: { toAt: new Date() } })
      await t.teamLeadLink.updateMany({ where: { userId: id, toAt: null }, data: { toAt: new Date() } })
    }
    const after = await t.user.update({
      where: { id },
      data: { state: b.state, tokenVersion: { increment: 1 }, exitedOn: b.state === 'EXITED' ? new Date(b.exitedOn ?? new Date().toISOString().slice(0, 10)) : b.state === 'ACTIVE' ? null : undefined },
      select: pub,
    })
    await audit(t, { actorId: actor.id, action: 'USER_STATE', entity: 'user', entityId: id, before: { state: u.state }, after: { state: b.state, leadsReturned: returned }, ip: clientIp(req) })
    return { user: after, leadsReturned: returned }
  })
  res.json(result)
})

/** Move a BDE to another team (§6). Open leads stay in the old team's pool (default) or go with the BDE. */
usersRouter.post('/:id/transfer', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ teamId: z.number().int().positive(), leads: z.enum(['STAY', 'MOVE']).default('STAY') }), req.body)
  const u = await prisma.user.findUnique({ where: { id } })
  if (!u || u.role !== 'BDE') throw badRequest('Only an existing BDE can be transferred')
  if (u.state === 'EXITED') throw badRequest('This BDE has left the company')
  const to = await prisma.team.findUnique({ where: { id: b.teamId } })
  if (!to || to.state !== 'ACTIVE') throw badRequest('Target team not found or inactive')
  const result = await tx(async (t) => {
    const cur = await t.teamMembership.findFirst({ where: { userId: id, toAt: null } })
    if (cur?.teamId === b.teamId) throw badRequest('Already in this team')
    const now = new Date()
    if (cur) await t.teamMembership.update({ where: { id: cur.id }, data: { toAt: now } })
    await t.teamMembership.create({ data: { userId: id, teamId: b.teamId, fromAt: now } })
    const open = await openStatusIds(t)
    const leads = await t.lead.findMany({ where: { ownerId: id, deletedAt: null, statusId: { in: open } }, select: { id: true } })
    for (const l of leads) {
      if (b.leads === 'MOVE') await assignToBde(t, { leadId: l.id, teamId: b.teamId, userId: id, by: me(req).id, reason: { method: 'TRANSFER' }, endReason: 'TRANSFERRED', notifyOwner: false })
      else { await endOpen(t, l.id, 'BDE', 'TRANSFERRED'); await t.lead.update({ where: { id: l.id }, data: { ownerId: null, version: { increment: 1 } } }) }
    }
    await audit(t, { actorId: me(req).id, action: 'USER_TRANSFER', entity: 'user', entityId: id, before: { teamId: cur?.teamId ?? null }, after: { teamId: b.teamId, leads: b.leads, count: leads.length }, ip: clientIp(req) })
    return { fromTeamId: cur?.teamId ?? null, toTeamId: b.teamId, leads: b.leads, leadCount: leads.length }
  })
  res.json(result)
})

/** Values a BDE can handle for lead matching (§5.8), e.g. language = Tamil, English. */
usersRouter.put('/:id/match-values', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.record(z.string(), z.array(z.string().trim().min(1))), req.body)
  await tx(async (t) => {
    await t.userMatchValue.deleteMany({ where: { userId: id } })
    const rows = Object.entries(b).flatMap(([fieldKey, vals]) => [...new Set(vals.map((v) => v.toLowerCase()))].map((value) => ({ userId: id, fieldKey, value })))
    if (rows.length) await t.userMatchValue.createMany({ data: rows })
    await audit(t, { actorId: me(req).id, action: 'MATCH_VALUES', entity: 'user', entityId: id, after: b, ip: clientIp(req) })
  })
  res.json({ ok: true })
})
