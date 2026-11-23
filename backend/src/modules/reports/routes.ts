import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { parse } from '../../lib/validate.js'
import { me, clientIp, visibleTeamIds, assertLeadAccess, type AuthUser } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { forbidden, badRequest } from '../../lib/errors.js'
import { getSettings, type Settings } from '../../lib/settings.js'
import { localDate } from '../../lib/time.js'
import { formatInTimeZone } from 'date-fns-tz'
import { periodOf, perfRows, byKey, pct, callStats, followUpStats, funnel, type Period } from '../metrics/service.js'
import { monthOf } from '../attendance/routes.js'
import { timeline } from '../leads/routes.js'
import { send, type Table } from './render.js'

/** Reports and exports (§14). Every export uses the same metrics module as the screen, with a footer. */
export const reportsRouter = Router()

const q = z.object({
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  period: z.enum(['today', 'week', 'month']).optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  teamId: z.coerce.number().optional(), userId: z.coerce.number().optional(), sourceId: z.coerce.number().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), leadId: z.coerce.number().optional(), method: z.string().optional(),
})
type Q = z.infer<typeof q>

function footer(s: Settings, p: Period | null, q: Q, u: AuthUser) {
  const f = Object.entries(q).filter(([k, v]) => v != null && k !== 'format').map(([k, v]) => `${k}=${v}`).join(', ')
  return [
    `Filters: ${f || 'none'}`,
    ...(p ? [`Period: ${p.fromYmd} to ${p.toYmd} · ${p.rule === 'COHORT' ? `Cohort: leads assigned ${p.fromYmd} to ${p.toYmd}` : 'Activity: conversions that happened in the period ÷ leads assigned in the period'}`] : []),
    `Generated ${formatInTimeZone(new Date(), s.company.timeZone, 'yyyy-MM-dd HH:mm')} (${s.company.timeZone}) by ${u.name} · ${s.company.name}`,
  ]
}

/** Who may run / export what (§2, §14, settings `reports`). BDEs: own summary only, never lead contact data. */
async function scopeFor(u: AuthUser, qq: Q, format: string, s: Settings, kind: string) {
  if (format !== 'json') {
    if (u.role === 'TEAM_LEAD' && !s.reports.tlCanExport) throw forbidden('Exports are turned off for Team Leads')
    if (u.role === 'BDE' && (!s.reports.bdeCanExportSummary || !['performance', 'followups', 'attendance'].includes(kind))) throw forbidden('You can export only your own summary')
  }
  if (u.role === 'BDE') return { teamIds: null, userIds: [u.id] }
  const teams = await visibleTeamIds(u)
  if (qq.teamId && teams && !teams.includes(qq.teamId)) throw forbidden('Not your team')
  return { teamIds: qq.teamId ? [qq.teamId] : teams, userIds: qq.userId ? [qq.userId] : null }
}

const names = async (ids: number[]) => new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]))
const teamNames = async () => new Map((await prisma.team.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]))

