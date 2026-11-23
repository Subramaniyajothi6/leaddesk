import { Router } from 'express'
import { z } from 'zod'
import type { Attendance, User } from '@prisma/client'
import { prisma, tx, type Db } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, ledTeamIds, teamOf, visibleTeamIds, type AuthUser } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, conflict, notFound, forbidden, unprocessable } from '../../lib/errors.js'
import { getSettings, type Settings } from '../../lib/settings.js'
import { localDate, dateOnly, ymdOf, monthBounds, eachDay, weekday, atLocal, localMinutes, minutesOf } from '../../lib/time.js'
import { holidaySet } from '../../lib/workdays.js'
import { notifyMany, teamLeadersOf } from '../notifications/service.js'
import { computeDay, attendanceBp } from './rules.js'

export const attendanceRouter = Router()

/** Recalculate and store one attendance row's status and flags. */
export async function recompute(db: Db, row: Attendance, s: Settings, closed?: boolean) {
  const user = await db.user.findUniqueOrThrow({ where: { id: row.userId } })
  const ymd = ymdOf(row.workDate)
  const holidays = await holidaySet(db)
  const leave = await db.timeOff.count({ where: { userId: row.userId, fromDate: { lte: row.workDate }, toDate: { gte: row.workDate } } })
  const isClosed = closed ?? (ymd < localDate(new Date(), s.company.timeZone) || !!row.punchOutAt)
  const r = computeDay({ ymd, punchInAt: row.punchInAt, punchOutAt: row.punchOutAt, joinedOn: user.joinedOn, exitedOn: user.exitedOn, holiday: holidays.has(ymd), weekOff: s.attendance.weekOffs.includes(weekday(ymd)), leave: leave > 0, closed: isClosed }, s.attendance, s.company.timeZone)
  return db.attendance.update({ where: { id: row.id }, data: { dayStatus: r.dayStatus, workedMin: r.workedMin, late: r.late, earlyOut: r.earlyOut, missingPunchOut: r.missingPunchOut } })
}

function ipAllowed(ip: string | null, list: string[]) {
  if (!list.length) return true
  if (!ip) return false
  return list.some((x) => (x.endsWith('*') ? ip.startsWith(x.slice(0, -1)) : ip === x))
}

const canPunch = (u: AuthUser, s: Settings) => u.role === 'BDE' || (u.role === 'TEAM_LEAD' && s.attendance.tlPunch)

/** Punch In: server time only, never the browser clock (§10.1). One per day. */
attendanceRouter.post('/punch-in', async (req, res) => {
  const u = me(req)
  const s = await getSettings()
  if (!canPunch(u, s)) throw forbidden('Punching is not used for your role')
  const b = parse(z.object({ location: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().optional() }).optional() }), req.body ?? {})
  const ip = clientIp(req)
  if (!ipAllowed(ip, s.attendance.officeIps)) throw forbidden('Punch in from the office network')
  if (s.attendance.captureLocation && !b.location) throw badRequest('Allow location to punch in')
  const now = new Date()
  const ymd = localDate(now, s.company.timeZone)
  const existing = await prisma.attendance.findUnique({ where: { userId_workDate: { userId: u.id, workDate: dateOnly(ymd) } } })
  if (existing?.punchInAt) throw conflict(`Already punched in at ${existing.punchInAt.toISOString()}`, { punchInAt: existing.punchInAt })
  const row = existing
    ? await prisma.attendance.update({ where: { id: existing.id }, data: { punchInAt: now, punchInIp: ip, location: b.location } })
    : await prisma.attendance.create({ data: { userId: u.id, workDate: dateOnly(ymd), punchInAt: now, punchInIp: ip, location: b.location } })
  res.status(201).json(await recompute(prisma, row, s, false))
})

/** Punch Out: closes today's row, or last night's for a shift that crossed midnight. */
attendanceRouter.post('/punch-out', async (req, res) => {
  const u = me(req)
  const s = await getSettings()
  if (!canPunch(u, s)) throw forbidden('Punching is not used for your role')
  const now = new Date()
  const open = await prisma.attendance.findFirst({ where: { userId: u.id, punchInAt: { not: null, gte: new Date(now.getTime() - 20 * 3_600_000) }, punchOutAt: null }, orderBy: { workDate: 'desc' } })
  if (!open) throw badRequest('You have not punched in')
  const row = await prisma.attendance.update({ where: { id: open.id }, data: { punchOutAt: now } })
  res.json(await recompute(prisma, row, s, true))
})

