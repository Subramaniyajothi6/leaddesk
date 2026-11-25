import { Router } from 'express'
import { z } from 'zod'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, conflict } from '../../lib/errors.js'
import { getSettings, updateSetting } from '../../lib/settings.js'
import { clearHolidayCache } from '../../lib/workdays.js'

/**
 * Everything Admin can change in the app (§13): settings groups, statuses and transitions,
 * call outcomes, sources, custom fields, message templates, scoring rules, limits, holidays, targets.
 */
export const configRouter = Router()

// ---------- settings ----------
configRouter.get('/settings', async (req, res) => {
  const s = await getSettings()
  if (me(req).role === 'ADMIN') return res.json(s)
  // Others get only what their screens need.
  res.json({ company: s.company, calls: s.calls, followUps: s.followUps, attendance: { shiftStart: s.attendance.shiftStart, shiftEnd: s.attendance.shiftEnd, weekOffs: s.attendance.weekOffs, captureLocation: s.attendance.captureLocation }, performance: { periodRule: s.performance.periodRule } })
})

configRouter.patch('/settings/:group', allow('ADMIN'), async (req, res) => {
  res.json(await updateSetting(String(req.params.group), req.body, me(req).id, clientIp(req) ?? undefined))
})

// ---------- statuses ----------
const statusBody = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/, 'Letters, digits and _').optional(),
  label: z.string().trim().min(1).max(60),
  category: z.enum(['OPEN', 'WON', 'LOST', 'EXCLUDED']),
  countsAsContact: z.boolean().default(false),
  needsFollowUp: z.boolean().default(false),
  remarksRequired: z.boolean().default(false),
  requiredFields: z.array(z.string()).default([]),
  followUpHours: z.number().int().min(1).nullable().optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
  order: z.number().int().optional(),
  active: z.boolean().default(true),
})

configRouter.get('/statuses', async (_req, res) => {
  const [statuses, transitions] = await Promise.all([prisma.status.findMany({ orderBy: { order: 'asc' } }), prisma.statusTransition.findMany()])
  res.json(statuses.map((s) => ({ ...s, next: transitions.filter((t) => t.fromStatusId === s.id).map((t) => t.toStatusId) })))
})

configRouter.post('/statuses', allow('ADMIN'), async (req, res) => {
  const b = parse(statusBody.required({ key: true }), req.body)
  if (await prisma.status.findUnique({ where: { key: b.key } })) throw conflict('A status with this key exists')
  const order = b.order ?? (await prisma.status.count())
  const s = await prisma.status.create({ data: { ...b, order } })
  await audit(prisma, { actorId: me(req).id, action: 'STATUS_CREATE', entity: 'status', entityId: s.id, after: s, ip: clientIp(req) })
  res.status(201).json(s)
})

/** The key and the NEW status's category are fixed: the system relies on them. */
configRouter.patch('/statuses/:id', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(statusBody.omit({ key: true }).partial(), req.body)
  const before = await prisma.status.findUnique({ where: { id } })
  if (!before) throw notFound('Status')
  if (before.key === 'NEW' && ((b.category && b.category !== 'OPEN') || b.active === false)) throw badRequest('The starting status New must stay open and active')
  const after = await prisma.status.update({ where: { id }, data: b })
  await audit(prisma, { actorId: me(req).id, action: 'STATUS_UPDATE', entity: 'status', entityId: id, before, after, ip: clientIp(req) })
  res.json(after)
})

/** Replace the allowed next statuses of one status. Empty list = any change allowed (§4.2). */
configRouter.put('/statuses/:id/next', allow('ADMIN'), async (req, res) => {
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ next: z.array(z.number().int().positive()) }), req.body)
  const before = (await prisma.statusTransition.findMany({ where: { fromStatusId: id } })).map((t) => t.toStatusId)
  await tx(async (t) => {
    await t.statusTransition.deleteMany({ where: { fromStatusId: id } })
    if (b.next.length) await t.statusTransition.createMany({ data: [...new Set(b.next)].map((to) => ({ fromStatusId: id, toStatusId: to })) })
    await audit(t, { actorId: me(req).id, action: 'STATUS_TRANSITIONS', entity: 'status', entityId: id, before, after: b.next, ip: clientIp(req) })
  })
  res.json({ ok: true })
})

