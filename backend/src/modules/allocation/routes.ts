import { Router } from 'express'
import { z } from 'zod'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, assertTeamAccess, visibleTeamIds, type AuthUser } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, unprocessable, forbidden } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { openStatusIds } from '../../lib/statuses.js'
import { previewStage1, runStage1, previewStage2, runStage2, candidatesFor, limitsFor, openCounts, freshCounts } from './service.js'
import { assignToBde, assignToTeam, returnToTeamPool, returnToCompanyPool, newRun } from './assign.js'
import { notify } from '../notifications/service.js'

export const allocationRouter = Router()

// ---------- Stage 1: company pool → teams (Admin) ----------
const stage1Body = z.object({
  teamIds: z.array(z.number().int().positive()).min(1),
  count: z.number().int().min(1).max(20_000),
  method: z.enum(['EQUAL', 'CAPACITY', 'MANUAL']).optional(),
  manual: z.record(z.string(), z.number().int().min(0)).optional(),
  batchId: z.number().int().optional(), sourceId: z.number().int().optional(), minScore: z.number().int().optional(),
  field: z.object({ key: z.string(), value: z.string() }).optional(),
  alsoToBdes: z.boolean().default(false),
})

allocationRouter.post('/teams/preview', allow('ADMIN'), async (req, res) => {
  const b = parse(stage1Body, req.body)
  const method = b.method ?? (await getSettings()).allocation.stage1Method
  res.json(await previewStage1({ ...b, method }))
})

allocationRouter.post('/teams', allow('ADMIN'), async (req, res) => {
  const b = parse(stage1Body, req.body)
  const method = b.method ?? (await getSettings()).allocation.stage1Method
  const by = me(req).id
  const r = await tx((t) => runStage1(t, { ...b, method }, by), { timeout: 120_000 })
  // "Also give to BDEs now, using each team's own method"
  const followUp = b.alsoToBdes ? await Promise.all(b.teamIds.map((teamId) => tx((t) => runStage2(t, { teamId }, by), { timeout: 120_000 }).then((x) => ({ teamId, given: x.given, message: x.message })))) : []
  res.status(201).json({ ...r, toBdes: followUp })
})

/** Admin moves leads still in one team's pool to another team (§5.5 rule 5: never a lead a BDE is working). */
allocationRouter.post('/move-pool', allow('ADMIN'), async (req, res) => {
  const b = parse(z.object({ fromTeamId: z.number().int(), toTeamId: z.number().int(), count: z.number().int().min(1) }), req.body)
  if (b.fromTeamId === b.toTeamId) throw badRequest('Pick two different teams')
  const to = await prisma.team.findUnique({ where: { id: b.toTeamId } })
  if (!to || to.state !== 'ACTIVE') throw badRequest('Target team not found or inactive')
  const by = me(req).id
  const r = await tx(async (t) => {
    const open = await openStatusIds(t)
    const ids = (await t.$queryRaw<{ id: number }[]>`SELECT id FROM leads WHERE team_id = ${b.fromTeamId} AND owner_id IS NULL AND deleted_at IS NULL AND status_id = ANY(${open}::int[]) ORDER BY score DESC, created_at ASC LIMIT ${b.count} FOR UPDATE SKIP LOCKED`).map((x) => x.id)
    if (!ids.length) throw unprocessable('That team pool is empty')
    const run = await newRun(t, { level: 'TEAM', method: 'MANUAL', by, params: b, count: ids.length })
    for (const leadId of ids) await assignToTeam(t, { leadId, teamId: b.toTeamId, runId: run.id, by, reason: { method: 'MOVE_POOL', fromTeamId: b.fromTeamId } })
    await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: by, leadCount: ids.length, before: ids.map((leadId) => ({ leadId, teamId: b.fromTeamId, ownerId: null })), runId: run.id } })
    await audit(t, { actorId: by, action: 'MOVE_POOL', entity: 'allocation_run', entityId: run.id, after: { ...b, moved: ids.length }, ip: clientIp(req) })
    return { runId: run.id, moved: ids.length }
  })
  res.json(r)
})

// ---------- Stage 2: team pool → BDEs ----------
const stage2Body = z.object({ teamId: z.number().int().positive(), method: z.enum(['SMART', 'EQUAL', 'WORKLOAD']).optional(), count: z.number().int().min(1).max(10_000).optional(), leadIds: z.array(z.number().int()).optional() })

allocationRouter.post('/distribute/preview', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const b = parse(stage2Body, req.body)
  await assertTeamAccess(me(req), b.teamId)
  res.json(await previewStage2(b))
})

allocationRouter.post('/distribute', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const b = parse(stage2Body, req.body)
  await assertTeamAccess(me(req), b.teamId)
  const by = me(req).id
  res.status(201).json(await tx((t) => runStage2(t, b, by), { timeout: 120_000 }))
})