/** One user's month: every day with its status, plus the summary. */
async function monthOf(user: Pick<User, 'id' | 'joinedOn' | 'exitedOn'>, ym: string, s: Settings) {
  const { first, last } = monthBounds(ym)
  const today = localDate(new Date(), s.company.timeZone)
  const [rows, holidays, leaves] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: user.id, workDate: { gte: dateOnly(first), lte: dateOnly(last) } } }),
    holidaySet(),
    prisma.timeOff.findMany({ where: { userId: user.id, fromDate: { lte: dateOnly(last) }, toDate: { gte: dateOnly(first) } } }),
  ])
  const byDay = new Map(rows.map((r) => [ymdOf(r.workDate), r]))
  const cutoff = minutesOf(s.attendance.shiftStart) + s.attendance.absentCutoffMin
  const days = eachDay(first, last <= today ? last : today).map((ymd) => {
    const r = byDay.get(ymd)
    const leave = leaves.some((l) => ymdOf(l.fromDate) <= ymd && ymdOf(l.toDate) >= ymd)
    const closed = ymd < today || !!r?.punchOutAt
    const c = computeDay({ ymd, punchInAt: r?.punchInAt ?? null, punchOutAt: r?.punchOutAt ?? null, joinedOn: user.joinedOn, exitedOn: user.exitedOn, holiday: holidays.has(ymd), weekOff: s.attendance.weekOffs.includes(weekday(ymd)), leave, closed }, s.attendance, s.company.timeZone)
    // Today with no punch after the absent cut-off already shows as absent (§6 "absent today").
    const status = c.dayStatus ?? (ymd === today && !r?.punchInAt && localMinutes(new Date(), s.company.timeZone) > cutoff ? 'ABSENT' : null)
    return { date: ymd, id: r?.id ?? null, punchInAt: r?.punchInAt ?? null, punchOutAt: r?.punchOutAt ?? null, ...c, dayStatus: status }
  })
  const count = (st: string) => days.filter((d) => d.working && d.dayStatus === st).length
  return {
    days,
    summary: {
      present: count('PRESENT'), halfDay: count('HALF_DAY'), absent: count('ABSENT'), leave: count('LEAVE'), holiday: count('HOLIDAY'), weekOff: count('WEEK_OFF'),
      late: days.filter((d) => d.late).length, earlyOut: days.filter((d) => d.earlyOut).length, missingPunchOut: days.filter((d) => d.missingPunchOut).length,
      attendanceBp: attendanceBp(days),
    },
  }
}

attendanceRouter.get('/me', async (req, res) => {
  const ym = parse(z.string().regex(/^\d{4}-\d{2}$/).optional(), req.query.month)
  const s = await getSettings()
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } })
  const month = ym ?? localDate(new Date(), s.company.timeZone).slice(0, 7)
  const today = await prisma.attendance.findUnique({ where: { userId_workDate: { userId: user.id, workDate: dateOnly(localDate(new Date(), s.company.timeZone)) } } })
  res.json({ month, today, ...(await monthOf(user, month, s)) })
})

/** Users whose attendance the caller may see / correct. */
async function scopeUsers(u: AuthUser, teamId?: number) {
  const teams = await visibleTeamIds(u)
  if (u.role === 'BDE') return [u.id]
  const allowed = teamId ? (teams && !teams.includes(teamId) ? [] : [teamId]) : teams
  const members = await prisma.teamMembership.findMany({ where: { toAt: null, ...(allowed && { teamId: { in: allowed } }) }, select: { userId: true } })
  return members.map((m) => m.userId)
}

/** Team / company month report: per BDE summary (Team Lead: own teams; Admin: all). */
attendanceRouter.get('/', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), teamId: z.coerce.number().optional(), userId: z.coerce.number().optional() }), req.query)
  const s = await getSettings()
  const month = q.month ?? localDate(new Date(), s.company.timeZone).slice(0, 7)
  let ids = await scopeUsers(me(req), q.teamId)
  if (q.userId) { if (!ids.includes(q.userId)) throw forbidden('Not in your teams'); ids = [q.userId] }
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } })
  const out = []
  for (const user of users) {
    const m = await monthOf(user, month, s)
    out.push({ user: { id: user.id, name: user.name, empCode: user.empCode, state: user.state }, summary: m.summary, ...(q.userId && { days: m.days }) })
  }
  res.json({ month, rows: out })
})

