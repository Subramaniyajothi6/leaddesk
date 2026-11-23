import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, leadScope, assertLeadAccess, type AuthUser } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { maskPhone } from '../../lib/phone.js'
import { getSettings } from '../../lib/settings.js'
import { validateLead } from './validate.js'
import { activeRules, scoreOf } from './scoring.js'
import { findDuplicates } from '../imports/duplicates.js'
import { newStatusId } from '../../lib/statuses.js'

export const leadsRouter = Router()

/** BDEs never see full numbers in lists (§12.3). */
export const showPhone = (u: AuthUser, e164: string) => (u.role === 'BDE' ? maskPhone(e164) : e164)

const listQuery = z.object({
  view: z.enum(['all', 'mine', 'unassigned', 'company_pool']).default('all'),
  status: z.string().optional(), // comma-separated keys
  category: z.enum(['OPEN', 'WON', 'LOST', 'EXCLUDED']).optional(),
  teamId: z.coerce.number().optional(),
  ownerId: z.coerce.number().optional(),
  sourceId: z.coerce.number().optional(),
  batchId: z.coerce.number().optional(),
  q: z.string().trim().optional(),
  fresh: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  unattended: z.coerce.boolean().optional(), // open leads whose BDE is inactive (§6)
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(['score', 'created', 'activity', 'followup', 'name']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export async function leadWhere(u: AuthUser, q: z.infer<typeof listQuery>): Promise<Prisma.LeadWhereInput> {
  const and: Prisma.LeadWhereInput[] = [await leadScope(u)]
  if (q.view === 'mine') and.push({ ownerId: u.id })
  if (q.view === 'unassigned') and.push({ ownerId: null, teamId: { not: null } })
  if (q.view === 'company_pool') {
    if (u.role !== 'ADMIN') throw badRequest('Only Admin sees the company pool')
    and.push({ teamId: null })
  }
  if (q.status) and.push({ status: { key: { in: q.status.split(',').map((s) => s.trim().toUpperCase()) } } })
  if (q.category) and.push({ status: { category: q.category } })
  if (q.teamId) and.push({ teamId: q.teamId })
  if (q.ownerId) and.push({ ownerId: q.ownerId })
  if (q.sourceId) and.push({ sourceId: q.sourceId })
  if (q.batchId) and.push({ batchId: q.batchId })
  if (q.fresh) and.push({ status: { key: 'NEW' }, ownerId: { not: null } })
  if (q.overdue) and.push({ followUps: { some: { state: 'PENDING', dueAt: { lt: new Date() } } } })
  if (q.unattended) and.push({ owner: { state: { not: 'ACTIVE' } }, status: { category: 'OPEN' } })
  if (q.from || q.to) and.push({ createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(new Date(q.to).getTime() + 86_400_000) }) } })
  if (q.q) {
    const digits = q.q.replace(/\D/g, '')
    and.push({ OR: [
      { name: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      // Search by the last digits only, so a BDE can't fish for a full number (§12.3).
      ...(digits.length >= 4 ? [{ phoneE164: { endsWith: digits.slice(-Math.min(digits.length, 10)) } }] : []),
    ] })
  }
  return { AND: and }
}

const orderBy = (sort: string): Prisma.LeadOrderByWithRelationInput[] => ({
  score: [{ score: 'desc' }, { createdAt: 'asc' }],
  created: [{ createdAt: 'desc' }],
  activity: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }],
  followup: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }],
  name: [{ name: 'asc' }],
} as Record<string, Prisma.LeadOrderByWithRelationInput[]>)[sort]

leadsRouter.get('/', async (req, res) => {
  const u = me(req)
  const q = parse(listQuery, req.query)
  const where = await leadWhere(u, q)
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy: orderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { status: { select: { key: true, label: true, colour: true, category: true } }, owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } }, source: { select: { name: true } } },
    }),
    prisma.lead.count({ where }),
  ])
  res.json({
    total, page: q.page, pageSize: q.pageSize,
    rows: rows.map((l) => ({
      id: l.id, name: l.name, phone: showPhone(u, l.phoneE164), email: l.email, score: l.score, status: l.status,
      owner: l.owner, team: l.team, source: l.source?.name ?? null, custom: l.custom, attemptCount: l.attemptCount,
      lastActivityAt: l.lastActivityAt, nextFollowUpAt: l.nextFollowUpAt, statusChangedAt: l.statusChangedAt, createdAt: l.createdAt, version: l.version,
    })),
  })
})

