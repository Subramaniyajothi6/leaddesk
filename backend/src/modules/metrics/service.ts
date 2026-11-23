import { Prisma } from '@prisma/client'
import { prisma } from '../../db.js'
import { getSettings, type Settings } from '../../lib/settings.js'
import { localDate, dayBounds, addDaysYmd, monthBounds } from '../../lib/time.js'

/**
 * The ONE metrics module (§9.5). Dashboards, reports and exports all call these functions,
 * so a number can never differ between two screens. Raw counts are returned; percentages are
 * computed from counts (never by averaging percentages) and rounded only when shown.
 */

export interface Period { from: Date; to: Date; prevFrom: Date; prevTo: Date; fromYmd: string; toYmd: string; label: string; rule: 'COHORT' | 'ACTIVITY' }

/** today | week | month | custom (from/to) in the company time zone, with the previous period of the same length. */
export function periodOf(q: { period?: string; from?: string; to?: string }, s: Settings): Period {
  const tz = s.company.timeZone
  const today = localDate(new Date(), tz)
  let fromYmd: string, toYmd: string, label: string
  if (q.from && q.to) { fromYmd = q.from; toYmd = q.to; label = `${q.from} to ${q.to}` }
  else if (q.period === 'today') { fromYmd = toYmd = today; label = 'Today' }
  else if (q.period === 'week') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7 // Monday-based week
    fromYmd = addDaysYmd(today, 1 - dow); toYmd = today; label = 'This week'
  } else { fromYmd = monthBounds(today.slice(0, 7)).first; toYmd = today; label = 'This month' }
  const from = dayBounds(fromYmd, tz).start
  const to = dayBounds(toYmd, tz).end
  const len = to.getTime() - from.getTime()
  const rule = s.performance.periodRule
  return { from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, fromYmd, toYmd, label, rule }
}

export const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : null)

export interface Scope { teamIds?: number[] | null; userIds?: number[] | null }

const teamFilter = (col: string, sc: Scope) => (sc.teamIds ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${sc.teamIds}::int[])` : Prisma.empty)
const userFilter = (col: string, sc: Scope) => (sc.userIds ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${sc.userIds}::int[])` : Prisma.empty)

export interface PerfRow { userId: number; teamId: number; counted: number; conversions: number; contacted: number }

/**
 * Counted leads and conversions per (BDE, team) for a period (§9.1–9.3).
 * Counted = BDE assignments in the period − leads now EXCLUDED − leads taken away before the BDE did anything.
 * Conversion credit = the owner (and team) recorded on the status change to a WON status.
 */
export async function perfRows(p: Pick<Period, 'from' | 'to' | 'rule'>, sc: Scope): Promise<PerfRow[]> {
  const rows = await prisma.$queryRaw<{ user_id: number; team_id: number; counted: bigint; conversions: bigint; contacted: bigint }[]>`
    WITH a AS (
      SELECT a.id, a.lead_id, a.user_id, a.team_id, a.assigned_at, a.ended_at
      FROM lead_assignments a
      WHERE a.level = 'BDE' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to} ${teamFilter('a.team_id', sc)} ${userFilter('a.user_id', sc)}
    ),
    counted AS (
      SELECT DISTINCT a.lead_id, a.user_id, a.team_id
      FROM a JOIN leads l ON l.id = a.lead_id JOIN statuses st ON st.id = l.status_id
      WHERE l.deleted_at IS NULL AND st.category <> 'EXCLUDED'
        AND (a.ended_at IS NULL
          OR EXISTS (SELECT 1 FROM call_logs c WHERE c.lead_id = a.lead_id AND c.user_id = a.user_id AND c.started_at BETWEEN a.assigned_at AND a.ended_at)
          OR EXISTS (SELECT 1 FROM status_history h WHERE h.lead_id = a.lead_id AND h.by_user_id = a.user_id AND h.at BETWEEN a.assigned_at AND a.ended_at))
    ),
    won AS (
      SELECT DISTINCT h.lead_id, h.owner_id AS user_id, h.team_id
      FROM status_history h JOIN statuses st ON st.id = h.to_status_id
      WHERE st.category = 'WON' AND h.owner_id IS NOT NULL
        ${p.rule === 'ACTIVITY' ? Prisma.sql`AND h.at >= ${p.from} AND h.at < ${p.to}` : Prisma.empty}
    ),
    contacted AS (
      SELECT DISTINCT h.lead_id FROM status_history h JOIN statuses st ON st.id = h.to_status_id WHERE st.counts_as_contact
    ),
    keys AS (SELECT user_id, team_id FROM counted UNION SELECT user_id, team_id FROM won ${p.rule === 'ACTIVITY' ? Prisma.empty : Prisma.sql`WHERE false`})
    SELECT k.user_id, k.team_id,
      (SELECT COUNT(*) FROM counted c WHERE c.user_id = k.user_id AND c.team_id = k.team_id) AS counted,
      ${p.rule === 'COHORT'
        ? Prisma.sql`(SELECT COUNT(*) FROM counted c JOIN won w ON w.lead_id = c.lead_id AND w.user_id = c.user_id WHERE c.user_id = k.user_id AND c.team_id = k.team_id)`
        : Prisma.sql`(SELECT COUNT(*) FROM won w WHERE w.user_id = k.user_id AND w.team_id = k.team_id)`} AS conversions,
      (SELECT COUNT(*) FROM counted c JOIN contacted x ON x.lead_id = c.lead_id WHERE c.user_id = k.user_id AND c.team_id = k.team_id) AS contacted
    FROM keys k
    WHERE true ${teamFilter('k.team_id', sc)} ${userFilter('k.user_id', sc)}`
  return rows.map((r) => ({ userId: r.user_id, teamId: r.team_id, counted: Number(r.counted), conversions: Number(r.conversions), contacted: Number(r.contacted) }))
}