/** Today board: who is in, late, absent, on leave (Team Lead / Admin). */
attendanceRouter.get('/today', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const teamId = parse(z.coerce.number().optional(), req.query.teamId)
  const s = await getSettings()
  const ymd = localDate(new Date(), s.company.timeZone)
  const ids = await scopeUsers(me(req), teamId)
  const users = await prisma.user.findMany({ where: { id: { in: ids }, state: 'ACTIVE', role: 'BDE' }, orderBy: { name: 'asc' } })
  const rows = await prisma.attendance.findMany({ where: { userId: { in: ids }, workDate: dateOnly(ymd) } })
  const leave = await prisma.timeOff.findMany({ where: { userId: { in: ids }, fromDate: { lte: dateOnly(ymd) }, toDate: { gte: dateOnly(ymd) } } })
  const pastCutoff = localMinutes(new Date(), s.company.timeZone) > minutesOf(s.attendance.shiftStart) + s.attendance.absentCutoffMin
  const list = users.map((x) => {
    const r = rows.find((a) => a.userId === x.id)
    const state = leave.some((l) => l.userId === x.id) ? 'LEAVE' : r?.punchOutAt ? 'OUT' : r?.punchInAt ? 'IN' : pastCutoff ? 'ABSENT' : 'NOT_YET'
    return { userId: x.id, name: x.name, state, punchInAt: r?.punchInAt ?? null, punchOutAt: r?.punchOutAt ?? null, late: r?.late ?? false }
  })
  res.json({ date: ymd, present: list.filter((l) => l.state === 'IN' || l.state === 'OUT').length, absent: list.filter((l) => l.state === 'ABSENT').length, late: list.filter((l) => l.late).length, onLeave: list.filter((l) => l.state === 'LEAVE').length, total: list.length, rows: list })
})

// ---------- corrections (§10.5) ----------
const corrBody = z.object({ date: z.string().date(), punchInAt: z.string().datetime({ offset: true }).nullable().optional(), punchOutAt: z.string().datetime({ offset: true }).nullable().optional(), reason: z.string().trim().min(3).max(500) })

async function mayCorrect(u: AuthUser, userId: number, s: Settings) {
  if (u.role === 'ADMIN') return
  if (u.role === 'TEAM_LEAD' && s.attendance.tlCanCorrect) {
    const t = await teamOf(userId)
    if (t && (await ledTeamIds(u.id)).includes(t)) return
  }
  throw forbidden('You cannot correct this attendance')
}

async function rowFor(db: Db, userId: number, ymd: string) {
  return (await db.attendance.findUnique({ where: { userId_workDate: { userId, workDate: dateOnly(ymd) } } })) ?? db.attendance.create({ data: { userId, workDate: dateOnly(ymd) } })
}

const snap = (r: Attendance) => ({ punchInAt: r.punchInAt, punchOutAt: r.punchOutAt, dayStatus: r.dayStatus })

/** BDEs cannot edit attendance: they send a correction request with a reason. */
attendanceRouter.post('/corrections', async (req, res) => {
  const u = me(req)
  const b = parse(corrBody, req.body)
  const s = await getSettings()
  if (b.date > localDate(new Date(), s.company.timeZone)) throw badRequest('Cannot correct a future day')
  if (!b.punchInAt && !b.punchOutAt) throw badRequest('Give the correct punch-in and/or punch-out time')
  const r = await tx(async (t) => {
    const row = await rowFor(t, u.id, b.date)
    if (await t.attendanceCorrection.count({ where: { attendanceId: row.id, state: 'PENDING' } })) throw conflict('A request for this day is already waiting')
    const c = await t.attendanceCorrection.create({ data: { attendanceId: row.id, requestedBy: u.id, before: snap(row), after: { punchInAt: b.punchInAt ?? row.punchInAt, punchOutAt: b.punchOutAt ?? row.punchOutAt }, reason: b.reason } })
    const team = await teamOf(u.id, t)
    if (team) await notifyMany(t, await teamLeadersOf(t, team), { type: 'ATTENDANCE_CORRECTION', title: `${u.name} asked to correct ${b.date}`, body: b.reason, link: '/attendance/corrections' })
    return c
  })
  res.status(201).json(r)
})

attendanceRouter.get('/corrections', async (req, res) => {
  const u = me(req)
  const state = parse(z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), req.query.state)
  const ids = await scopeUsers(u)
  const rows = await prisma.attendanceCorrection.findMany({ where: { ...(state && { state }), attendance: { userId: { in: ids } } }, orderBy: { at: 'desc' }, take: 200, include: { attendance: { select: { userId: true, workDate: true } } } })
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]))
  res.json(rows.map((r) => ({ ...r, user: users.get(r.attendance.userId), date: ymdOf(r.attendance.workDate) })))
})

async function applyCorrection(t: Db, row: Attendance, after: { punchInAt?: string | Date | null; punchOutAt?: string | Date | null }, s: Settings) {
  const pin = after.punchInAt ? new Date(after.punchInAt) : null
  const pout = after.punchOutAt ? new Date(after.punchOutAt) : null
  if (pin && pout && pout <= pin) throw unprocessable('Punch-out must be after punch-in')
  const updated = await t.attendance.update({ where: { id: row.id }, data: { punchInAt: pin, punchOutAt: pout } })
  return recompute(t, updated, s, true)
}