/** BDEs of a team with load, limits and why they can't get leads today (manual screen, "Edit max"). */
allocationRouter.get('/eligibility', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const teamId = parse(z.coerce.number().int().positive(), req.query.teamId)
  await assertTeamAccess(me(req), teamId)
  const s = await getSettings()
  const c = await candidatesFor(prisma, teamId, s)
  const fresh = await freshCounts(prisma, c.map((x) => x.userId))
  const pool = await prisma.lead.count({ where: { teamId, ownerId: null, deletedAt: null } })
  res.json({ teamId, pool, bdes: c.map((x) => ({ userId: x.userId, name: x.name, open: x.open, max: x.max, left: Math.max(0, x.max - x.open), givenToday: x.givenToday, maxPerDay: x.maxPerDay, fresh: fresh.get(x.userId) ?? 0, perf: x.perf, notEligibleToday: x.skip ?? null })) })
})

/**
 * Manual (§5.4): may go over a max only with a typed reason, recorded in the audit log.
 * Inactive / exited BDEs are blocked; a previous owner is not allowed (recycled leads never go back).
 */
async function checkManualTarget(u: AuthUser, userId: number, adding: number, overMaxReason?: string) {
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target || target.role !== 'BDE') throw badRequest('Pick a BDE')
  if (target.state !== 'ACTIVE') throw unprocessable(`${target.name} is ${target.state.toLowerCase()} and cannot get leads`)
  const m = await prisma.teamMembership.findFirst({ where: { userId, toAt: null } })
  if (!m) throw unprocessable(`${target.name} is not in a team`)
  await assertTeamAccess(u, m.teamId)
  const lim = (await limitsFor(prisma, m.teamId, [userId])).get(userId)!
  const open = (await openCounts(prisma, [userId])).get(userId) ?? 0
  const after = open + adding
  const over = after > lim.max
  if (over && !overMaxReason?.trim()) throw unprocessable(`${target.name} will be at ${after} / ${lim.max}. Type a reason to go over the max.`, { open, max: lim.max, after, needsReason: true })
  return { target, teamId: m.teamId, over, after, max: lim.max }
}

allocationRouter.post('/assign', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const b = parse(z.object({ leadIds: z.array(z.number().int()).min(1).max(1000), userId: z.number().int(), overMaxReason: z.string().trim().max(300).optional() }), req.body)
  const open = await openStatusIds()
  const leads = await prisma.lead.findMany({ where: { id: { in: b.leadIds }, deletedAt: null } })
  if (leads.length !== new Set(b.leadIds).size) throw notFound('Some leads')
  const already = leads.filter((l) => l.ownerId === b.userId).length
  const chk = await checkManualTarget(u, b.userId, leads.length - already, b.overMaxReason)
  for (const l of leads) {
    if (!open.includes(l.statusId)) throw unprocessable(`Lead ${l.name} is closed (final status). Reopen it first.`)
    if (l.teamId == null && u.role !== 'ADMIN') throw forbidden('Only Admin assigns leads from the company pool')
    if (l.teamId != null) await assertTeamAccess(u, l.teamId)
  }
  const prevOwners = await prisma.leadAssignment.findMany({ where: { leadId: { in: b.leadIds }, level: 'BDE', userId: b.userId, endReason: 'RECYCLED' }, select: { leadId: true } })
  if (prevOwners.length) throw unprocessable(`${chk.target.name} already had ${prevOwners.length} of these leads before they were recycled. Pick someone else.`, { leadIds: prevOwners.map((p) => p.leadId) })
  const r = await tx(async (t) => {
    const run = await newRun(t, { level: 'BDE', method: 'MANUAL', teamId: chk.teamId, by: u.id, params: { userId: b.userId, overMaxReason: b.overMaxReason }, count: leads.length })
    const before: object[] = []
    for (const l of leads) {
      if (l.ownerId === b.userId) continue
      before.push({ leadId: l.id, teamId: l.teamId, ownerId: l.ownerId })
      await assignToBde(t, { leadId: l.id, teamId: chk.teamId, userId: b.userId, runId: run.id, by: u.id, reason: { method: 'MANUAL', ...(chk.over && { overMax: `${chk.after}/${chk.max}`, why: b.overMaxReason }) }, overMax: chk.over })
      if (l.ownerId) await notify(t, l.ownerId, { type: 'LEAD_REASSIGNED', title: `${l.name} was moved to another BDE`, link: '/leads' })
    }
    await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: u.id, leadCount: before.length, before, runId: run.id } })
    await notify(t, b.userId, { type: 'LEADS_ASSIGNED', title: `${before.length} lead(s) assigned to you`, link: '/today' })
    await audit(t, { actorId: u.id, action: chk.over ? 'ASSIGN_OVER_MAX' : 'ASSIGN', entity: 'allocation_run', entityId: run.id, after: { userId: b.userId, leads: before.length, over: chk.over ? `${chk.after}/${chk.max}` : null, reason: b.overMaxReason }, ip: clientIp(req) })
    return { runId: run.id, assigned: before.length, overMax: chk.over, loadAfter: `${chk.after}/${chk.max}` }
  })
  res.status(201).json(r)
})