export function sumPerf(rows: PerfRow[]) {
  return rows.reduce((a, r) => ({ counted: a.counted + r.counted, conversions: a.conversions + r.conversions, contacted: a.contacted + r.contacted }), { counted: 0, conversions: 0, contacted: 0 })
}
export function byKey(rows: PerfRow[], key: 'userId' | 'teamId') {
  const m = new Map<number, { counted: number; conversions: number; contacted: number }>()
  for (const r of rows) { const k = r[key]; const v = m.get(k) ?? { counted: 0, conversions: 0, contacted: 0 }; v.counted += r.counted; v.conversions += r.conversions; v.contacted += r.contacted; m.set(k, v) }
  return m
}

/** Company conversion %: all conversions ÷ all counted leads; the team rows are summed from raw counts. */
export async function conversion(p: Period, sc: Scope) {
  const [cur, prev] = await Promise.all([perfRows(p, sc), perfRows({ from: p.prevFrom, to: p.prevTo, rule: p.rule }, sc)])
  const a = sumPerf(cur)
  const b = sumPerf(prev)
  return { ...a, pct: pct(a.conversions, a.counted), contactRate: pct(a.contacted, a.counted), prev: { ...b, pct: pct(b.conversions, b.counted) }, rows: cur }
}

/** Speed to first call: minutes from a BDE assignment (in the period) to that BDE's first call on the lead. */
export async function speedToFirstCall(p: Pick<Period, 'from' | 'to'>, sc: Scope) {
  const rows = await prisma.$queryRaw<{ user_id: number; team_id: number; avg_min: number | null; n: bigint }[]>`
    SELECT a.user_id, a.team_id, AVG(EXTRACT(EPOCH FROM (fc.first_at - a.assigned_at)) / 60)::float AS avg_min, COUNT(fc.first_at) AS n
    FROM lead_assignments a
    LEFT JOIN LATERAL (SELECT MIN(c.started_at) AS first_at FROM call_logs c WHERE c.lead_id = a.lead_id AND c.user_id = a.user_id AND c.started_at >= a.assigned_at) fc ON true
    WHERE a.level = 'BDE' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to} AND fc.first_at IS NOT NULL ${teamFilter('a.team_id', sc)} ${userFilter('a.user_id', sc)}
    GROUP BY a.user_id, a.team_id`
  const total = rows.reduce((a, r) => a + Number(r.n), 0)
  const avg = total ? rows.reduce((a, r) => a + (r.avg_min ?? 0) * Number(r.n), 0) / total : null
  const per = (key: 'user_id' | 'team_id') => {
    const m = new Map<number, { sum: number; n: number }>()
    for (const r of rows) { const v = m.get(r[key]) ?? { sum: 0, n: 0 }; v.sum += (r.avg_min ?? 0) * Number(r.n); v.n += Number(r.n); m.set(r[key], v) }
    return new Map([...m].map(([k, v]) => [k, Math.round(v.sum / v.n)]))
  }
  return { avgMin: avg == null ? null : Math.round(avg), byUser: per('user_id'), byTeam: per('team_id') }
}

