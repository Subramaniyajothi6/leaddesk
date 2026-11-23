import { prisma, tx } from '../db.js'
import { getSettings } from '../lib/settings.js'
import { localDate, dateOnly, addDaysYmd, weekday, dayBounds } from '../lib/time.js'
import { holidaySet } from '../lib/workdays.js'
import { notify, notifyMany, teamLeadersOf } from '../modules/notifications/service.js'
import { recompute } from '../modules/attendance/routes.js'
import { checkLowLeads, runStage2 } from '../modules/allocation/service.js'
import { maybeRecycle } from '../modules/work/service.js'
import { openStatusIds } from '../lib/statuses.js'

/** Follow-up reminders: N minutes before the due time (setting), once (§8 rule 2). */
export async function followUpReminders() {
  const s = await getSettings()
  const until = new Date(Date.now() + s.followUps.reminderMinutes * 60_000)
  const due = await prisma.followUp.findMany({ where: { state: 'PENDING', remindedAt: null, dueAt: { lte: until }, lead: { deletedAt: null } }, include: { lead: { select: { id: true, name: true } } }, take: 500 })
  for (const f of due) {
    const claimed = await prisma.followUp.updateMany({ where: { id: f.id, remindedAt: null }, data: { remindedAt: new Date() } })
    if (!claimed.count) continue
    await notify(prisma, f.userId, { type: 'FOLLOW_UP_DUE', title: `${f.type === 'CALL' ? 'Call' : f.type.toLowerCase()} ${f.lead.name}${f.dueAt < new Date() ? ' (overdue)' : ` at ${f.dueAt.toISOString().slice(11, 16)} UTC`}`, body: f.reason ?? undefined, link: `/leads/${f.lead.id}` })
  }
  return due.length
}

/** At the absent cut-off: BDEs not punched in (and not on leave) are absent today; Team Leads hear about due follow-ups (§6). */
export async function absentTodayCheck() {
  const s = await getSettings()
  const tz = s.company.timeZone
  const ymd = localDate(new Date(), tz)
  const holidays = await holidaySet()
  if (holidays.has(ymd) || s.attendance.weekOffs.includes(weekday(ymd))) return 0
  const { end } = dayBounds(ymd, tz)
  const members = await prisma.teamMembership.findMany({ where: { toAt: null, user: { state: 'ACTIVE', role: 'BDE' } }, include: { user: true } })
  let n = 0
  for (const m of members) {
    const att = await prisma.attendance.findUnique({ where: { userId_workDate: { userId: m.userId, workDate: dateOnly(ymd) } } })
    if (att?.punchInAt) continue
    const leave = await prisma.timeOff.count({ where: { userId: m.userId, fromDate: { lte: dateOnly(ymd) }, toDate: { gte: dateOnly(ymd) } } })
    if (leave) continue
    const dueToday = await prisma.followUp.count({ where: { userId: m.userId, state: 'PENDING', dueAt: { lt: end } } })
    n++
    await notifyMany(prisma, await teamLeadersOf(prisma, m.teamId), { type: 'BDE_ABSENT', title: `${m.user.name} has not punched in`, body: dueToday ? `${dueToday} follow-ups due today` : undefined, link: `/dashboard/team?teamId=${m.teamId}`, dedupeKey: `absent:${m.userId}:${ymd}` })
  }
  return n
}

/** Close the day's missing punch-outs at the auto-close time (status from the setting until corrected). */
export async function closeMissingPunchOuts() {
  const s = await getSettings()
  const ymd = localDate(new Date(), s.company.timeZone)
  const open = await prisma.attendance.findMany({ where: { workDate: { lte: dateOnly(ymd) }, punchInAt: { not: null }, punchOutAt: null, missingPunchOut: false } })
  for (const r of open) await recompute(prisma, r, s, true)
  return open.length
}

/** 00:30: final status for everyone for the previous day, including a row for people who never punched in. */
export async function finalizeYesterday() {
  const s = await getSettings()
  const y = addDaysYmd(localDate(new Date(), s.company.timeZone), -1)
  const users = await prisma.user.findMany({ where: { role: { in: s.attendance.tlPunch ? ['BDE', 'TEAM_LEAD'] : ['BDE'] }, state: { not: 'EXITED' }, joinedOn: { lte: dateOnly(y) } } })
  for (const u of users) {
    const row = (await prisma.attendance.findUnique({ where: { userId_workDate: { userId: u.id, workDate: dateOnly(y) } } })) ?? (await prisma.attendance.create({ data: { userId: u.id, workDate: dateOnly(y) } }))
    await recompute(prisma, row, s, true)
  }
  return users.length
}

/** Safety net for §5.5 during the shift. */
export async function lowLeadSweep() {
  const bdes = await prisma.teamMembership.findMany({ where: { toAt: null, user: { state: 'ACTIVE', role: 'BDE' } }, select: { userId: true } })
  let acted = 0
  for (const b of bdes) { const r = await checkLowLeads(b.userId); if (r.action !== 'none') acted++ }
  return acted
}

/** Hourly: recycle leads whose attempts are now spread over enough time, then give recycled leads out with the team's method. */
export async function recyclingSweep() {
  const s = await getSettings()
  const open = await openStatusIds()
  const cands = await prisma.lead.findMany({ where: { deletedAt: null, ownerId: { not: null }, statusId: { in: open }, attemptCount: { gte: s.recycling.maxAttempts }, firstAttemptAt: { lte: new Date(Date.now() - s.recycling.minSpreadHours * 3_600_000) } } })
  const teams = new Set<number>()
  for (const l of cands) {
    const r = await tx((t) => maybeRecycle(t, l, s, null))
    if (r === 'recycled' && l.teamId) {
      teams.add(l.teamId)
      await notifyMany(prisma, await teamLeadersOf(prisma, l.teamId), { type: 'LEAD_RECYCLED', title: `${l.name} was recycled to the team pool`, link: `/leads/${l.id}` })
    }
  }
  let given = 0
  for (const teamId of teams) given += (await distributeRecycled(teamId)).given
  return { recycled: cands.length, given }
}

/** Recycled leads in a team pool go out with the team's method (§5.7 triggers), never to a previous owner. */
export async function distributeRecycled(teamId: number) {
  const ids = (await prisma.lead.findMany({ where: { teamId, ownerId: null, deletedAt: null, recycleCount: { gt: 0 } }, select: { id: true } })).map((l) => l.id)
  if (!ids.length) return { given: 0 }
  return tx((t) => runStage2(t, { teamId, leadIds: ids, runMethod: 'RECYCLE' }, null), { timeout: 120_000 })
}
