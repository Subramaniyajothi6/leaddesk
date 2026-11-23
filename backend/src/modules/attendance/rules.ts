import type { DayStatus } from '@prisma/client'
import type { Settings } from '../../lib/settings.js'
import { localMinutes, minutesOf, ymdOf } from '../../lib/time.js'

export interface DayInput {
  ymd: string
  punchInAt: Date | null
  punchOutAt: Date | null
  joinedOn: Date
  exitedOn: Date | null
  holiday: boolean
  weekOff: boolean
  leave: boolean
  /** true once the day is over (or the auto-close ran): a missing punch-out is then final */
  closed: boolean
}
export interface DayResult {
  working: boolean        // false before joining / after exit (not counted at all)
  dayStatus: DayStatus | null // null = day still running, nothing decided yet
  workedMin: number
  late: boolean
  earlyOut: boolean
  missingPunchOut: boolean
}

/** Day status of §10.3, flags on top. Night shifts belong to the punch-in date (the caller passes that date). */
export function computeDay(d: DayInput, s: Settings['attendance'], tz: string): DayResult {
  const base = { workedMin: 0, late: false, earlyOut: false, missingPunchOut: false }
  if (d.ymd < ymdOf(d.joinedOn) || (d.exitedOn && d.ymd > ymdOf(d.exitedOn))) return { working: false, dayStatus: null, ...base }
  if (d.holiday) return { working: true, dayStatus: 'HOLIDAY', ...base }
  if (d.weekOff) return { working: true, dayStatus: 'WEEK_OFF', ...base }
  if (d.leave) return { working: true, dayStatus: 'LEAVE', ...base }
  if (!d.punchInAt) return { working: true, dayStatus: d.closed ? 'ABSENT' : null, ...base }
  const late = localMinutes(d.punchInAt, tz) > minutesOf(s.shiftStart) + s.graceLateMin
  if (!d.punchOutAt) {
    if (!d.closed) return { working: true, dayStatus: null, ...base, late }
    return { working: true, dayStatus: s.missingPunchOutCounts, workedMin: 0, late, earlyOut: false, missingPunchOut: true }
  }
  const workedMin = Math.max(0, Math.round((d.punchOutAt.getTime() - d.punchInAt.getTime()) / 60_000))
  const sameDayOut = ymdOf(new Date(d.punchOutAt.getTime())) === ymdOf(new Date(d.punchInAt.getTime())) || workedMin < 16 * 60
  const earlyOut = sameDayOut && localMinutes(d.punchOutAt, tz) < minutesOf(s.shiftEnd) - s.graceEarlyMin && workedMin < s.fullDayMin
  const dayStatus: DayStatus = workedMin >= s.fullDayMin ? 'PRESENT' : workedMin >= s.halfDayMin ? 'HALF_DAY' : 'ABSENT'
  return { working: true, dayStatus, workedMin, late, earlyOut, missingPunchOut: false }
}

/** Attendance % (§9.2): present days (half day = 0.5) ÷ working days, in basis points. */
export function attendanceBp(days: { dayStatus: DayStatus | null; working: boolean }[]) {
  const counted = days.filter((d) => d.working && d.dayStatus && !['HOLIDAY', 'WEEK_OFF', 'LEAVE'].includes(d.dayStatus))
  if (!counted.length) return null
  const present = counted.reduce((a, d) => a + (d.dayStatus === 'PRESENT' ? 1 : d.dayStatus === 'HALF_DAY' ? 0.5 : 0), 0)
  return Math.round((present / counted.length) * 10_000)
}