/** Untouched: open leads given to a BDE more than `hours` ago, still New, never called by the owner. */
export async function untouched(sc: Scope, hours = 24) {
  const before = new Date(Date.now() - hours * 3_600_000)
  const rows = await prisma.$queryRaw<{ user_id: number; team_id: number; n: bigint }[]>`
    SELECT a.user_id, a.team_id, COUNT(*) AS n
    FROM lead_assignments a JOIN leads l ON l.id = a.lead_id JOIN statuses st ON st.id = l.status_id
    WHERE a.level = 'BDE' AND a.ended_at IS NULL AND a.assigned_at < ${before} AND st.key = 'NEW' AND l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM call_logs c WHERE c.lead_id = a.lead_id AND c.user_id = a.user_id)
      ${teamFilter('a.team_id', sc)} ${userFilter('a.user_id', sc)}
    GROUP BY a.user_id, a.team_id`
  return { total: rows.reduce((a, r) => a + Number(r.n), 0), byUser: new Map(rows.map((r) => [r.user_id, Number(r.n)])), byTeam: rows.reduce((m, r) => m.set(r.team_id, (m.get(r.team_id) ?? 0) + Number(r.n)), new Map<number, number>()) }
}

/** Funnel for leads given out in the period: where are leads lost? (Admin / Team Lead dashboards). */
export async function funnel(p: Pick<Period, 'from' | 'to'>, sc: Scope) {
  const company = !sc.teamIds && !sc.userIds
  const [r] = await prisma.$queryRaw<{ uploaded: bigint; to_teams: bigint; to_bdes: bigint; contacted: bigint; interested: bigint; converted: bigint; paid: bigint }[]>`
    WITH t AS (SELECT DISTINCT a.lead_id FROM lead_assignments a WHERE a.level = 'TEAM' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to} ${teamFilter('a.team_id', sc)}),
    b AS (SELECT DISTINCT a.lead_id FROM lead_assignments a WHERE a.level = 'BDE' AND a.assigned_at >= ${p.from} AND a.assigned_at < ${p.to} ${teamFilter('a.team_id', sc)} ${userFilter('a.user_id', sc)}),
    reached AS (SELECT h.lead_id, bool_or(st.counts_as_contact) AS contacted, bool_or(st.key IN ('INTERESTED','FOLLOW_UP') OR st.category = 'WON') AS interested, bool_or(st.category = 'WON') AS won
      FROM status_history h JOIN statuses st ON st.id = h.to_status_id WHERE h.lead_id IN (SELECT lead_id FROM b) GROUP BY h.lead_id)
    SELECT
      ${company ? Prisma.sql`(SELECT COUNT(*) FROM leads WHERE created_at >= ${p.from} AND created_at < ${p.to} AND deleted_at IS NULL)` : Prisma.sql`(SELECT COUNT(*) FROM t)`} AS uploaded,
      (SELECT COUNT(*) FROM t) AS to_teams,
      (SELECT COUNT(*) FROM b) AS to_bdes,
      (SELECT COUNT(*) FROM reached WHERE contacted) AS contacted,
      (SELECT COUNT(*) FROM reached WHERE interested) AS interested,
      (SELECT COUNT(*) FROM reached WHERE won) AS converted,
      (SELECT COUNT(DISTINCT x.lead_id) FROM transactions x WHERE x.state = 'CONFIRMED' AND x.lead_id IN (SELECT lead_id FROM reached WHERE won)) AS paid`
  const steps = [
    [company ? 'Uploaded' : 'Received by team', r.uploaded], ['Given to teams', r.to_teams], ['Given to BDEs', r.to_bdes],
    ['Contacted', r.contacted], ['Interested', r.interested], ['Converted', r.converted], ['Paid (confirmed)', r.paid],
  ].filter(([k]) => company || k !== 'Given to teams') as [string, bigint][]
  let worst = { i: -1, loss: 0 }
  const out = steps.map(([label, n], i) => {
    const count = Number(n)
    const prev = i ? Number(steps[i - 1][1]) : null
    const keep = prev ? count / prev : null
    if (i > 0 && i < steps.length - 1 && prev && 1 - count / prev > worst.loss) worst = { i, loss: 1 - count / prev }
    return { label, count, keptPct: keep == null ? null : Math.round(keep * 1000) / 10 }
  })
  return out.map((x, i) => ({ ...x, biggestLoss: i === worst.i }))
}

