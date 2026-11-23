import { Prisma, type AllocMethod } from '@prisma/client'
import { prisma, type Db, type Tx } from '../../db.js'
import { getSettings, type Settings } from '../../lib/settings.js'
import { openStatusIds, statusIdsBy } from '../../lib/statuses.js'
import { dayBounds, localDate, dateOnly, weekday } from '../../lib/time.js'
import { audit } from '../../lib/audit.js'
import { unprocessable, badRequest } from '../../lib/errors.js'
import { plan, splitEqual, splitCapacity, deal, performance, type Candidate, type LeadToPlace, type Method, type PlanResult } from './engine.js'
import { assignToTeam, assignToBde, newRun } from './assign.js'
import { notify } from '../notifications/service.js'

// ---------------------------------------------------------------- limits & state

export interface Limit { max: number; perDay: number }

/** Most specific wins: BDE → team → company row → settings default (§5.7). */
export async function limitsFor(db: Db, teamId: number | null, userIds: number[], s?: Settings): Promise<Map<number, Limit>> {
  const st = s ?? (await getSettings(db))
  const rows = await db.allocationLimit.findMany({ where: { OR: [{ scope: 'COMPANY' }, { scope: 'TEAM', scopeId: teamId ?? -1 }, { scope: 'USER', scopeId: { in: userIds } }] } })
  const company = rows.find((r) => r.scope === 'COMPANY')
  const team = rows.find((r) => r.scope === 'TEAM')
  const out = new Map<number, Limit>()
  for (const id of userIds) {
    const u = rows.find((r) => r.scope === 'USER' && r.scopeId === id)
    out.set(id, {
      max: u?.maxOpen ?? team?.maxOpen ?? company?.maxOpen ?? st.allocation.maxOpen,
      perDay: u?.maxPerDay ?? team?.maxPerDay ?? company?.maxPerDay ?? st.allocation.maxPerDay,
    })
  }
  return out
}

type State = { stage1: number; teams: Record<string, number> }
async function getState(db: Db): Promise<State> {
  const r = await db.setting.findUnique({ where: { key: '_alloc_state' } })
  return { stage1: 0, teams: {}, ...((r?.value as object) ?? {}) } as State
}
async function saveState(db: Db, st: State) {
  await db.setting.upsert({ where: { key: '_alloc_state' }, create: { key: '_alloc_state', value: st }, update: { value: st } })
}

/** Open-lead counts per owner. */
export async function openCounts(db: Db, userIds: number[]) {
  const open = await openStatusIds(db)
  const rows = await db.lead.groupBy({ by: ['ownerId'], where: { deletedAt: null, ownerId: { in: userIds }, statusId: { in: open } }, _count: true })
  return new Map(rows.map((r) => [r.ownerId!, r._count]))
}

// ---------------------------------------------------------------- candidates

/** Is today a working day? Holidays and week-offs block automatic allocation for everyone. */
export async function dayInfo(db: Db, s: Settings, now = new Date()) {
  const ymd = localDate(now, s.company.timeZone)
  const holiday = await db.holiday.findUnique({ where: { date: dateOnly(ymd) } })
  return { ymd, holiday: holiday?.name ?? null, weekOff: s.attendance.weekOffs.includes(weekday(ymd)), ...dayBounds(ymd, s.company.timeZone) }
}