/** Built-in views (All / Mine / Unassigned) plus saved views (§15.1 #9). */
leadsRouter.get('/views', async (req, res) => {
  const u = me(req)
  const builtIn = [{ id: 'all', name: 'All', filters: { view: 'all' } }, { id: 'mine', name: 'Mine', filters: { view: 'mine' } }]
  if (u.role !== 'BDE') builtIn.push({ id: 'unassigned', name: 'Unassigned', filters: { view: 'unassigned' } })
  const saved = await prisma.savedView.findMany({ where: { page: 'leads', OR: [{ userId: u.id }, { userId: null }] }, orderBy: { order: 'asc' } })
  res.json([...builtIn, ...saved])
})
leadsRouter.post('/views', async (req, res) => {
  const u = me(req)
  const b = parse(z.object({ name: z.string().trim().min(1).max(60), filters: z.record(z.string(), z.unknown()), shared: z.boolean().default(false) }), req.body)
  if (b.shared && u.role !== 'ADMIN') throw badRequest('Only Admin can share a view with everyone')
  res.status(201).json(await prisma.savedView.create({ data: { userId: b.shared ? null : u.id, page: 'leads', name: b.name, filters: b.filters as object } }))
})
leadsRouter.delete('/views/:id', async (req, res) => {
  const id = parse(idParam, req.params.id)
  const v = await prisma.savedView.findUnique({ where: { id } })
  if (!v || (v.userId !== me(req).id && me(req).role !== 'ADMIN')) throw notFound('View')
  await prisma.savedView.delete({ where: { id } })
  res.json({ ok: true })
})

/** Leads in the trash (Admin), restorable for the retention period (§15.1 #10). */
leadsRouter.get('/trash', allow('ADMIN'), async (_req, res) => {
  const { leads } = await getSettings()
  const since = new Date(Date.now() - leads.trashDays * 86_400_000)
  res.json(await prisma.lead.findMany({ where: { deletedAt: { not: null, gte: since } }, orderBy: { deletedAt: 'desc' }, select: { id: true, name: true, phoneE164: true, deletedAt: true, deletedBy: true } }))
})

leadsRouter.get('/:id', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  await assertLeadAccess(u, id)
  const l = await prisma.lead.findUniqueOrThrow({
    where: { id },
    include: { status: true, owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } }, source: true, batch: { select: { id: true, fileName: true } } },
  })
  const nextFollowUp = await prisma.followUp.findFirst({ where: { leadId: id, state: 'PENDING' }, orderBy: { dueAt: 'asc' } })
  const allowedNext = await prisma.statusTransition.findMany({ where: { fromStatusId: l.statusId }, select: { toStatusId: true } })
  res.json({
    ...l, phoneE164: undefined, phone: showPhone(u, l.phoneE164),
    daysInStatus: Math.floor((Date.now() - l.statusChangedAt.getTime()) / 86_400_000),
    nextFollowUp, allowedNextStatusIds: allowedNext.map((t) => t.toStatusId),
    timeline: await timeline(id, String(req.query.filter ?? 'all')),
  })
})