/** Follow-up counts per owner: due today, overdue, and completion % in the period (done on time ÷ due). */
export async function followUpStats(p: Pick<Period, 'from' | 'to'>, sc: Scope, s: Settings) {
  const tz = s.company.timeZone
  const { end } = dayBounds(localDate(new Date(), tz), tz)
  const now = new Date()
  const rows = await prisma.$queryRaw<{ user_id: number; due_today: bigint; overdue: bigint; due_in_period: bigint; done_on_time: bigint }[]>`
    SELECT f.user_id,
      COUNT(*) FILTER (WHERE f.state = 'PENDING' AND f.due_at >= ${now} AND f.due_at < ${end}) AS due_today,
      COUNT(*) FILTER (WHERE f.state = 'PENDING' AND f.due_at < ${now}) AS overdue,
      COUNT(*) FILTER (WHERE f.due_at >= ${p.from} AND f.due_at < ${p.to} AND f.due_at < ${now} AND f.state <> 'CANCELLED') AS due_in_period,
      COUNT(*) FILTER (WHERE f.due_at >= ${p.from} AND f.due_at < ${p.to} AND f.state = 'DONE' AND f.completed_at <= f.due_at + interval '15 minutes') AS done_on_time
    FROM follow_ups f JOIN leads l ON l.id = f.lead_id
    WHERE l.deleted_at IS NULL ${teamFilter('l.team_id', sc)} ${userFilter('f.user_id', sc)}
    GROUP BY f.user_id`
  const m = new Map(rows.map((r) => [r.user_id, { dueToday: Number(r.due_today), overdue: Number(r.overdue), due: Number(r.due_in_period), doneOnTime: Number(r.done_on_time) }]))
  const tot = [...m.values()].reduce((a, v) => ({ dueToday: a.dueToday + v.dueToday, overdue: a.overdue + v.overdue, due: a.due + v.due, doneOnTime: a.doneOnTime + v.doneOnTime }), { dueToday: 0, overdue: 0, due: 0, doneOnTime: 0 })
  return { byUser: m, total: { ...tot, completionPct: pct(tot.doneOnTime, tot.due) } }
}

/** Calls per user in a window: total, connected, talk time. */
export async function callStats(from: Date, to: Date, sc: Scope) {
  const rows = await prisma.$queryRaw<{ user_id: number; calls: bigint; connected: bigint; talk_sec: bigint }[]>`
    SELECT c.user_id, COUNT(*) FILTER (WHERE c.channel = 'CALL') AS calls,
      COUNT(*) FILTER (WHERE o.connected) AS connected, COALESCE(SUM(c.duration_sec), 0) AS talk_sec
    FROM call_logs c LEFT JOIN call_outcomes o ON o.id = c.outcome_id JOIN leads l ON l.id = c.lead_id
    WHERE c.started_at >= ${from} AND c.started_at < ${to} ${teamFilter('l.team_id', sc)} ${userFilter('c.user_id', sc)}
    GROUP BY c.user_id`
  return new Map(rows.map((r) => [r.user_id, { calls: Number(r.calls), connected: Number(r.connected), talkMin: Math.round(Number(r.talk_sec) / 60) }]))
}

/** Latest target in force for a scope/metric at the period start (§9.5). */
export async function targetFor(scope: 'COMPANY' | 'TEAM' | 'USER', scopeId: number, metric: string, period: 'DAY' | 'WEEK' | 'MONTH', at: Date) {
  const t = await prisma.target.findFirst({ where: { scope, scopeId, metric, period, fromDate: { lte: at } }, orderBy: { fromDate: 'desc' } })
  return t ? Number(t.value) : null
}

/** Confirmed revenue (paise) in a period, optionally by team. Only CONFIRMED transactions count (§11.3). */
export async function revenue(p: Pick<Period, 'fromYmd' | 'toYmd'>, sc: Scope) {
  const rows = await prisma.$queryRaw<{ total: bigint | null; pending: bigint | null }[]>`
    SELECT SUM(amount_paise) FILTER (WHERE state = 'CONFIRMED') AS total, SUM(amount_paise) FILTER (WHERE state = 'PENDING') AS pending
    FROM transactions WHERE kind = 'REVENUE' AND received_on >= ${p.fromYmd}::date AND received_on <= ${p.toYmd}::date ${teamFilter('team_id', sc)}`
  return { confirmedPaise: Number(rows[0]?.total ?? 0), pendingPaise: Number(rows[0]?.pending ?? 0) }
}

export { getSettings }
