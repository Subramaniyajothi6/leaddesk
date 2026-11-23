import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { parse } from '../../lib/validate.js'
import { allow, me, ledTeamIds, teamOf, assertTeamAccess } from '../../lib/access.js'
import { forbidden } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { localDate, dayBounds, dateOnly, addDaysYmd, localMinutes, minutesOf } from '../../lib/time.js'
import { openStatusIds } from '../../lib/statuses.js'
import { freshCounts, limitsFor, openCounts, dayInfo } from '../allocation/service.js'
import { periodOf, conversion, speedToFirstCall, untouched, funnel, followUpStats, callStats, targetFor, revenue, pct, byKey, perfRows, type Period } from './service.js'

export const dashboardRouter = Router()

const periodQuery = z.object({ period: z.enum(['today', 'week', 'month']).optional(), from: z.string().date().optional(), to: z.string().date().optional(), teamId: z.coerce.number().optional() })
const targetPeriod = (p: Period) => (p.label === 'Today' ? 'DAY' : p.label === 'This week' ? 'WEEK' : 'MONTH') as 'DAY' | 'WEEK' | 'MONTH'

/** Conversions per week for the last 8 weeks (one trend line). */
async function weeklyTrend(sc: { teamIds?: number[] | null; userIds?: number[] | null }) {
  const s = await getSettings()
  const today = localDate(new Date(), s.company.timeZone)
  const out = []
  for (let i = 7; i >= 0; i--) {
    const fromYmd = addDaysYmd(today, -7 * i - 6)
    const toYmd = addDaysYmd(today, -7 * i)
    const from = dayBounds(fromYmd, s.company.timeZone).start
    const to = dayBounds(toYmd, s.company.timeZone).end
    const rows = await perfRows({ from, to, rule: 'ACTIVITY' }, sc)
    out.push({ weekEnding: toYmd, conversions: rows.reduce((a, r) => a + r.conversions, 0) })
  }
  return out
}

/** Calls made today so far vs the average by this time on the last 5 working days ("usual by now"). */
async function callsVsUsual(sc: { teamIds?: number[] | null; userIds?: number[] | null }) {
  const s = await getSettings()
  const tz = s.company.timeZone
  const now = new Date()
  const today = localDate(now, tz)
  const { start } = dayBounds(today, tz)
  const sinceStart = now.getTime() - start.getTime()
  const todayCalls = [...(await callStats(start, now, sc)).values()].reduce((a, v) => a + v.calls, 0)
  let sum = 0, days = 0
  for (let i = 1; i <= 10 && days < 5; i++) {
    const d = addDaysYmd(today, -i)
    if (s.attendance.weekOffs.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) continue
    const ds = dayBounds(d, tz).start
    sum += [...(await callStats(ds, new Date(ds.getTime() + sinceStart), sc)).values()].reduce((a, v) => a + v.calls, 0)
    days++
  }
  return { today: todayCalls, usualByNow: days ? Math.round(sum / days) : null }
}

// ---------------------------------------------------------------- Admin

