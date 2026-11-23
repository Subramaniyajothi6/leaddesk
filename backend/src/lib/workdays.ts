import { prisma, type Db } from '../db.js'
import type { Settings } from './settings.js'
import { localDate, atLocal, addDaysYmd, weekday, minutesOf, localMinutes, ymdOf } from './time.js'

/** Holiday dates as 'YYYY-MM-DD' (cached for a minute). */
let hcache: { at: number; set: Set<string> } | null = null
export async function holidaySet(db: Db = prisma) {
  if (hcache && Date.now() - hcache.at < 60_000) return hcache.set
  const set = new Set((await db.holiday.findMany({ select: { date: true } })).map((h) => ymdOf(h.date)))
  hcache = { at: Date.now(), set }
  return set
}
export const clearHolidayCache = () => { hcache = null }

export const isWorkingDay = (ymd: string, s: Settings, holidays: Set<string>) => !holidays.has(ymd) && !s.attendance.weekOffs.includes(weekday(ymd))

export function nextWorkingDay(ymd: string, s: Settings, holidays: Set<string>, includeToday = false) {
  let d = includeToday ? ymd : addDaysYmd(ymd, 1)
  for (let i = 0; i < 60 && !isWorkingDay(d, s, holidays); i++) d = addDaysYmd(d, 1)
  return d
}

/** "First call" due time: now + N minutes, counted inside working hours only (§8.2). */
export function firstCallDue(now: Date, minutes: number, s: Settings, holidays: Set<string>): Date {
  const tz = s.company.timeZone
  const today = localDate(now, tz)
  const start = minutesOf(s.attendance.shiftStart)
  const end = minutesOf(s.attendance.shiftEnd)
  const nowMin = localMinutes(now, tz)
  if (isWorkingDay(today, s, holidays) && nowMin >= start && nowMin + minutes <= end) return new Date(now.getTime() + minutes * 60_000)
  if (isWorkingDay(today, s, holidays) && nowMin < start) return new Date(atLocal(today, s.attendance.shiftStart, tz).getTime() + minutes * 60_000)
  const d = nextWorkingDay(today, s, holidays)
  return new Date(atLocal(d, s.attendance.shiftStart, tz).getTime() + minutes * 60_000)
}

/** Quick picks that skip non-working days (§8 item 9). */
export function quickPicks(now: Date, s: Settings, holidays: Set<string>, defaultHours?: number | null) {
  const tz = s.company.timeZone
  const today = localDate(now, tz)
  const at = (ymd: string, hhmm = '11:00') => atLocal(ymd, hhmm, tz).toISOString()
  const tomorrow = nextWorkingDay(today, s, holidays)
  const inTwo = nextWorkingDay(addDaysYmd(today, 1), s, holidays)
  const nextWeek = nextWorkingDay(addDaysYmd(today, 6), s, holidays)
  const picks = [
    { label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000).toISOString() },
    { label: 'Tomorrow 11:00', at: at(tomorrow) },
    { label: 'In 2 days', at: at(inTwo) },
    { label: 'Next week', at: at(nextWeek) },
  ]
  if (defaultHours) {
    const raw = new Date(now.getTime() + defaultHours * 3_600_000)
    const d = localDate(raw, tz)
    const ymd = isWorkingDay(d, s, holidays) ? d : nextWorkingDay(d, s, holidays)
    picks.unshift({ label: 'Suggested', at: ymd === d ? raw.toISOString() : at(ymd) })
  }
  return picks
}