attendanceRouter.post('/corrections/:id/decide', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }), req.body)
  const c = await prisma.attendanceCorrection.findUnique({ where: { id }, include: { attendance: true } })
  if (!c || c.state !== 'PENDING') throw notFound('Pending request')
  const s = await getSettings()
  await mayCorrect(u, c.attendance.userId, s)
  if (c.attendance.userId === u.id) throw forbidden('You cannot approve your own request')
  const r = await tx(async (t) => {
    let after = null
    if (b.approve) after = await applyCorrection(t, c.attendance, c.after as object, s)
    await t.attendanceCorrection.update({ where: { id }, data: { state: b.approve ? 'APPROVED' : 'REJECTED', approvedBy: u.id, decidedAt: new Date() } })
    await audit(t, { actorId: u.id, action: b.approve ? 'ATTENDANCE_CORRECT' : 'ATTENDANCE_REJECT', entity: 'attendance', entityId: c.attendanceId, before: c.before, after: after ? snap(after) : { note: b.note }, ip: clientIp(req) })
    const { notify } = await import('../notifications/service.js')
    await notify(t, c.attendance.userId, { type: 'ATTENDANCE_DECISION', title: `Your correction for ${ymdOf(c.attendance.workDate)} was ${b.approve ? 'approved' : 'rejected'}`, body: b.note, link: '/attendance' })
    return after
  })
  res.json({ ok: true, attendance: r })
})

/** Team Lead / Admin correct directly; stored as an approved correction with before / after (§10.5). */
attendanceRouter.put('/:userId/:date', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const userId = parse(idParam, req.params.userId)
  const b = parse(corrBody, { ...req.body, date: req.params.date })
  const s = await getSettings()
  await mayCorrect(u, userId, s)
  if (userId === u.id) throw forbidden('Ask someone else to correct your own attendance')
  const r = await tx(async (t) => {
    const row = await rowFor(t, userId, b.date)
    const after = await applyCorrection(t, row, { punchInAt: b.punchInAt === undefined ? row.punchInAt : b.punchInAt, punchOutAt: b.punchOutAt === undefined ? row.punchOutAt : b.punchOutAt }, s)
    await t.attendanceCorrection.create({ data: { attendanceId: row.id, requestedBy: u.id, approvedBy: u.id, before: snap(row), after: snap(after), reason: b.reason, state: 'APPROVED', decidedAt: new Date() } })
    await audit(t, { actorId: u.id, action: 'ATTENDANCE_CORRECT', entity: 'attendance', entityId: row.id, before: snap(row), after: snap(after), ip: clientIp(req) })
    return after
  })
  res.json(r)
})

// ---------- time off (planned absence: not absent, blocks allocation) ----------
attendanceRouter.get('/time-off', async (req, res) => {
  const ids = await scopeUsers(me(req))
  res.json(await prisma.timeOff.findMany({ where: { userId: { in: ids }, toDate: { gte: dateOnly(ymdOf(new Date(Date.now() - 60 * 86_400_000))) } }, orderBy: { fromDate: 'desc' } }))
})
attendanceRouter.post('/time-off', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const b = parse(z.object({ userId: z.number().int(), from: z.string().date(), to: z.string().date(), kind: z.enum(['LEAVE', 'OTHER']).default('LEAVE') }), req.body)
  if (b.to < b.from) throw badRequest('End date is before start date')
  const s = await getSettings()
  await mayCorrect(u, b.userId, { ...s, attendance: { ...s.attendance, tlCanCorrect: true } })
  const row = await prisma.timeOff.create({ data: { userId: b.userId, fromDate: dateOnly(b.from), toDate: dateOnly(b.to), kind: b.kind, enteredBy: u.id } })
  await audit(prisma, { actorId: u.id, action: 'TIME_OFF', entity: 'time_off', entityId: row.id, after: row, ip: clientIp(req) })
  res.status(201).json(row)
})
attendanceRouter.delete('/time-off/:id', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const row = await prisma.timeOff.findUnique({ where: { id } })
  if (!row) throw notFound('Time off')
  const s = await getSettings()
  await mayCorrect(u, row.userId, { ...s, attendance: { ...s.attendance, tlCanCorrect: true } })
  await prisma.timeOff.delete({ where: { id } })
  await audit(prisma, { actorId: u.id, action: 'TIME_OFF_DELETE', entity: 'time_off', entityId: id, before: row, ip: clientIp(req) })
  res.json({ ok: true })
})

export { monthOf, atLocal }