/** Manual "type counts per BDE": take N best leads from the team pool for each BDE. */
allocationRouter.post('/assign-counts', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const b = parse(z.object({ teamId: z.number().int(), counts: z.array(z.object({ userId: z.number().int(), count: z.number().int().min(1) })).min(1), overMaxReason: z.string().trim().max(300).optional() }), req.body)
  await assertTeamAccess(u, b.teamId)
  const checks: (Awaited<ReturnType<typeof checkManualTarget>> & { count: number })[] = []
  for (const c of b.counts) {
    const chk = await checkManualTarget(u, c.userId, c.count, b.overMaxReason)
    if (chk.teamId !== b.teamId) throw badRequest(`${chk.target.name} is not in this team`)
    checks.push({ ...chk, count: c.count })
  }
  const r = await tx(async (t) => {
    await t.$queryRaw`SELECT id FROM teams WHERE id = ${b.teamId} FOR UPDATE`
    const open = await openStatusIds(t)
    const need = b.counts.reduce((a, c) => a + c.count, 0)
    const ids = (await t.$queryRaw<{ id: number }[]>`SELECT id FROM leads WHERE team_id = ${b.teamId} AND owner_id IS NULL AND deleted_at IS NULL AND dnd = false AND status_id = ANY(${open}::int[]) ORDER BY score DESC, created_at ASC LIMIT ${need} FOR UPDATE SKIP LOCKED`).map((x) => x.id)
    if (ids.length < need) throw unprocessable(`The team pool has only ${ids.length} leads, you asked for ${need}`)
    const run = await newRun(t, { level: 'BDE', method: 'MANUAL', teamId: b.teamId, by: u.id, params: b, count: need })
    let i = 0
    const out = []
    for (const c of checks) {
      for (let k = 0; k < c.count; k++) {
        const leadId = ids[i++]
        await assignToBde(t, { leadId, teamId: b.teamId, userId: c.target.id, runId: run.id, by: u.id, reason: { method: 'MANUAL_COUNT', ...(c.over && { overMax: `${c.after}/${c.max}`, why: b.overMaxReason }) }, overMax: c.over })
      }
      await notify(t, c.target.id, { type: 'LEADS_ASSIGNED', title: `${c.count} new leads for you`, link: '/today' })
      out.push({ userId: c.target.id, name: c.target.name, given: c.count, loadAfter: `${c.after}/${c.max}`, overMax: c.over })
    }
    await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: u.id, leadCount: need, before: ids.map((leadId) => ({ leadId, teamId: b.teamId, ownerId: null })), runId: run.id } })
    await audit(t, { actorId: u.id, action: checks.some((c) => c.over) ? 'ASSIGN_OVER_MAX' : 'ASSIGN', entity: 'allocation_run', entityId: run.id, after: { teamId: b.teamId, out, reason: b.overMaxReason }, ip: clientIp(req) })
    return { runId: run.id, rows: out }
  })
  res.status(201).json(r)
})

/** Take leads back: to the team pool (Team Lead / Admin) or to the company pool (Admin only). */
allocationRouter.post('/take-back', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const b = parse(z.object({ leadIds: z.array(z.number().int()).min(1).max(1000), to: z.enum(['TEAM_POOL', 'COMPANY_POOL']).default('TEAM_POOL'), reason: z.string().trim().max(300).optional() }), req.body)
  if (b.to === 'COMPANY_POOL' && u.role !== 'ADMIN') throw forbidden('Only Admin can return leads to the company pool')
  const leads = await prisma.lead.findMany({ where: { id: { in: b.leadIds }, deletedAt: null } })
  for (const l of leads) if (l.teamId) await assertTeamAccess(u, l.teamId)
  const r = await tx(async (t) => {
    const before = leads.map((l) => ({ leadId: l.id, teamId: l.teamId, ownerId: l.ownerId }))
    for (const l of leads) {
      if (b.to === 'COMPANY_POOL') await returnToCompanyPool(t, l.id, 'TAKEN_BACK')
      else if (l.ownerId) await returnToTeamPool(t, l.id, 'TAKEN_BACK')
    }
    const ba = await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: u.id, leadCount: leads.length, before } })
    await audit(t, { actorId: u.id, action: 'TAKE_BACK', entity: 'bulk_action', entityId: ba.id, after: { to: b.to, count: leads.length, reason: b.reason }, ip: clientIp(req) })
    return { count: leads.length, bulkActionId: ba.id }
  })
  res.json(r)
})