// ---------- simple reference lists ----------
type Model = 'callOutcome' | 'leadSource' | 'messageTemplate' | 'scoringRule'
function crud(path: string, model: Model, schema: z.ZodObject, readRoles: ('ADMIN' | 'TEAM_LEAD' | 'BDE')[] = ['ADMIN', 'TEAM_LEAD', 'BDE']) {
  const m = () => (prisma as unknown as Record<Model, { findMany: Function; create: Function; update: Function; findUnique: Function }>)[model]
  configRouter.get(`/${path}`, allow(...readRoles), async (_req, res) => {
    res.json(await m().findMany({ orderBy: { id: 'asc' } }))
  })
  configRouter.post(`/${path}`, allow('ADMIN'), async (req, res) => {
    const b = parse(schema, req.body)
    try {
      const row = await m().create({ data: b })
      await audit(prisma, { actorId: me(req).id, action: `${model.toUpperCase()}_CREATE`, entity: model, entityId: row.id, after: row, ip: clientIp(req) })
      res.status(201).json(row)
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('This name already exists')
      throw e
    }
  })
  configRouter.patch(`/${path}/:id`, allow('ADMIN'), async (req, res) => {
    const id = parse(idParam, req.params.id)
    const b = parse(schema.partial(), req.body)
    const before = await m().findUnique({ where: { id } })
    if (!before) throw notFound()
    const after = await m().update({ where: { id }, data: b })
    await audit(prisma, { actorId: me(req).id, action: `${model.toUpperCase()}_UPDATE`, entity: model, entityId: id, before, after, ip: clientIp(req) })
    res.json(after)
  })
}

crud('call-outcomes', 'callOutcome', z.object({ label: z.string().trim().min(1), connected: z.boolean(), countsAsAttempt: z.boolean(), needsFollowUp: z.boolean(), order: z.number().int().default(0), active: z.boolean().default(true) }))
crud('sources', 'leadSource', z.object({ name: z.string().trim().min(1).max(80), active: z.boolean().default(true) }))
crud('templates', 'messageTemplate', z.object({ name: z.string().trim().min(1), channel: z.enum(['CALL', 'WHATSAPP']).default('WHATSAPP'), body: z.string().min(1).max(1000), active: z.boolean().default(true) }))
crud('scoring-rules', 'scoringRule', z.object({ field: z.string().min(1), operator: z.enum(['eq', 'gte', 'lte']), value: z.string(), points: z.number().int().min(-100).max(100), active: z.boolean().default(true) }), ['ADMIN'])

// ---------- custom fields ----------
const fieldBody = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'lower_case_key'),
  label: z.string().trim().min(1),
  type: z.enum(['text', 'number', 'date', 'select']),
  options: z.array(z.string()).nullable().optional(),
  required: z.boolean().default(false),
  showInList: z.boolean().default(false),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
})
configRouter.get('/custom-fields', async (_req, res) => res.json(await prisma.customFieldDef.findMany({ orderBy: { order: 'asc' } })))
configRouter.put('/custom-fields/:key', allow('ADMIN'), async (req, res) => {
  const b = parse(fieldBody, { ...req.body, key: req.params.key })
  if (b.type === 'select' && !b.options?.length) throw badRequest('A select field needs options')
  if (['name', 'phone', 'email', 'source'].includes(b.key)) throw badRequest('This key is a built-in field')
  const before = await prisma.customFieldDef.findUnique({ where: { key: b.key } })
  const data = { ...b, options: b.options ?? undefined }
  const after = await prisma.customFieldDef.upsert({ where: { key: b.key }, create: data, update: data })
  await audit(prisma, { actorId: me(req).id, action: 'CUSTOM_FIELD', entity: 'custom_field', entityId: b.key, before, after, ip: clientIp(req) })
  res.json(after)
})