/** Everything that happened to a lead, newest first (§15 activity timeline, §15.1 #4 filters). */
export async function timeline(leadId: number, filter = 'all') {
  const want = (k: string) => filter === 'all' || filter === k
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const statuses = new Map((await prisma.status.findMany({ select: { id: true, label: true } })).map((s) => [s.id, s.label]))
  const teams = new Map((await prisma.team.findMany({ select: { id: true, name: true } })).map((t) => [t.id, t.name]))
  const out: { at: Date; kind: string; by?: string | null; text: string; data?: unknown }[] = []
  if (want('assignments')) for (const a of await prisma.leadAssignment.findMany({ where: { leadId } })) {
    out.push({ at: a.assignedAt, kind: 'assignment', by: a.assignedBy ? users.get(a.assignedBy) : 'System', text: a.level === 'TEAM' ? `Given to ${teams.get(a.teamId)}` : `Assigned to ${users.get(a.userId!)}`, data: { reason: a.reason, overMax: a.overMax } })
    if (a.endedAt) out.push({ at: a.endedAt, kind: 'assignment', text: `${a.level === 'TEAM' ? teams.get(a.teamId) : users.get(a.userId!)}: ended (${a.endReason?.toLowerCase().replace('_', ' ')})` })
  }
  if (want('status')) for (const h of await prisma.statusHistory.findMany({ where: { leadId } })) out.push({ at: h.at, kind: 'status', by: users.get(h.byUserId), text: `${h.fromStatusId ? statuses.get(h.fromStatusId) + ' → ' : ''}${statuses.get(h.toStatusId)}${h.reopen ? ' (reopened)' : ''}`, data: { remarks: h.remarks } })
  if (want('calls')) {
    const outcomes = new Map((await prisma.callOutcome.findMany()).map((o) => [o.id, o.label]))
    for (const c of await prisma.callLog.findMany({ where: { leadId } })) out.push({ at: c.startedAt, kind: 'call', by: users.get(c.userId), text: `${c.channel === 'WHATSAPP' ? 'WhatsApp' : 'Call'}${c.outcomeId ? ': ' + outcomes.get(c.outcomeId) : ''}${c.durationSec ? ` · ${c.durationSec < 60 ? `${c.durationSec} sec` : `${Math.floor(c.durationSec / 60)} min ${c.durationSec % 60 ? `${c.durationSec % 60} sec` : ''}`.trim()}` : ''}`, data: { remarks: c.remarks } })
  }
  if (want('notes')) for (const r of await prisma.leadRemark.findMany({ where: { leadId } })) out.push({ at: r.at, kind: 'note', by: users.get(r.byUserId), text: r.body })
  if (want('followups')) for (const f of await prisma.followUp.findMany({ where: { leadId } })) out.push({ at: f.createdAt, kind: 'follow_up', by: users.get(f.userId), text: `${f.type[0] + f.type.slice(1).toLowerCase()} follow-up · ${f.state.toLowerCase()}`, data: { reason: f.reason, auto: f.auto, dueAt: f.dueAt, type: f.type, state: f.state } })
  if (want('payments')) for (const p of await prisma.finTransaction.findMany({ where: { leadId } })) out.push({ at: p.createdAt, kind: 'payment', by: users.get(p.recordedBy), text: `Payment ₹${(Number(p.amountPaise) / 100).toLocaleString('en-IN')} · ${p.state.toLowerCase()}` })
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Admin adds one lead by hand (goes to the company pool, same checks as an upload). */
leadsRouter.post('/', allow('ADMIN'), async (req, res) => {
  const b = parse(z.object({ name: z.string(), phone: z.string(), email: z.string().optional(), source: z.string().optional(), custom: z.record(z.string(), z.unknown()).optional() }), req.body)
  const s = await getSettings()
  const [fields, sources] = await Promise.all([prisma.customFieldDef.findMany(), prisma.leadSource.findMany()])
  const v = validateLead(b, { country: s.company.country, fields, sources })
  if (!v.ok) throw badRequest(v.errors.join('; '), v.errors)
  const dup = await findDuplicates(prisma, [{ phone: v.lead.phoneE164, email: v.lead.email }], s.leads.duplicateRule)
  if (dup.get(0)) throw conflict('This lead already exists', { existingLeadId: dup.get(0) })
  const rules = await activeRules()
  const lead = await prisma.lead.create({
    data: { name: v.lead.name, phoneE164: v.lead.phoneE164, email: v.lead.email, sourceId: v.lead.sourceId, custom: v.lead.custom as object, statusId: await newStatusId(), score: scoreOf(rules, { sourceName: v.lead.sourceName, statusKey: 'NEW', custom: v.lead.custom }) },
  })
  await audit(prisma, { actorId: me(req).id, action: 'LEAD_CREATE', entity: 'lead', entityId: lead.id, after: lead, ip: clientIp(req) })
  res.status(201).json(lead)
})

/** Edit fields. `version` must match: a second save over someone else's change is refused (§7.3 rule 6). */
leadsRouter.patch('/:id', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ version: z.number().int(), name: z.string().trim().min(1).max(120).optional(), email: z.string().trim().toLowerCase().email().nullable().optional(), sourceId: z.number().int().nullable().optional(), custom: z.record(z.string(), z.unknown()).optional(), phone: z.string().optional() }), req.body)
  const before = await assertLeadAccess(u, id)
  if (b.phone && u.role !== 'ADMIN') throw badRequest('Only Admin can change a phone number')
  const data: Prisma.LeadUncheckedUpdateManyInput = {}
  if (b.name) data.name = b.name
  if (b.email !== undefined) data.email = b.email
  if (b.sourceId !== undefined) data.sourceId = b.sourceId
  if (b.custom) {
    const fields = await prisma.customFieldDef.findMany({ where: { active: true } })
    const s = await getSettings()
    const v = validateLead({ name: before.name, phone: before.phoneE164, custom: { ...(before.custom as object), ...b.custom } }, { country: s.company.country, fields, sources: [] })
    if (!v.ok) throw badRequest(v.errors.join('; '), v.errors)
    data.custom = v.lead.custom as object
  }
  if (b.phone) {
    const s = await getSettings()
    const { normalizePhone } = await import('../../lib/phone.js')
    const p = normalizePhone(b.phone, s.company.country)
    if (!p) throw badRequest('Phone number is not valid')
    const other = await prisma.lead.findFirst({ where: { phoneE164: p, deletedAt: null, id: { not: id } } })
    if (other) throw conflict('Another lead has this number', { existingLeadId: other.id })
    data.phoneE164 = p
  }
  const r = await prisma.lead.updateMany({ where: { id, version: b.version }, data: { ...data, version: { increment: 1 } } })
  if (!r.count) throw await staleConflict(id)
  const after = await prisma.lead.findUniqueOrThrow({ where: { id } })
  await audit(prisma, { actorId: u.id, action: 'LEAD_UPDATE', entity: 'lead', entityId: id, before, after, ip: clientIp(req) })
  res.json({ ...after, phoneE164: undefined, phone: showPhone(u, after.phoneE164) })
})

