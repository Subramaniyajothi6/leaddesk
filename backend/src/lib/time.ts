import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

/** 'YYYY-MM-DD' of an instant in the company time zone. */
export const localDate = (d: Date, tz: string) => formatInTimeZone(d, tz, 'yyyy-MM-dd')

/** Date object for a calendar date (stored in DATE columns, midnight UTC). */
export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
export const ymdOf = (d: Date) => d.toISOString().slice(0, 10)

/** The UTC instant of a wall-clock time on a company-local date: ('2026-11-18','09:30') → Date */
export const atLocal = (ymd: string, hhmm: string, tz: string) => fromZonedTime(`${ymd}T${hhmm}:00`, tz)

/** Start (inclusive) and end (exclusive) UTC instants of a company-local day. */
export function dayBounds(ymd: string, tz: string) {
  const start = fromZonedTime(`${ymd}T00:00:00`, tz)
  const next = addDaysYmd(ymd, 1)
  return { start, end: fromZonedTime(`${next}T00:00:00`, tz) }
}

export function addDaysYmd(ymd: string, n: number) {
  const d = dateOnly(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return ymdOf(d)
}

/** Day of week (0 = Sunday) of a calendar date. */
export const weekday = (ymd: string) => dateOnly(ymd).getUTCDay()

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Wall-clock minutes since local midnight for an instant. */
export function localMinutes(d: Date, tz: string) {
  const z = toZonedTime(d, tz)
  return z.getHours() * 60 + z.getMinutes()
}

/** First and last calendar day of a 'YYYY-MM' month. */
export function monthBounds(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const first = `${ym}-01`
  const last = ymdOf(new Date(Date.UTC(y, m, 0)))
  return { first, last }
}

export function eachDay(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) out.push(d)
  return out
}