// ---------- allocation limits (company / team / user) ----------
configRouter.get('/limits', allow('ADMIN', 'TEAM_LEAD'), async (_req, res) => res.json(await prisma.allocationLimit.findMany()))
configRouter.put('/limits', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const b = parse(z.object({ scope: z.enum(['TEAM', 'USER']), scopeId: z.number().int().positive(), maxOpen: z.number().int().min(1).nullable(), maxPerDay: z.number().int().min(1).nullable() }), req.body)
  const u = me(req)
  if (u.role === 'TEAM_LEAD') {
    // A Team Lead may set "Edit max" for BDEs of own teams only.
    if (b.scope !== 'USER') throw badRequest('Team Leads can only set a BDE max')
    const { ledTeamIds, teamOf } = await import('../../lib/access.js')
    const t = await teamOf(b.scopeId)
    if (!t || !(await ledTeamIds(u.id)).includes(t)) throw badRequest('This BDE is not in your team')
  }
  const before = await prisma.allocationLimit.findUnique({ where: { scope_scopeId: { scope: b.scope, scopeId: b.scopeId } } })
  const after = await prisma.allocationLimit.upsert({ where: { scope_scopeId: { scope: b.scope, scopeId: b.scopeId } }, create: b, update: { maxOpen: b.maxOpen, maxPerDay: b.maxPerDay } })
  await audit(prisma, { actorId: u.id, action: 'LIMIT_SET', entity: 'allocation_limit', entityId: `${b.scope}:${b.scopeId}`, before, after, ip: clientIp(req) })
  res.json(after)
})

// ---------- holidays ----------
configRouter.get('/holidays', async (_req, res) => res.json(await prisma.holiday.findMany({ orderBy: { date: 'asc' } })))
configRouter.put('/holidays/:date', allow('ADMIN'), async (req, res) => {
  const b = parse(z.object({ date: z.string().date(), name: z.string().trim().min(1) }), { ...req.body, date: req.params.date })
  const row = await prisma.holiday.upsert({ where: { date: new Date(b.date) }, create: { date: new Date(b.date), name: b.name }, update: { name: b.name } })
  clearHolidayCache()
  await audit(prisma, { actorId: me(req).id, action: 'HOLIDAY_SET', entity: 'holiday', entityId: b.date, after: row, ip: clientIp(req) })
  res.json(row)
})
configRouter.delete('/holidays/:date', allow('ADMIN'), async (req, res) => {
  const d = parse(z.string().date(), req.params.date)
  await prisma.holiday.delete({ where: { date: new Date(d) } }).catch(() => { throw notFound('Holiday') })
  clearHolidayCache()
  await audit(prisma, { actorId: me(req).id, action: 'HOLIDAY_DELETE', entity: 'holiday', entityId: d, ip: clientIp(req) })
  res.json({ ok: true })
})

// ---------- targets ----------
configRouter.get('/targets', allow('ADMIN', 'TEAM_LEAD'), async (_req, res) => res.json(await prisma.target.findMany({ orderBy: { fromDate: 'desc' } })))
configRouter.post('/targets', allow('ADMIN'), async (req, res) => {
  const b = parse(z.object({
    scope: z.enum(['COMPANY', 'TEAM', 'USER']), scopeId: z.number().int().min(0).default(0),
    metric: z.enum(['calls', 'contacts', 'conversions', 'conversion_pct', 'revenue']),
    period: z.enum(['DAY', 'WEEK', 'MONTH']), value: z.number().int().min(0), fromDate: z.string().date(),
  }), req.body)
  // conversion_pct is in basis points; revenue in paise. A new row from a date replaces the old target from then on.
  const row = await prisma.target.create({ data: { ...b, value: BigInt(b.value), fromDate: new Date(b.fromDate) } })
  await audit(prisma, { actorId: me(req).id, action: 'TARGET_SET', entity: 'target', entityId: row.id, after: row, ip: clientIp(req) })
  res.status(201).json(row)
})

// ---------- audit log (read only, Admin) ----------
configRouter.get('/audit', allow('ADMIN'), async (req, res) => {
  const q = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional(), actorId: z.coerce.number().optional(), action: z.string().optional(), from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }), req.query)
  const where = {
    ...(q.entity && { entity: q.entity }), ...(q.entityId && { entityId: q.entityId }), ...(q.actorId && { actorId: q.actorId }), ...(q.action && { action: q.action.includes(',') ? { in: q.action.split(',') } : q.action }), // one action, or a comma-separated group
    ...((q.from || q.to) && { at: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(new Date(q.to).getTime() + 86_400_000) }) } }),
  }
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), prisma.auditLog.count({ where })])
  // Names of the people involved, so the screen can show them without another request.
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.entity === 'user' && r.entityId ? Number(r.entityId) : null]).filter((x): x is number => !!x))]
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  res.json({ rows, names, total, page: q.page, pageSize: q.pageSize })
})