/** "This lead was changed by Priya at 11:42, reload" */
export async function staleConflict(leadId: number) {
  const last = await prisma.auditLog.findFirst({ where: { entity: 'lead', entityId: String(leadId) }, orderBy: { at: 'desc' } })
  const who = last?.actorId ? (await prisma.user.findUnique({ where: { id: last.actorId }, select: { name: true } }))?.name : null
  return conflict(who ? `This lead was changed by ${who} at ${last!.at.toISOString()}. Reload and try again.` : 'This lead was changed by someone else. Reload and try again.', { changedBy: who, at: last?.at })
}

/** Full number for one Call / WhatsApp action, logged (§12.3). */
leadsRouter.post('/:id/reveal-phone', async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ purpose: z.enum(['CALL', 'WHATSAPP']).default('CALL') }), req.body ?? {})
  const lead = await assertLeadAccess(u, id)
  await audit(prisma, { actorId: u.id, action: 'PHONE_REVEAL', entity: 'lead', entityId: id, after: { purpose: b.purpose }, ip: clientIp(req) })
  res.json({ phone: lead.phoneE164, tel: `tel:${lead.phoneE164}`, whatsapp: `https://wa.me/${lead.phoneE164.replace('+', '')}` })
})

leadsRouter.delete('/:id', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null } })
  if (!lead) throw notFound('Lead')
  await tx(async (t) => {
    await t.lead.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: me(req).id, version: { increment: 1 } } })
    await t.followUp.updateMany({ where: { leadId: id, state: 'PENDING' }, data: { state: 'CANCELLED' } })
    await t.bulkAction.create({ data: { kind: 'DELETE', byUserId: me(req).id, leadCount: 1, before: [{ id }] } })
    await audit(t, { actorId: me(req).id, action: 'LEAD_DELETE', entity: 'lead', entityId: id, before: lead, ip: clientIp(req) })
  })
  res.json({ ok: true })
})

leadsRouter.post('/:id/restore', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: { not: null } } })
  if (!lead) throw notFound('Deleted lead')
  const { leads } = await getSettings()
  if (lead.deletedAt!.getTime() < Date.now() - leads.trashDays * 86_400_000) throw badRequest(`Leads can be restored for ${leads.trashDays} days only`)
  const clash = await prisma.lead.findFirst({ where: { phoneE164: lead.phoneE164, deletedAt: null } })
  if (clash) throw conflict('A live lead with this number exists now', { existingLeadId: clash.id })
  await prisma.lead.update({ where: { id }, data: { deletedAt: null, deletedBy: null, version: { increment: 1 } } })
  await audit(prisma, { actorId: me(req).id, action: 'LEAD_RESTORE', entity: 'lead', entityId: id, ip: clientIp(req) })
  res.json({ ok: true })
})