/** Every BDE of the team with load, limits, presence and performance; ineligible ones carry `skip` (§5.7 step 1). */
export async function candidatesFor(db: Db, teamId: number, s: Settings, opts: { ignorePresence?: boolean; onlyUserIds?: number[] } = {}): Promise<Candidate[]> {
  const members = await db.teamMembership.findMany({ where: { teamId, toAt: null, ...(opts.onlyUserIds && { userId: { in: opts.onlyUserIds } }) }, include: { user: true } })
  const bdes = members.map((m) => m.user).filter((u) => u.role === 'BDE')
  const ids = bdes.map((u) => u.id)
  if (!ids.length) return []
  const day = await dayInfo(db, s)
  const [limits, open, today, lastAt, presence, leave, values, perf] = await Promise.all([
    limitsFor(db, teamId, ids, s),
    openCounts(db, ids),
    db.leadAssignment.groupBy({ by: ['userId'], where: { level: 'BDE', userId: { in: ids }, assignedAt: { gte: day.start, lt: day.end } }, _count: true }),
    db.leadAssignment.groupBy({ by: ['userId'], where: { level: 'BDE', userId: { in: ids } }, _max: { assignedAt: true } }),
    db.attendance.findMany({ where: { userId: { in: ids }, workDate: dateOnly(day.ymd) }, select: { userId: true, punchInAt: true } }),
    db.timeOff.findMany({ where: { userId: { in: ids }, fromDate: { lte: dateOnly(day.ymd) }, toDate: { gte: dateOnly(day.ymd) } }, select: { userId: true } }),
    db.userMatchValue.findMany({ where: { userId: { in: ids } } }),
    perfFor(db, teamId, ids, s),
  ])
  const givenToday = new Map(today.map((r) => [r.userId!, r._count]))
  const last = new Map(lastAt.map((r) => [r.userId!, r._max.assignedAt?.getTime() ?? 0]))
  const present = new Set(presence.filter((p) => p.punchInAt).map((p) => p.userId))
  const onLeave = new Set(leave.map((l) => l.userId))
  return bdes.map((u) => {
    const lim = limits.get(u.id)!
    let skip: string | undefined
    if (u.state !== 'ACTIVE') skip = u.state === 'INACTIVE' ? 'Inactive' : 'Has left'
    else if (!opts.ignorePresence) {
      if (day.holiday) skip = `Holiday (${day.holiday})`
      else if (day.weekOff) skip = 'Week-off'
      else if (onLeave.has(u.id)) skip = 'On leave'
      else if (s.allocation.punchInRequired && !present.has(u.id)) skip = 'Not punched in today'
    }
    const vals: Record<string, string[]> = {}
    for (const v of values.filter((x) => x.userId === u.id)) (vals[v.fieldKey] ??= []).push(v.value.toLowerCase())
    return { userId: u.id, name: u.name, open: open.get(u.id) ?? 0, max: lim.max, givenToday: givenToday.get(u.id) ?? 0, maxPerDay: lim.perDay, perf: perf.get(u.id) ?? 0.5, lastAssignedAt: last.get(u.id) ?? 0, values: vals, skip }
  })
}

/** Performance input for Smart: last N days, counted leads vs conversions credited to the owner (§5.7, §9.1). */
async function perfFor(db: Db, teamId: number, ids: number[], s: Settings) {
  const since = new Date(Date.now() - s.allocation.perfWindowDays * 86_400_000)
  const won = await statusIdsBy(db, 'WON')
  const excluded = await statusIdsBy(db, 'EXCLUDED')
  const counted = await db.$queryRaw<{ user_id: number; n: bigint }[]>`
    SELECT a.user_id, COUNT(DISTINCT a.lead_id) AS n FROM lead_assignments a JOIN leads l ON l.id = a.lead_id
    WHERE a.level = 'BDE' AND a.team_id = ${teamId} AND a.assigned_at >= ${since} AND l.status_id <> ALL(${excluded}::int[])
    GROUP BY a.user_id`
  const conv = await db.$queryRaw<{ owner_id: number; n: bigint }[]>`
    SELECT h.owner_id, COUNT(DISTINCT h.lead_id) AS n FROM status_history h
    WHERE h.to_status_id = ANY(${won}::int[]) AND h.team_id = ${teamId} AND h.at >= ${since} AND h.owner_id IS NOT NULL
    GROUP BY h.owner_id`
  const c = new Map(counted.map((r) => [r.user_id, Number(r.n)]))
  const w = new Map(conv.map((r) => [r.owner_id, Number(r.n)]))
  const totalC = [...c.values()].reduce((a, b) => a + b, 0)
  const totalW = [...w.values()].reduce((a, b) => a + b, 0)
  const teamPct = totalC ? totalW / totalC : 0
  return new Map(ids.map((id) => [id, performance(w.get(id) ?? 0, c.get(id) ?? 0, teamPct, s.allocation.perfMinLeads)]))
}

