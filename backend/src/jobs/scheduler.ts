import { prisma } from '../db.js'
import { getSettings } from '../lib/settings.js'
import { localDate, localMinutes, minutesOf } from '../lib/time.js'
import * as tasks from './tasks.js'

/**
 * A small scheduler (instead of a queue library): checks every minute what is due.
 * Each run claims a unique slot row first, so with several servers a job slot still runs once.
 */
type Job = { name: string; due: (localMin: number, s: Awaited<ReturnType<typeof getSettings>>) => string | null; run: () => Promise<unknown> }

const at = (hhmm: string) => (m: number) => (m === minutesOf(hhmm) ? hhmm : null)
const inShift = (m: number, s: Awaited<ReturnType<typeof getSettings>>) => m >= minutesOf(s.attendance.shiftStart) && m <= minutesOf(s.attendance.shiftEnd)

const jobs: Job[] = [
  { name: 'reminders', due: (m) => String(m), run: tasks.followUpReminders },
  { name: 'absent-check', due: (m, s) => (m === minutesOf(s.attendance.shiftStart) + s.attendance.absentCutoffMin ? 'cutoff' : null), run: tasks.absentTodayCheck },
  { name: 'close-punch-outs', due: (m, s) => at(s.attendance.autoCloseAt)(m), run: tasks.closeMissingPunchOuts },
  { name: 'finalize-day', due: at('00:30'), run: tasks.finalizeYesterday },
  { name: 'low-leads', due: (m, s) => (inShift(m, s) && m % 15 === 0 ? String(m) : null), run: tasks.lowLeadSweep },
  { name: 'recycling', due: (m) => (m % 60 === 5 ? String(m) : null), run: tasks.recyclingSweep },
]

async function claim(job: string, slot: string) {
  const key = `_job:${job}:${slot}`
  const r = await prisma.setting.createMany({ data: [{ key, value: { at: new Date().toISOString() } }], skipDuplicates: true })
  return r.count === 1
}

async function tick() {
  const s = await getSettings()
  const now = new Date()
  const m = localMinutes(now, s.company.timeZone)
  const day = localDate(now, s.company.timeZone)
  for (const j of jobs) {
    const slot = j.due(m, s)
    if (slot == null) continue
    try {
      if (!(await claim(j.name, `${day}:${slot}`))) continue
      const r = await j.run()
      if (process.env.JOB_LOG) console.log(`[job] ${j.name}`, r)
    } catch (e) { console.error(`[job] ${j.name} failed`, e) }
  }
  // tidy claim rows older than 2 days, once an hour
  if (m % 60 === 0) await prisma.setting.deleteMany({ where: { key: { startsWith: '_job:' }, updatedAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } }).catch(() => {})
}

let timer: NodeJS.Timeout | null = null
export function startJobs() {
  if (timer || process.env.NODE_ENV === 'test') return
  const loop = () => { void tick().catch((e) => console.error('[jobs]', e)) }
  timer = setInterval(loop, 60_000 - (Date.now() % 60_000) > 0 ? 60_000 : 60_000)
  loop()
}
export function stopJobs() { if (timer) clearInterval(timer); timer = null }
