import { Router } from 'express'
import { z } from 'zod'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, visibleTeamIds, assertTeamAccess } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, conflict } from '../../lib/errors.js'
import { returnToCompanyPool } from '../allocation/assign.js'

export const teamsRouter = Router()

teamsRouter.get('/', async (req, res) => {
  const ids = await visibleTeamIds(me(req))
  const teams = await prisma.team.findMany({
    where: ids ? { id: { in: ids } } : {},
    orderBy: { name: 'asc' },
    include: {
      leadLinks: { where: { toAt: null }, include: { user: { select: { id: true, name: true, state: true } } } },
      memberships: { where: { toAt: null }, include: { user: { select: { id: true, name: true, state: true, empCode: true } } } },
    },
  })
  const pools = await prisma.lead.groupBy({ by: ['teamId'], where: { deletedAt: null, ownerId: null, teamId: { not: null } }, _count: true })
  const pool = new Map(pools.map((p) => [p.teamId, p._count]))
  res.json(teams.map((t) => {
    const lead = t.leadLinks.find((l) => l.user.state === 'ACTIVE')
    return {
      id: t.id, name: t.name, state: t.state, autoDistribute: t.autoDistribute, method: t.method,
      teamLead: lead ? { id: lead.user.id, name: lead.user.name } : null, // null → Admin acts as Team Lead (§2)
      members: t.memberships.map((m) => m.user), poolCount: pool.get(t.id) ?? 0,
    }
  }))
})

teamsRouter.post('/', allow('ADMIN'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), autoDistribute: z.boolean().optional(), method: z.enum(['SMART', 'EQUAL', 'WORKLOAD']).optional() }), req.body)
  if (await prisma.team.findUnique({ where: { name: b.name } })) throw conflict('A team with this name exists')
  const team = await prisma.team.create({ data: b })
  await audit(prisma, { actorId: me(req).id, action: 'TEAM_CREATE', entity: 'team', entityId: team.id, after: team, ip: clientIp(req) })
  res.status(201).json(team)
})

/** Admin edits everything; a Team Lead may switch auto-distribute and the default method of own teams. */
teamsRouter.patch('/:id', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const u = me(req)
  await assertTeamAccess(u, id)
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), autoDistribute: z.boolean().optional(), method: z.enum(['SMART', 'EQUAL', 'WORKLOAD']).optional() }), req.body)
  if (b.name && u.role !== 'ADMIN') throw badRequest('Only Admin can rename a team')
  const before = await prisma.team.findUnique({ where: { id } })
  if (!before) throw notFound('Team')
  const after = await prisma.team.update({ where: { id }, data: b })
  await audit(prisma, { actorId: u.id, action: 'TEAM_UPDATE', entity: 'team', entityId: id, before, after, ip: clientIp(req) })
  res.json(after)
})

/** Link a Team Lead (closes the previous link). One active Team Lead per team (partial unique index). */
teamsRouter.post('/:id/lead', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ userId: z.number().int().positive().nullable() }), req.body)
  const team = await prisma.team.findUnique({ where: { id } })
  if (!team || team.state !== 'ACTIVE') throw notFound('Team')
  if (b.userId) {
    const u = await prisma.user.findUnique({ where: { id: b.userId } })
    if (!u || u.role !== 'TEAM_LEAD' || u.state !== 'ACTIVE') throw badRequest('Pick an active user with the Team Lead role')
  }
  await tx(async (t) => {
    const prev = await t.teamLeadLink.findFirst({ where: { teamId: id, toAt: null } })
    if (prev?.userId === b.userId) return
    if (prev) await t.teamLeadLink.update({ where: { id: prev.id }, data: { toAt: new Date() } })
    if (b.userId) await t.teamLeadLink.create({ data: { teamId: id, userId: b.userId } })
    await audit(t, { actorId: me(req).id, action: 'TEAM_LEAD_LINK', entity: 'team', entityId: id, before: { userId: prev?.userId ?? null }, after: { userId: b.userId }, ip: clientIp(req) })
  })
  res.json({ ok: true })
})

/** Add a BDE who has no team yet. Moving between teams is the user transfer action (asks what happens to leads). */
teamsRouter.post('/:id/members', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ userId: z.number().int().positive() }), req.body)
  const team = await prisma.team.findUnique({ where: { id } })
  if (!team || team.state !== 'ACTIVE') throw notFound('Team')
  const u = await prisma.user.findUnique({ where: { id: b.userId } })
  if (!u || u.role !== 'BDE' || u.state === 'EXITED') throw badRequest('Pick an existing BDE')
  const cur = await prisma.teamMembership.findFirst({ where: { userId: b.userId, toAt: null } })
  if (cur) throw conflict('This BDE is already in a team. Use transfer to move them.', { teamId: cur.teamId })
  await prisma.teamMembership.create({ data: { teamId: id, userId: b.userId } })
  await audit(prisma, { actorId: me(req).id, action: 'TEAM_MEMBER_ADD', entity: 'team', entityId: id, after: { userId: b.userId }, ip: clientIp(req) })
  res.status(201).json({ ok: true })
})

/** Deactivate only when the team has no BDEs; its pool returns to the company pool (§6). */
teamsRouter.post('/:id/deactivate', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const team = await prisma.team.findUnique({ where: { id } })
  if (!team) throw notFound('Team')
  if (team.state === 'INACTIVE') return res.json({ ok: true, unchanged: true })
  const members = await prisma.teamMembership.count({ where: { teamId: id, toAt: null } })
  if (members) throw badRequest(`Move the team's ${members} BDE(s) to another team first`)
  const withOwner = await prisma.lead.count({ where: { teamId: id, ownerId: { not: null }, deletedAt: null } })
  if (withOwner) throw badRequest(`${withOwner} leads still belong to former members. Reassign or take them back first.`)
  const returned = await tx(async (t) => {
    const leads = await t.lead.findMany({ where: { teamId: id, deletedAt: null }, select: { id: true } })
    for (const l of leads) await returnToCompanyPool(t, l.id, 'TAKEN_BACK')
    await t.teamLeadLink.updateMany({ where: { teamId: id, toAt: null }, data: { toAt: new Date() } })
    await t.team.update({ where: { id }, data: { state: 'INACTIVE' } })
    await audit(t, { actorId: me(req).id, action: 'TEAM_DEACTIVATE', entity: 'team', entityId: id, after: { leadsReturned: leads.length }, ip: clientIp(req) })
    return leads.length
  })
  res.json({ ok: true, leadsReturned: returned })
})