const builders: Record<string, { roles: AuthUser['role'][]; build: (u: AuthUser, qq: Q, s: Settings, sc: { teamIds: number[] | null; userIds: number[] | null }) => Promise<{ t: Omit<Table, 'footer'>; p: Period | null }> }> = {
  /** Daily / weekly / monthly performance per BDE */
  performance: { roles: ['ADMIN', 'TEAM_LEAD', 'BDE'], build: async (_u, qq, s, sc) => {
    const p = periodOf(qq, s)
    const rows = await perfRows(p, sc)
    const calls = await callStats(p.from, p.to, sc)
    const fu = await followUpStats(p, sc, s)
    const per = byKey(rows, 'userId')
    const n = await names([...per.keys()])
    const teamOfUser = new Map(rows.map((r) => [r.userId, r.teamId]))
    const tn = await teamNames()
    return { p, t: { title: `Performance ${p.fromYmd} to ${p.toYmd}`, columns: [
      { key: 'bde', label: 'BDE' }, { key: 'team', label: 'Team' }, { key: 'counted', label: 'Counted leads', kind: 'int' }, { key: 'contacted', label: 'Contacted', kind: 'int' },
      { key: 'contactRate', label: 'Contact rate %', kind: 'pct' }, { key: 'conversions', label: 'Conversions', kind: 'int' }, { key: 'conversionPct', label: 'Conversion %', kind: 'pct' },
      { key: 'calls', label: 'Calls', kind: 'int' }, { key: 'talkMin', label: 'Talk time (min)', kind: 'int' }, { key: 'followUpPct', label: 'Follow-ups on time %', kind: 'pct' },
    ], rows: [...per].map(([id, v]) => { const f = fu.byUser.get(id); return { bde: n.get(id), team: tn.get(teamOfUser.get(id)!), counted: v.counted, contacted: v.contacted, contactRate: pct(v.contacted, v.counted), conversions: v.conversions, conversionPct: pct(v.conversions, v.counted), calls: calls.get(id)?.calls ?? 0, talkMin: calls.get(id)?.talkMin ?? 0, followUpPct: f ? pct(f.doneOnTime, f.due) : null } }).sort((a, b) => b.conversions - a.conversions) } }
  } },
  /** Allocation runs: who got how many, by method */
  allocation: { roles: ['ADMIN', 'TEAM_LEAD'], build: async (_u, qq, s, sc) => {
    const p = periodOf(qq, s)
    const runs = await prisma.allocationRun.findMany({ where: { createdAt: { gte: p.from, lt: p.to }, ...(sc.teamIds && { OR: [{ teamId: { in: sc.teamIds } }, { level: 'TEAM' }] }), ...(qq.method && { method: qq.method as never }) }, orderBy: { createdAt: 'desc' }, include: { assignments: { select: { userId: true, teamId: true } } } })
    const n = await names([...new Set(runs.flatMap((r) => [r.startedBy ?? 0, ...r.assignments.map((a) => a.userId ?? 0)]))])
    const tn = await teamNames()
    const rows = runs.flatMap((r) => {
      const groups = new Map<string, number>()
      for (const a of r.assignments) { if (sc.teamIds && !sc.teamIds.includes(a.teamId)) continue; const k = a.userId ? n.get(a.userId)! : tn.get(a.teamId)!; groups.set(k, (groups.get(k) ?? 0) + 1) }
      return [...groups].map(([to, count]) => ({ at: r.createdAt.toISOString().slice(0, 16).replace('T', ' '), level: r.level, method: r.method, by: r.startedBy ? n.get(r.startedBy) : 'System', to, count }))
    })
    return { p, t: { title: `Allocation ${p.fromYmd} to ${p.toYmd}`, columns: [{ key: 'at', label: 'When (UTC)' }, { key: 'level', label: 'Level' }, { key: 'method', label: 'Method' }, { key: 'by', label: 'By' }, { key: 'to', label: 'Given to' }, { key: 'count', label: 'Leads', kind: 'int' }], rows } }
  } },
  /** Lead status breakdown + funnel */
  status: { roles: ['ADMIN', 'TEAM_LEAD'], build: async (_u, qq, s, sc) => {
    const p = periodOf(qq, s)
    const g = await prisma.lead.groupBy({ by: ['statusId'], where: { deletedAt: null, ...(sc.teamIds && { teamId: { in: sc.teamIds } }), ...(qq.sourceId && { sourceId: qq.sourceId }), createdAt: { lt: p.to } }, _count: true })
    const st = await prisma.status.findMany({ orderBy: { order: 'asc' } })
    const total = g.reduce((a, x) => a + x._count, 0)
    const f = await funnel(p, sc)
    return { p, t: { title: `Lead status ${p.toYmd}`, columns: [{ key: 'section', label: 'Section' }, { key: 'label', label: 'Status / step' }, { key: 'count', label: 'Leads', kind: 'int' }, { key: 'share', label: '% of total / kept %', kind: 'pct' }], rows: [
      ...st.map((x) => { const c = g.find((y) => y.statusId === x.id)?._count ?? 0; return { section: 'Status now', label: x.label, count: c, share: pct(c, total) } }),
      ...f.map((x) => ({ section: 'Funnel (leads given out in period)', label: x.label + (x.biggestLoss ? ' (biggest loss)' : ''), count: x.count, share: x.keptPct })),
    ] } }
  } },
  /** Follow-ups done / due / overdue per BDE */
  followups: { roles: ['ADMIN', 'TEAM_LEAD', 'BDE'], build: async (_u, qq, s, sc) => {
    const p = periodOf(qq, s)
    const fu = await followUpStats(p, sc, s)
    const n = await names([...fu.byUser.keys()])
    return { p, t: { title: `Follow-ups ${p.fromYmd} to ${p.toYmd}`, columns: [{ key: 'bde', label: 'Owner' }, { key: 'due', label: 'Due in period', kind: 'int' }, { key: 'done', label: 'Done on time', kind: 'int' }, { key: 'pct', label: 'Completion %', kind: 'pct' }, { key: 'dueToday', label: 'Due today', kind: 'int' }, { key: 'overdue', label: 'Overdue now', kind: 'int' }],
      rows: [...fu.byUser].map(([id, v]) => ({ bde: n.get(id), due: v.due, done: v.doneOnTime, pct: pct(v.doneOnTime, v.due), dueToday: v.dueToday, overdue: v.overdue })) } }
  } },
  /** Attendance month */
  attendance: { roles: ['ADMIN', 'TEAM_LEAD', 'BDE'], build: async (_u, qq, s, sc) => {
    const month = qq.month ?? localDate(new Date(), s.company.timeZone).slice(0, 7)
    const ids = sc.userIds ?? (await prisma.teamMembership.findMany({ where: { toAt: null, ...(sc.teamIds && { teamId: { in: sc.teamIds } }) }, select: { userId: true } })).map((m) => m.userId)
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } })
    const rows = []
    for (const x of users) { const m = await monthOf(x, month, s); rows.push({ name: x.name, ...m.summary, attendancePct: m.summary.attendanceBp == null ? null : m.summary.attendanceBp / 100 }) }
    return { p: null, t: { title: `Attendance ${month}`, columns: [{ key: 'name', label: 'Name' }, { key: 'present', label: 'Present', kind: 'int' }, { key: 'halfDay', label: 'Half day', kind: 'int' }, { key: 'absent', label: 'Absent', kind: 'int' }, { key: 'leave', label: 'Leave', kind: 'int' }, { key: 'late', label: 'Late', kind: 'int' }, { key: 'earlyOut', label: 'Early out', kind: 'int' }, { key: 'missingPunchOut', label: 'Missing punch-out', kind: 'int' }, { key: 'attendancePct', label: 'Attendance %', kind: 'pct' }], rows } }
  } },
  /** Conversion by source and upload batch */
  sources: { roles: ['ADMIN'], build: async (_u, qq, s) => {
    const p = periodOf(qq, s)
    const rows = await prisma.$queryRaw<{ source: string | null; batch: string | null; counted: bigint; conversions: bigint }[]>`
      WITH c AS (SELECT DISTINCT a.lead_id FROM lead_assignments a WHERE a.level = 'BDE' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to})
      SELECT ls.name AS source, b.file_name AS batch, COUNT(DISTINCT l.id) AS counted,
        COUNT(DISTINCT l.id) FILTER (WHERE EXISTS (SELECT 1 FROM status_history h JOIN statuses st ON st.id = h.to_status_id WHERE h.lead_id = l.id AND st.category = 'WON')) AS conversions
      FROM c JOIN leads l ON l.id = c.lead_id JOIN statuses s2 ON s2.id = l.status_id LEFT JOIN lead_sources ls ON ls.id = l.source_id LEFT JOIN import_batches b ON b.id = l.batch_id
      WHERE s2.category <> 'EXCLUDED' GROUP BY ls.name, b.file_name ORDER BY 3 DESC`
    return { p, t: { title: `Conversion by source ${p.fromYmd} to ${p.toYmd}`, columns: [{ key: 'source', label: 'Source' }, { key: 'batch', label: 'Upload' }, { key: 'counted', label: 'Counted leads', kind: 'int' }, { key: 'conversions', label: 'Conversions', kind: 'int' }, { key: 'pct', label: 'Conversion %', kind: 'pct' }],
      rows: rows.map((r) => ({ source: r.source ?? 'No source', batch: r.batch ?? 'Added by hand', counted: Number(r.counted), conversions: Number(r.conversions), pct: pct(Number(r.conversions), Number(r.counted)) })) } }
  } },
  /** One lead's full history (assignments, status, calls, notes, payments) */
  'lead-history': { roles: ['ADMIN', 'TEAM_LEAD'], build: async (u, qq) => {
    if (!qq.leadId) throw badRequest('Pick a lead (leadId)')
    const lead = await assertLeadAccess(u, qq.leadId)
    const tl = await timeline(lead.id)
    return { p: null, t: { title: `Lead history ${lead.name}`, columns: [{ key: 'at', label: 'When (UTC)' }, { key: 'kind', label: 'What' }, { key: 'by', label: 'By' }, { key: 'text', label: 'Details' }], rows: tl.map((x) => ({ at: x.at.toISOString().slice(0, 16).replace('T', ' '), kind: x.kind, by: x.by ?? '', text: x.text })) } }
  } },
  /** Finance transactions */
  finance: { roles: ['ADMIN'], build: async (_u, qq, s) => {
    const p = periodOf(qq, s)
    const rows = await prisma.finTransaction.findMany({ where: { receivedOn: { gte: new Date(p.fromYmd), lte: new Date(p.toYmd) }, ...(qq.teamId && { teamId: qq.teamId }) }, orderBy: { receivedOn: 'asc' }, include: { lead: { select: { name: true } } } })
    const tn = await teamNames()
    return { p, t: { title: `Finance ${p.fromYmd} to ${p.toYmd}`, columns: [{ key: 'date', label: 'Received on' }, { key: 'kind', label: 'Kind' }, { key: 'state', label: 'State' }, { key: 'lead', label: 'Lead' }, { key: 'team', label: 'Team' }, { key: 'amount', label: 'Amount (Rs)', kind: 'money' }, { key: 'sharePct', label: 'Company %', kind: 'pct' }, { key: 'share', label: 'Company share (Rs)', kind: 'money' }, { key: 'remaining', label: 'Remaining (Rs)', kind: 'money' }],
      rows: rows.map((r) => ({ date: r.receivedOn.toISOString().slice(0, 10), kind: r.kind, state: r.state, lead: r.lead?.name ?? '', team: r.teamId ? tn.get(r.teamId) : '', amount: r.amountPaise, sharePct: r.companyShareBp == null ? null : r.companyShareBp / 100, share: r.companySharePaise, remaining: r.remainingPaise })) } }
  } },
}

reportsRouter.get('/', (req, res) => {
  const role = me(req).role
  res.json(Object.entries(builders).filter(([, b]) => b.roles.includes(role)).map(([k]) => k))
})

reportsRouter.get('/:kind', async (req, res) => {
  const u = me(req)
  const kind = String(req.params.kind)
  const b = builders[kind]
  if (!b) throw badRequest('Unknown report')
  if (!b.roles.includes(u.role)) throw forbidden('This report is not available for your role')
  const qq = parse(q, req.query)
  const s = await getSettings()
  const sc = await scopeFor(u, qq, qq.format, s, kind)
  const { t, p } = await b.build(u, qq, s, sc)
  if (qq.format !== 'json') await audit(prisma, { actorId: u.id, action: 'EXPORT', entity: 'report', entityId: kind, after: { format: qq.format, filters: qq }, ip: clientIp(req) })
  await send(res, { ...t, footer: footer(s, p, qq, u) }, qq.format)
})