// ---------- history (§15.1 #2) ----------
allocationRouter.get('/runs', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const q = parse(z.object({ teamId: z.coerce.number().optional(), method: z.string().optional(), from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query)
  const teams = await visibleTeamIds(me(req))
  const where = {
    ...(q.teamId && { teamId: q.teamId }), ...(teams && { teamId: { in: q.teamId ? teams.filter((t) => t === q.teamId) : teams } }),
    ...(q.method && { method: q.method as never }),
    ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(new Date(q.to).getTime() + 86_400_000) }) } }),
  }
  const [rows, total] = await Promise.all([prisma.allocationRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50 }), prisma.allocationRun.count({ where })])
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]))
  res.json({ total, rows: rows.map((r) => ({ ...r, startedByName: r.startedBy ? users.get(r.startedBy) : 'System' })) })
})

allocationRouter.get('/runs/:id', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const run = await prisma.allocationRun.findUnique({ where: { id }, include: { assignments: { include: { lead: { select: { id: true, name: true } } } } } })
  if (!run) throw notFound('Run')
  const teams = await visibleTeamIds(me(req))
  if (teams && run.teamId && !teams.includes(run.teamId)) throw notFound('Run')
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]))
  res.json({ ...run, assignments: run.assignments.map((a) => ({ lead: a.lead, to: a.userId ? users.get(a.userId) : `team ${a.teamId}`, reason: a.reason, overMax: a.overMax, endedAt: a.endedAt, endReason: a.endReason })) })
})

// ---------- bulk undo (§15.1 #10) ----------
allocationRouter.get('/bulk', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  res.json(await prisma.bulkAction.findMany({ where: { ...(u.role !== 'ADMIN' && { byUserId: u.id }), at: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { at: 'desc' }, take: 100 }))
})

/**
 * Undo within 30 days: every lead the action touched goes back where it was, if nobody moved it since.
 * Leads changed afterwards are skipped and listed.
 */
allocationRouter.post('/bulk/:id/undo', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const ba = await prisma.bulkAction.findUnique({ where: { id } })
  if (!ba) throw notFound('Action')
  if (u.role !== 'ADMIN' && ba.byUserId !== u.id) throw forbidden('You can undo only your own actions')
  if (ba.undoneAt) throw unprocessable('Already undone')
  if (ba.at.getTime() < Date.now() - 30 * 86_400_000) throw unprocessable('Actions can be undone for 30 days only')
  const r = await tx(async (t) => {
    const skipped: number[] = []
    let restored = 0
    if (ba.kind === 'IMPORT') {
      const batchId = (ba.before as { batchId: number }).batchId
      const leads = await t.lead.findMany({ where: { batchId, deletedAt: null } })
      for (const l of leads) {
        if (l.teamId != null || l.version > 0) { skipped.push(l.id); continue } // already used
        await t.lead.update({ where: { id: l.id }, data: { deletedAt: new Date(), deletedBy: u.id } }); restored++
      }
    } else if (ba.kind === 'DELETE') {
      for (const { id: leadId } of ba.before as { id: number }[]) { await t.lead.update({ where: { id: leadId }, data: { deletedAt: null, deletedBy: null, version: { increment: 1 } } }); restored++ }
    } else {
      for (const p of ba.before as { leadId: number; teamId: number | null; ownerId: number | null }[]) {
        const l = await t.lead.findUnique({ where: { id: p.leadId } })
        if (!l) { skipped.push(p.leadId); continue }
        const openA = await t.leadAssignment.findFirst({ where: { leadId: p.leadId, endedAt: null }, orderBy: { assignedAt: 'desc' } })
        if (ba.runId && openA?.runId !== ba.runId) { skipped.push(p.leadId); continue } // moved again since
        if (p.ownerId) await assignToBde(t, { leadId: p.leadId, teamId: p.teamId!, userId: p.ownerId, by: u.id, reason: { method: 'UNDO', bulkActionId: id }, endReason: 'UNDONE' })
        else if (p.teamId) { if (l.teamId !== p.teamId) await assignToTeam(t, { leadId: p.leadId, teamId: p.teamId, by: u.id, reason: { method: 'UNDO' } }); else await returnToTeamPool(t, p.leadId, 'UNDONE') }
        else await returnToCompanyPool(t, p.leadId, 'UNDONE')
        restored++
      }
    }
    await t.bulkAction.update({ where: { id }, data: { undoneAt: new Date(), undoneBy: u.id } })
    await audit(t, { actorId: u.id, action: 'BULK_UNDO', entity: 'bulk_action', entityId: id, after: { restored, skipped }, ip: clientIp(req) })
    return { restored, skipped }
  }, { timeout: 120_000 })
  res.json(r)
})