/** Lead values for the matching fields, lower case; previous owners (recycled leads never go back, §5.7). */
async function leadsToPlace(db: Db, ids: number[], s: Settings): Promise<LeadToPlace[]> {
  if (!ids.length) return []
  const rows = await db.lead.findMany({ where: { id: { in: ids } }, select: { id: true, custom: true } })
  const prev = await db.leadAssignment.findMany({ where: { leadId: { in: ids }, level: 'BDE' }, select: { leadId: true, userId: true } })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const keys = s.allocation.matching.enabled ? s.allocation.matching.fields.map((f) => f.key) : []
  return ids.map((id) => {
    const c = (byId.get(id)?.custom ?? {}) as Record<string, unknown>
    return { id, previousOwners: prev.filter((p) => p.leadId === id).map((p) => p.userId!), match: Object.fromEntries(keys.map((k) => [k, c[k] == null ? null : String(c[k]).toLowerCase()])) }
  })
}

/** Pool leads best first (score, then oldest). Inside a transaction they are locked; others skip them (§5.6). */
async function poolLeadIds(db: Db, where: Prisma.Sql, limit: number, lock: boolean): Promise<number[]> {
  const open = await openStatusIds(db)
  const rows = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM leads
    WHERE deleted_at IS NULL AND owner_id IS NULL AND dnd = false AND status_id = ANY(${open}::int[]) AND ${where}
    ORDER BY score DESC, created_at ASC, id ASC
    LIMIT ${limit}
    ${lock ? Prisma.sql`FOR UPDATE SKIP LOCKED` : Prisma.empty}`
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------- Stage 1: company pool → teams

export interface Stage1Input {
  teamIds: number[]; count: number; method: 'EQUAL' | 'CAPACITY' | 'MANUAL'; manual?: Record<string, number>
  batchId?: number; sourceId?: number; minScore?: number; field?: { key: string; value: string }
}

async function stage1Plan(db: Db, inp: Stage1Input, lock: boolean) {
  const s = await getSettings(db)
  const teams = await db.team.findMany({ where: { id: { in: inp.teamIds }, state: 'ACTIVE' }, orderBy: { id: 'asc' } })
  if (teams.length !== new Set(inp.teamIds).size) throw badRequest('Pick active teams only')
  const conds: Prisma.Sql[] = [Prisma.sql`team_id IS NULL`]
  if (inp.batchId) conds.push(Prisma.sql`batch_id = ${inp.batchId}`)
  if (inp.sourceId) conds.push(Prisma.sql`source_id = ${inp.sourceId}`)
  if (inp.minScore != null) conds.push(Prisma.sql`score >= ${inp.minScore}`)
  if (inp.field) conds.push(Prisma.sql`lower(custom->>${inp.field.key}) = lower(${inp.field.value})`)
  const ids = await poolLeadIds(db, Prisma.join(conds, ' AND '), inp.count, lock)
  const n = ids.length
  let counts: number[]
  const st = await getState(db)
  if (inp.method === 'EQUAL') counts = splitEqual(n, teams.length, st.stage1 % Math.max(1, teams.length))
  else if (inp.method === 'MANUAL') {
    counts = teams.map((t) => Math.max(0, Math.floor(inp.manual?.[String(t.id)] ?? 0)))
    const sum = counts.reduce((a, b) => a + b, 0)
    if (sum > n) throw unprocessable(`You typed ${sum} leads but only ${n} match the filters`)
  } else {
    const caps: number[] = []
    for (const t of teams) {
      const c = await candidatesFor(db, t.id, s, { ignorePresence: true })
      caps.push(c.filter((x) => !x.skip).reduce((a, x) => a + Math.max(0, x.max - x.open), 0))
    }
    counts = splitCapacity(n, caps)
  }
  const pools = await db.lead.groupBy({ by: ['teamId'], where: { deletedAt: null, ownerId: null, teamId: { in: teams.map((t) => t.id) } }, _count: true })
  const inPool = new Map(pools.map((p) => [p.teamId, p._count]))
  const groups = deal(ids, counts)
  return { teams, ids, groups, state: st, preview: teams.map((t, i) => ({ teamId: t.id, team: t.name, inPoolNow: inPool.get(t.id) ?? 0, willReceive: groups[i].length, poolAfter: (inPool.get(t.id) ?? 0) + groups[i].length })), available: n }
}

export async function previewStage1(inp: Stage1Input) {
  const p = await stage1Plan(prisma, inp, false)
  return { method: inp.method, selected: p.available, rows: p.preview, total: p.ids.length }
}

export async function runStage1(t: Tx, inp: Stage1Input, by: number) {
  const p = await stage1Plan(t, inp, true)
  const given = p.groups.reduce((a, g) => a + g.length, 0)
  if (!given) throw unprocessable('No leads in the company pool match these filters')
  const run = await newRun(t, { level: 'TEAM', method: inp.method, by, params: inp as unknown as object, count: given })
  const before: object[] = []
  for (const [i, team] of p.teams.entries()) {
    for (const leadId of p.groups[i]) {
      before.push({ leadId, teamId: null, ownerId: null })
      await assignToTeam(t, { leadId, teamId: team.id, runId: run.id, by, reason: { method: inp.method } })
    }
  }
  if (inp.method === 'EQUAL') await saveState(t, { ...p.state, stage1: p.state.stage1 + given })
  await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: by, leadCount: given, before, runId: run.id } })
  await audit(t, { actorId: by, action: 'ALLOCATE_TEAMS', entity: 'allocation_run', entityId: run.id, after: { method: inp.method, rows: p.preview } })
  return { runId: run.id, given, rows: p.preview }
}

// ---------------------------------------------------------------- Stage 2: team pool → BDEs

export interface Stage2Input { teamId: number; method?: Method; count?: number; leadIds?: number[]; onlyUserIds?: number[]; runMethod?: AllocMethod }

async function stage2Plan(db: Db, inp: Stage2Input, lock: boolean): Promise<{ result: PlanResult; method: Method; ids: number[]; state: State }> {
  const s = await getSettings(db)
  const team = await db.team.findUnique({ where: { id: inp.teamId } })
  if (!team || team.state !== 'ACTIVE') throw badRequest('Team not found or inactive')
  if (lock) await db.$queryRaw`SELECT id FROM teams WHERE id = ${inp.teamId} FOR UPDATE` // one distribution per team at a time
  const method: Method = inp.method ?? (team.method === 'EQUAL' || team.method === 'WORKLOAD' ? team.method : 'SMART')
  const where = inp.leadIds?.length ? Prisma.sql`team_id = ${inp.teamId} AND id = ANY(${inp.leadIds}::int[])` : Prisma.sql`team_id = ${inp.teamId}`
  const ids = await poolLeadIds(db, where, inp.count ?? inp.leadIds?.length ?? 10_000, lock)
  const cands = await candidatesFor(db, inp.teamId, s, { onlyUserIds: inp.onlyUserIds })
  const state = await getState(db)
  const matching = s.allocation.matching.enabled ? s.allocation.matching.fields : []
  const result = plan(await leadsToPlace(db, ids, s), cands, { method, weights: s.allocation.weights, matching, rotation: state.teams[String(inp.teamId)] ?? 0 })
  return { result, method, ids, state }
}

export async function previewStage2(inp: Stage2Input) {
  const { result, method, ids } = await stage2Plan(prisma, inp, false)
  return summarize(result, method, ids.length)
}

function summarize(r: PlanResult, method: Method, inPool: number) {
  const byReason = new Map<string, number>()
  for (const l of r.leftover) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + 1)
  return {
    method, inPool, willGive: r.placements.length,
    perBde: r.perUser.map((u) => ({ ...u, why: whyFor(r, u.userId) })),
    skipped: r.skipped,
    notGiven: [...byReason].map(([reason, count]) => ({ reason, count })),
    message: r.leftover.length ? `${r.leftover.length} leads not given: ${[...byReason.keys()].join('; ')}` : null,
  }
}

function whyFor(r: PlanResult, userId: number) {
  const mine = r.placements.filter((p) => p.userId === userId)
  if (!mine.length) return null
  const first = mine[0].reason
  return { method: first.method, firstScore: first.score, perf: first.perf, matched: [...new Set(mine.flatMap((m) => m.reason.match ?? []))], startLoad: first.load }
}

export async function runStage2(t: Tx, inp: Stage2Input, by: number | null) {
  const { result, method, ids, state } = await stage2Plan(t, inp, true)
  if (!result.placements.length) return { runId: null, given: 0, ...summarize(result, method, ids.length) }
  const run = await newRun(t, { level: 'BDE', method: inp.runMethod ?? method, teamId: inp.teamId, by, params: { method, count: inp.count ?? null }, count: result.placements.length })
  const before: object[] = []
  for (const p of result.placements) {
    before.push({ leadId: p.leadId, teamId: inp.teamId, ownerId: null })
    await assignToBde(t, { leadId: p.leadId, teamId: inp.teamId, userId: p.userId, runId: run.id, by, reason: p.reason })
  }
  if (method === 'EQUAL') await saveState(t, { ...state, teams: { ...state.teams, [inp.teamId]: (state.teams[String(inp.teamId)] ?? 0) + result.placements.length } })
  await t.bulkAction.create({ data: { kind: 'ASSIGN', byUserId: by ?? 0, leadCount: result.placements.length, before, runId: run.id } })
  for (const u of result.perUser.filter((x) => x.get)) await notify(t, u.userId, { type: 'LEADS_ASSIGNED', title: `${u.get} new leads for you`, link: '/today' })
  await audit(t, { actorId: by, action: 'DISTRIBUTE', entity: 'allocation_run', entityId: run.id, after: { teamId: inp.teamId, method, given: result.placements.length, leftover: result.leftover.length } })
  return { runId: run.id, given: result.placements.length, ...summarize(result, method, ids.length) }
}

/** Fresh leads per BDE (status New, owned). */
export async function freshCounts(db: Db, userIds: number[]) {
  const s = await db.status.findUnique({ where: { key: 'NEW' } })
  const rows = await db.lead.groupBy({ by: ['ownerId'], where: { deletedAt: null, ownerId: { in: userIds }, statusId: s!.id }, _count: true })
  return new Map(rows.map((r) => [r.ownerId!, r._count]))
}

/**
 * §5.5: after a status change, if the BDE's fresh leads reached the low mark:
 * auto-refill (team setting) from the team pool, else tell the Team Lead; if the pool is empty, tell Admin.
 * Alerts once per BDE / team per day.
 */
export async function checkLowLeads(userId: number) {
  const s = await getSettings()
  const m = await prisma.teamMembership.findFirst({ where: { userId, toAt: null }, include: { team: true, user: true } })
  if (!m || m.user.state !== 'ACTIVE' || m.user.role !== 'BDE') return { action: 'none' as const }
  const fresh = (await freshCounts(prisma, [userId])).get(userId) ?? 0
  if (fresh > s.allocation.lowLeadMark) return { action: 'none' as const }
  const poolCount = await prisma.lead.count({ where: { teamId: m.teamId, ownerId: null, deletedAt: null } })
  const day = localDate(new Date(), s.company.timeZone)
  const { teamLeadersOf, adminIds } = await import('../notifications/service.js')
  if (m.team.autoDistribute && poolCount > 0) {
    const r = await prisma.$transaction((t) => runStage2(t, { teamId: m.teamId, method: 'WORKLOAD', count: s.allocation.refillSize, onlyUserIds: [userId], runMethod: 'AUTO_REFILL' }, null), { timeout: 60_000 })
    if (r.given) return { action: 'refilled' as const, given: r.given }
  }
  await prisma.$transaction(async (t) => {
    await notify(t, userId, { type: 'NO_LEADS', title: 'No new leads. Your Team Lead has been told.', link: '/today', dedupeKey: `no-leads:${day}` })
    for (const tl of await teamLeadersOf(t, m.teamId)) await notify(t, tl, { type: 'NEEDS_LEADS', title: `${m.user.name} needs leads (${fresh} fresh left)`, link: `/allocation?teamId=${m.teamId}`, dedupeKey: `needs-leads:${userId}:${day}` })
    if (!poolCount) {
      const empty = await prisma.teamMembership.count({ where: { teamId: m.teamId, toAt: null } })
      for (const a of await adminIds(t)) await notify(t, a, { type: 'TEAM_NEEDS_LEADS', title: `${m.team.name} needs leads (team pool 0)`, body: `${empty} BDEs in the team`, link: '/allocation/teams', dedupeKey: `team-needs-leads:${m.teamId}:${day}` })
    }
  })
  return { action: 'alerted' as const, poolEmpty: !poolCount }
}