dashboardRouter.get('/dashboard/admin', allow('ADMIN'), async (req, res) => {
  const q = parse(periodQuery, req.query)
  const s = await getSettings()
  const p = periodOf(q, s)
  const sc = { teamIds: q.teamId ? [q.teamId] : null }
  const now = new Date()
  const tz = s.company.timeZone
  const todayYmd = localDate(now, tz)
  const open = await openStatusIds()

  const [teams, conv, speed, untouchedR, fu, fun, rev, revPrev, poolCompany, bdeCounts] = await Promise.all([
    prisma.team.findMany({ where: { state: 'ACTIVE' }, orderBy: { name: 'asc' }, include: { leadLinks: { where: { toAt: null }, include: { user: { select: { id: true, name: true, state: true } } } }, memberships: { where: { toAt: null }, include: { user: { select: { id: true, state: true, role: true } } } } } }),
    conversion(p, sc), speedToFirstCall(p, sc), untouched(sc), followUpStats(p, sc, s), funnel(p, sc),
    revenue(p, sc), revenue({ fromYmd: localDate(p.prevFrom, tz), toYmd: localDate(new Date(p.prevTo.getTime() - 1), tz) }, sc),
    prisma.lead.count({ where: { teamId: null, deletedAt: null, statusId: { in: open } } }),
    prisma.user.groupBy({ by: ['state'], where: { role: 'BDE' }, _count: true }),
  ])

  // ---- Waiting on you (each with its fix) ----
  const actions: { kind: string; title: string; detail: string; action: string; link: string }[] = []
  for (const t of teams) {
    const bdes = t.memberships.filter((m) => m.user.role === 'BDE' && m.user.state === 'ACTIVE').map((m) => m.userId)
    const pool = await prisma.lead.count({ where: { teamId: t.id, ownerId: null, deletedAt: null, statusId: { in: open } } })
    const fresh = await freshCounts(prisma, bdes)
    const empty = bdes.filter((id) => (fresh.get(id) ?? 0) <= s.allocation.lowLeadMark).length
    if (bdes.length && empty && pool === 0) actions.push({ kind: 'LEAD_REQUEST', title: `${t.name} needs leads`, detail: `${empty} BDE(s) at 0 fresh leads · team pool 0 · company pool ${poolCompany}`, action: 'Allocate leads', link: `/allocation/teams?teamId=${t.id}` })
    if (!t.leadLinks.some((l) => l.user.state === 'ACTIVE')) actions.push({ kind: 'NO_TEAM_LEAD', title: `${t.name} has no Team Lead`, detail: 'You are acting as Team Lead', action: 'Assign Team Lead', link: `/teams/${t.id}` })
  }
  const pendingPay = await prisma.finTransaction.aggregate({ where: { state: 'PENDING', kind: 'REVENUE' }, _count: true, _sum: { amountPaise: true } })
  if (pendingPay._count) actions.push({ kind: 'PAYMENTS', title: `${pendingPay._count} payment(s) to confirm`, detail: `Recorded by Team Leads · ₹${(Number(pendingPay._sum.amountPaise ?? 0) / 100).toLocaleString('en-IN')}`, action: 'Review', link: '/finance/transactions?state=PENDING' })
  const corrections = await prisma.attendanceCorrection.count({ where: { state: 'PENDING' } })
  if (corrections) actions.push({ kind: 'CORRECTIONS', title: `${corrections} attendance correction(s)`, detail: 'Waiting for approval', action: 'Review', link: '/attendance/corrections' })
  const unpaid = await convertedUnpaid(s.finance.unpaidReminderDays, null)
  if (unpaid.length) actions.push({ kind: 'UNPAID', title: `${unpaid.length} converted, no payment yet`, detail: `Converted more than ${s.finance.unpaidReminderDays} days ago`, action: 'Open list', link: '/finance/unpaid' })
  const unattended = await prisma.lead.count({ where: { deletedAt: null, statusId: { in: open }, owner: { state: { not: 'ACTIVE' } } } })
  if (unattended) actions.push({ kind: 'UNATTENDED', title: `${unattended} lead(s) with nobody`, detail: 'Their BDE is inactive', action: 'Reassign', link: '/leads?unattended=true' })

  // ---- setup checklist until finished (§15.1 #8) ----
  const [teamCount, bdeTotal, leadTotal, targetCount] = await Promise.all([prisma.team.count(), prisma.user.count({ where: { role: 'BDE' } }), prisma.lead.count(), prisma.target.count()])
  const checklist = [
    { key: 'company', label: 'Company details', done: s.company.name !== 'My Company', minutes: 2 },
    { key: 'statuses', label: 'Lead statuses', done: true, minutes: 5 },
    { key: 'teams', label: 'Create teams', done: teamCount > 0, minutes: 3 },
    { key: 'people', label: 'Add Team Leads and BDEs', done: bdeTotal > 0, minutes: 10 },
    { key: 'upload', label: 'Upload your first leads', done: leadTotal > 0, minutes: 5 },
    { key: 'targets', label: 'Set monthly targets', done: targetCount > 0, minutes: 5 },
  ]

  // ---- numbers vs target / last period ----
  const tp = targetPeriod(p)
  const [tConv, tPct, tRev] = await Promise.all([targetFor('COMPANY', 0, 'conversions', tp, p.from), targetFor('COMPANY', 0, 'conversion_pct', tp, p.from), targetFor('COMPANY', 0, 'revenue', tp, p.from)])
  const kpis = {
    conversions: { value: conv.conversions, target: tConv, prev: conv.prev.conversions },
    conversionPct: { value: conv.pct, targetPct: tPct == null ? null : tPct / 100, prev: conv.prev.pct, counted: conv.counted, rule: p.rule },
    revenuePaise: { value: rev.confirmedPaise, target: tRev, prev: revPrev.confirmedPaise, pendingPaise: rev.pendingPaise },
    speedToFirstCallMin: { value: speed.avgMin },
    untouchedLeads: { value: untouchedR.total },
    overdueFollowUps: { value: fu.total.overdue, followUpCompletionPct: fu.total.completionPct },
  }

  // ---- breakdowns ----
  const byTeam = byKey(conv.rows, 'teamId')
  const presentRows = await prisma.attendance.findMany({ where: { workDate: dateOnly(todayYmd), punchInAt: { not: null } }, select: { userId: true, late: true } })
  const present = new Set(presentRows.map((r) => r.userId))
  const teamRows = []
  for (const t of teams) {
    const v = byTeam.get(t.id) ?? { counted: 0, conversions: 0, contacted: 0 }
    const bdes = t.memberships.filter((m) => m.user.role === 'BDE' && m.user.state === 'ACTIVE').map((m) => m.userId)
    teamRows.push({
      teamId: t.id, team: t.name, teamLead: t.leadLinks.find((l) => l.user.state === 'ACTIVE')?.user.name ?? null, bdes: bdes.length,
      counted: v.counted, conversions: v.conversions, conversionPct: pct(v.conversions, v.counted),
      inTeamPool: await prisma.lead.count({ where: { teamId: t.id, ownerId: null, deletedAt: null, statusId: { in: open } } }),
      freshWithBdes: [...(await freshCounts(prisma, bdes)).values()].reduce((a, b) => a + b, 0),
      speedToFirstCallMin: speed.byTeam.get(t.id) ?? null, untouched: untouchedR.byTeam.get(t.id) ?? 0,
      overdueFollowUps: bdes.reduce((a, id) => a + (fu.byUser.get(id)?.overdue ?? 0), 0),
      presentToday: `${bdes.filter((id) => present.has(id)).length}/${bdes.length}`,
    })
  }
  const tlMap = new Map<number, { name: string; teams: string[]; counted: number; conversions: number }>()
  for (const t of teams) for (const l of t.leadLinks.filter((x) => x.user.state === 'ACTIVE')) {
    const v = byTeam.get(t.id) ?? { counted: 0, conversions: 0 }
    const e = tlMap.get(l.user.id) ?? { name: l.user.name, teams: [], counted: 0, conversions: 0 }
    e.teams.push(t.name); e.counted += v.counted; e.conversions += v.conversions
    tlMap.set(l.user.id, e)
  }
  const sources = await prisma.$queryRaw<{ source: string | null; counted: bigint; conversions: bigint }[]>`
    WITH c AS (SELECT DISTINCT a.lead_id FROM lead_assignments a WHERE a.level = 'BDE' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to})
    SELECT ls.name AS source, COUNT(DISTINCT l.id) AS counted,
      COUNT(DISTINCT l.id) FILTER (WHERE EXISTS (SELECT 1 FROM status_history h JOIN statuses st ON st.id = h.to_status_id WHERE h.lead_id = l.id AND st.category = 'WON')) AS conversions
    FROM c JOIN leads l ON l.id = c.lead_id LEFT JOIN lead_sources ls ON ls.id = l.source_id JOIN statuses s2 ON s2.id = l.status_id
    WHERE s2.category <> 'EXCLUDED' GROUP BY ls.name ORDER BY counted DESC`
  const bdeRank = [...byKey(conv.rows, 'userId')].map(([userId, v]) => ({ userId, ...v, pct: pct(v.conversions, v.counted) }))
  const names = new Map((await prisma.user.findMany({ where: { id: { in: bdeRank.map((b) => b.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const ranked = bdeRank.map((b) => ({ ...b, name: names.get(b.userId) })).sort((a, b) => b.conversions - a.conversions || (b.pct ?? 0) - (a.pct ?? 0))

  res.json({
    period: { label: p.label, from: p.fromYmd, to: p.toYmd, rule: p.rule },
    setup: checklist.every((c) => c.done) ? null : { done: checklist.filter((c) => c.done).length, total: checklist.length, items: checklist },
    actions,
    kpis,
    counts: { companyPool: poolCompany, bdesActive: bdeCounts.find((b) => b.state === 'ACTIVE')?._count ?? 0, bdesInactive: bdeCounts.find((b) => b.state === 'INACTIVE')?._count ?? 0 },
    funnel: fun,
    teams: teamRows,
    teamLeads: [...tlMap].map(([id, v]) => ({ userId: id, name: v.name, teams: v.teams, conversionPct: pct(v.conversions, v.counted), conversions: v.conversions })),
    sources: sources.map((x) => ({ source: x.source ?? 'No source', counted: Number(x.counted), conversions: Number(x.conversions), conversionPct: pct(Number(x.conversions), Number(x.counted)) })),
    bdes: { top: ranked.slice(0, 3), needsAttention: [...ranked].filter((b) => b.counted >= 5).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 3) },
    trend: await weeklyTrend(sc),
    today: { presentCount: present.size, late: presentRows.filter((r) => r.late).length, ...(await callsVsUsual(sc)) },
  })
})

/** Converted (WON) leads with no confirmed payment after N days (§11.3). */
export async function convertedUnpaid(days: number, teamIds: number[] | null) {
  const before = new Date(Date.now() - days * 86_400_000)
  return prisma.lead.findMany({
    where: { deletedAt: null, status: { category: 'WON' }, statusChangedAt: { lt: before }, transactions: { none: { state: { in: ['CONFIRMED', 'PENDING'] } } }, ...(teamIds && { teamId: { in: teamIds } }) },
    select: { id: true, name: true, teamId: true, ownerId: true, statusChangedAt: true }, orderBy: { statusChangedAt: 'asc' },
  })
}

// ---------------------------------------------------------------- Team Lead

dashboardRouter.get('/dashboard/team', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const q = parse(periodQuery, req.query)
  const mine = u.role === 'TEAM_LEAD' ? await ledTeamIds(u.id) : null
  const teamId = q.teamId ?? mine?.[0]
  if (!teamId) throw forbidden('You do not lead a team yet')
  await assertTeamAccess(u, teamId)
  const s = await getSettings()
  const p = periodOf(q, s)
  const sc = { teamIds: [teamId] }
  const tz = s.company.timeZone
  const todayYmd = localDate(new Date(), tz)
  const { start: dayStart } = dayBounds(todayYmd, tz)
  const open = await openStatusIds()
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, include: { memberships: { where: { toAt: null }, include: { user: true } } } })
  const bdes = team.memberships.map((m) => m.user).filter((x) => x.role === 'BDE')
  const ids = bdes.map((b) => b.id)

  const [conv, speed, unt, fu, fun, limits, openN, fresh, callsToday, att, leave] = await Promise.all([
    conversion(p, sc), speedToFirstCall(p, sc), untouched(sc), followUpStats(p, sc, s), funnel(p, sc),
    limitsFor(prisma, teamId, ids, s), openCounts(prisma, ids), freshCounts(prisma, ids), callStats(dayStart, new Date(), { userIds: ids }),
    prisma.attendance.findMany({ where: { userId: { in: ids }, workDate: dateOnly(todayYmd) } }),
    prisma.timeOff.findMany({ where: { userId: { in: ids }, fromDate: { lte: dateOnly(todayYmd) }, toDate: { gte: dateOnly(todayYmd) } } }),
  ])
  const pool = await prisma.lead.count({ where: { teamId, ownerId: null, deletedAt: null, statusId: { in: open } } })
  const day = await dayInfo(prisma, s)
  const offDay = !!day.holiday || day.weekOff // nobody is "not in" on a holiday or week-off
  // Before the absent cut-off (shift start + N min) nobody is absent yet, just not in yet (§6, §10.2).
  const pastCutoff = localMinutes(new Date(), tz) > minutesOf(s.attendance.shiftStart) + s.attendance.absentCutoffMin
  const byUser = byKey(conv.rows, 'userId')
  const teamPct = conv.pct

  const rows = bdes.map((b) => {
    const v = byUser.get(b.id) ?? { counted: 0, conversions: 0, contacted: 0 }
    const a = att.find((x) => x.userId === b.id)
    const lim = limits.get(b.id)!
    const c = callsToday.get(b.id) ?? { calls: 0, connected: 0, talkMin: 0 }
    const f = fu.byUser.get(b.id) ?? { dueToday: 0, overdue: 0, due: 0, doneOnTime: 0 }
    const bpct = pct(v.conversions, v.counted)
    const status = b.state !== 'ACTIVE' ? b.state : leave.some((l) => l.userId === b.id) ? 'LEAVE' : a?.punchOutAt ? 'OUT' : a?.punchInAt ? (a.late ? 'LATE' : 'IN') : offDay ? 'OFF' : pastCutoff ? 'NOT_IN' : 'NOT_YET'
    const flags = [
      status === 'NOT_IN' && f.dueToday ? 'absent_with_follow_ups' : null,
      b.state === 'INACTIVE' && (openN.get(b.id) ?? 0) ? 'inactive_with_leads' : null,
      (fresh.get(b.id) ?? 0) <= s.allocation.lowLeadMark + 2 && b.state === 'ACTIVE' ? 'needs_leads' : null,
      f.overdue >= 3 ? 'overdue' : null, (openN.get(b.id) ?? 0) >= lim.max ? 'at_max' : null, (unt.byUser.get(b.id) ?? 0) > 0 ? 'untouched' : null,
    ].filter(Boolean)
    return {
      userId: b.id, name: b.name, state: b.state, today: { status, punchInAt: a?.punchInAt ?? null, late: a?.late ?? false },
      load: { open: openN.get(b.id) ?? 0, max: lim.max, left: Math.max(0, lim.max - (openN.get(b.id) ?? 0)) }, fresh: fresh.get(b.id) ?? 0,
      callsToday: c.calls, connectedPct: pct(c.connected, c.calls), talkMinToday: c.talkMin,
      followUps: { dueToday: f.dueToday, overdue: f.overdue }, counted: v.counted, conversions: v.conversions, conversionPct: bpct,
      vsTeam: bpct == null || teamPct == null ? null : bpct >= teamPct ? 'above' : 'below',
      speedToFirstCallMin: speed.byUser.get(b.id) ?? null, untouched: unt.byUser.get(b.id) ?? 0, flags,
    }
  }).sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))

  const actions = [
    ...rows.filter((r) => r.flags.includes('needs_leads')).map((r) => ({ kind: 'NEEDS_LEADS', userId: r.userId, title: `${r.name} needs leads`, detail: `${r.fresh} fresh left · team pool ${pool}`, action: pool ? 'Give 20' : 'Ask Admin' })),
    ...rows.filter((r) => r.flags.includes('absent_with_follow_ups')).map((r) => ({ kind: 'ABSENT', userId: r.userId, title: `${r.name} is not in today`, detail: `${r.followUps.dueToday} follow-ups due today`, action: 'Reassign' })),
    ...rows.filter((r) => r.flags.includes('inactive_with_leads')).map((r) => ({ kind: 'UNATTENDED', userId: r.userId, title: `${r.load.open} leads with nobody`, detail: `${r.name} is inactive`, action: 'Reassign' })),
    ...rows.filter((r) => r.flags.includes('overdue')).map((r) => ({ kind: 'OVERDUE', userId: r.userId, title: `${r.name} has ${r.followUps.overdue} overdue follow-ups`, detail: r.flags.includes('at_max') ? `Also at max (${r.load.open}/${r.load.max})` : '', action: 'Open leads' })),
  ]
  const unpaid = await convertedUnpaid(s.finance.unpaidReminderDays, [teamId])
  if (unpaid.length && s.finance.tlCanRecordPayments) actions.push({ kind: 'UNPAID', userId: 0, title: `${unpaid.length} converted, payment not recorded`, detail: `Converted more than ${s.finance.unpaidReminderDays} days ago`, action: 'Record payment' })
  const corr = await prisma.attendanceCorrection.count({ where: { state: 'PENDING', attendance: { userId: { in: ids } } } })
  if (corr && s.attendance.tlCanCorrect) actions.push({ kind: 'CORRECTIONS', userId: 0, title: `${corr} attendance correction(s)`, detail: 'From your team', action: 'Review' })

  // team rank among teams (the only company-wide number a Team Lead sees)
  const allTeams = byKey(await perfRows(p, {}), 'teamId')
  const ranking = [...allTeams].map(([id, v]) => ({ id, pct: pct(v.conversions, v.counted) ?? 0 })).sort((a, b) => b.pct - a.pct)
  const rank = ranking.findIndex((r) => r.id === teamId) + 1

  const tp = targetPeriod(p)
  res.json({
    period: { label: p.label, from: p.fromYmd, to: p.toYmd, rule: p.rule },
    team: { id: team.id, name: team.name, autoDistribute: team.autoDistribute, method: team.method, rank: rank || null, teamsRanked: ranking.length, pool },
    actions,
    kpis: {
      conversions: { value: conv.conversions, target: await targetFor('TEAM', teamId, 'conversions', tp, p.from), prev: conv.prev.conversions },
      conversionPct: { value: conv.pct, prev: conv.prev.pct, counted: conv.counted, rule: p.rule },
      speedToFirstCallMin: { value: speed.avgMin }, untouchedLeads: { value: unt.total },
      overdueFollowUps: { value: fu.total.overdue, completionPct: fu.total.completionPct }, teamPool: { value: pool },
    },
    received: await prisma.leadAssignment.count({ where: { level: 'TEAM', teamId, assignedAt: { gte: p.from, lt: p.to } } }),
    distributed: await prisma.leadAssignment.count({ where: { level: 'BDE', teamId, assignedAt: { gte: p.from, lt: p.to } } }),
    bdes: rows,
    totals: { open: rows.reduce((a, r) => a + r.load.open, 0), max: rows.reduce((a, r) => a + r.load.max, 0), fresh: rows.reduce((a, r) => a + r.fresh, 0), callsToday: rows.reduce((a, r) => a + r.callsToday, 0), dueToday: rows.reduce((a, r) => a + r.followUps.dueToday, 0), overdue: rows.reduce((a, r) => a + r.followUps.overdue, 0), counted: conv.counted, conversions: conv.conversions, conversionPct: conv.pct },
    funnel: fun,
    trend: await weeklyTrend(sc),
    today: { offDay: offDay ? (day.holiday ?? 'Week-off') : null, present: rows.filter((r) => ['IN', 'LATE', 'OUT'].includes(r.today.status)).length, total: rows.filter((r) => r.state === 'ACTIVE').length, absent: rows.filter((r) => r.today.status === 'NOT_IN').length, late: rows.filter((r) => r.today.late).length, ...(await callsVsUsual({ userIds: ids })) },
  })
})

// ---------------------------------------------------------------- BDE

dashboardRouter.get('/dashboard/bde', allow('BDE'), async (req, res) => {
  const u = me(req)
  const q = parse(periodQuery, req.query)
  const s = await getSettings()
  const p = periodOf(q, s)
  const tz = s.company.timeZone
  const todayYmd = localDate(new Date(), tz)
  const { start } = dayBounds(todayYmd, tz)
  const sc = { userIds: [u.id] }
  const teamId = await teamOf(u.id)
  const [conv, fu, calls, att, fresh, statusCounts, speed] = await Promise.all([
    conversion(p, sc), followUpStats(p, sc, s), callStats(start, new Date(), sc),
    prisma.attendance.findUnique({ where: { userId_workDate: { userId: u.id, workDate: dateOnly(todayYmd) } } }),
    freshCounts(prisma, [u.id]),
    prisma.lead.groupBy({ by: ['statusId'], where: { ownerId: u.id, deletedAt: null }, _count: true }),
    speedToFirstCall(p, sc),
  ])
  const statuses = await prisma.status.findMany()
  const c = calls.get(u.id) ?? { calls: 0, connected: 0, talkMin: 0 }
  const [tCalls, tConv] = await Promise.all([targetFor('USER', u.id, 'calls', 'DAY', start), targetFor('USER', u.id, 'conversions', 'MONTH', p.from)])
  // rank in the team this period
  const teamRows = teamId ? byKey(await perfRows(p, { teamIds: [teamId] }), 'userId') : new Map()
  const ranking = [...teamRows].map(([id, v]) => ({ id, conv: v.conversions, pct: pct(v.conversions, v.counted) ?? 0 })).sort((a, b) => b.conv - a.conv || b.pct - a.pct)
  res.json({
    period: { label: p.label, from: p.fromYmd, to: p.toYmd, rule: p.rule },
    today: { punchInAt: att?.punchInAt ?? null, punchOutAt: att?.punchOutAt ?? null, late: att?.late ?? false, calls: c.calls, connected: c.connected, talkMin: c.talkMin, callTarget: tCalls, followUpsDue: fu.byUser.get(u.id)?.dueToday ?? 0, overdue: fu.byUser.get(u.id)?.overdue ?? 0, fresh: fresh.get(u.id) ?? 0, noLeads: (fresh.get(u.id) ?? 0) <= s.allocation.lowLeadMark ? 'No new leads. Your Team Lead has been told.' : null },
    kpis: { counted: conv.counted, contacted: conv.contacted, conversions: conv.conversions, conversionTarget: tConv, conversionPct: conv.pct, prevConversionPct: conv.prev.pct, contactRate: conv.contactRate, followUpCompletionPct: fu.total.completionPct, speedToFirstCallMin: speed.avgMin },
    byStatus: statusCounts.map((x) => ({ status: statuses.find((st) => st.id === x.statusId)?.label, key: statuses.find((st) => st.id === x.statusId)?.key, count: x._count })),
    rank: ranking.findIndex((r) => r.id === u.id) + 1 || null, teamSize: ranking.length,
  })
})

// ---------------------------------------------------------------- leaderboard

dashboardRouter.get('/leaderboard', async (req, res) => {
  const u = me(req)
  const s = await getSettings()
  if (!s.performance.leaderboardVisibleTo.includes(u.role)) throw forbidden('The leaderboard is not shown to your role')
  const q = parse(z.object({ period: z.enum(['today', 'week', 'month']).default('month'), teamId: z.coerce.number().optional(), by: z.enum(['conversions', 'conversion_pct', 'calls']).default('conversions') }), req.query)
  const p = periodOf(q, s)
  const rows = byKey(await perfRows(p, { teamIds: q.teamId ? [q.teamId] : null }), 'userId')
  const calls = await callStats(p.from, p.to, { teamIds: q.teamId ? [q.teamId] : null })
  const ids = [...new Set([...rows.keys(), ...calls.keys()])]
  const users = await prisma.user.findMany({ where: { id: { in: ids }, role: 'BDE' }, include: { memberships: { where: { toAt: null }, include: { team: { select: { name: true } } } } } })
  const list = users.map((x) => {
    const v = rows.get(x.id) ?? { counted: 0, conversions: 0, contacted: 0 }
    return { userId: x.id, name: x.name, team: x.memberships[0]?.team.name ?? null, conversions: v.conversions, conversionPct: pct(v.conversions, v.counted), counted: v.counted, calls: calls.get(x.id)?.calls ?? 0 }
  })
  const key = q.by === 'conversion_pct' ? 'conversionPct' : q.by
  list.sort((a, b) => ((b[key] as number) ?? -1) - ((a[key] as number) ?? -1) || b.conversions - a.conversions || a.name.localeCompare(b.name))
  res.json({ period: { label: p.label, rule: p.rule }, by: q.by, rows: list.map((r, i) => ({ rank: i + 1, ...r, me: r.userId === u.id })) })
})
