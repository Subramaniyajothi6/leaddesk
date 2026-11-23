import { z } from 'zod'
import { prisma, type Db } from '../db.js'
import { audit } from './audit.js'
import { badRequest } from './errors.js'

/**
 * Every business rule marked *(setting)* in SYSTEM-DESIGN.md §13 lives here with its default.
 * Stored as one row per group in `settings`; a stored value is deep-merged over the defaults,
 * so adding a new setting never needs a data migration.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

export const settingSchemas = {
  company: z.object({
    name: z.string().min(1),
    timeZone: z.string().min(1),
    country: z.string().length(2),
    currency: z.string().length(3),
    labels: z.object({ lead: z.string(), leads: z.string() }),
  }),
  allocation: z.object({
    stage1Method: z.enum(['EQUAL', 'CAPACITY', 'MANUAL']),
    maxOpen: z.number().int().min(1),
    maxPerDay: z.number().int().min(1),
    weights: z.object({ load: z.number().min(0), match: z.number().min(0), perf: z.number().min(0) }),
    perfWindowDays: z.number().int().min(1),
    perfMinLeads: z.number().int().min(0),
    punchInRequired: z.boolean(),
    lowLeadMark: z.number().int().min(0),
    refillSize: z.number().int().min(1),
    autoReturnOnExit: z.boolean(),
    matching: z.object({
      enabled: z.boolean(),
      fields: z.array(z.object({ key: z.string(), mode: z.enum(['prefer', 'must']) })),
    }),
  }),
  leads: z.object({
    duplicateRule: z.enum(['PHONE', 'EMAIL', 'PHONE_OR_EMAIL']),
    trashDays: z.number().int().min(1),
    maxUploadMb: z.number().min(1).max(50),
  }),
  calls: z.object({ leaveOutCalledToday: z.boolean(), wrapUpSec: z.number().int().min(0) }),
  automation: z.object({
    firstCall: z.object({ on: z.boolean(), minutes: z.number().int().min(1) }),
    nextStep: z.object({ on: z.boolean() }),
    keepMoving: z.object({ on: z.boolean() }),
  }),
  recycling: z.object({
    maxAttempts: z.number().int().min(1),
    minSpreadHours: z.number().min(0),
    maxRecycles: z.number().int().min(0),
  }),
  followUps: z.object({ reminderMinutes: z.number().int().min(0) }),
  attendance: z.object({
    shiftStart: hhmm,
    shiftEnd: hhmm,
    weekOffs: z.array(z.number().int().min(0).max(6)),
    graceLateMin: z.number().int().min(0),
    graceEarlyMin: z.number().int().min(0),
    fullDayMin: z.number().int().min(1),
    halfDayMin: z.number().int().min(1),
    absentCutoffMin: z.number().int().min(0),
    autoCloseAt: hhmm,
    missingPunchOutCounts: z.enum(['HALF_DAY', 'PRESENT', 'ABSENT']),
    officeIps: z.array(z.string()),
    captureLocation: z.boolean(),
    tlCanCorrect: z.boolean(),
    tlPunch: z.boolean(),
  }),
  performance: z.object({
    periodRule: z.enum(['COHORT', 'ACTIVITY']),
    redBelowPct: z.number().min(0).max(100),
    leaderboardVisibleTo: z.array(z.enum(['ADMIN', 'TEAM_LEAD', 'BDE'])),
  }),
  reports: z.object({ tlCanExport: z.boolean(), bdeCanExportSummary: z.boolean() }),
  finance: z.object({
    companyShareBp: z.number().int().min(0).max(10_000),
    unpaidReminderDays: z.number().int().min(1),
    tlCanRecordPayments: z.boolean(),
  }),
} as const

export type SettingGroup = keyof typeof settingSchemas
export type Settings = { [K in SettingGroup]: z.infer<(typeof settingSchemas)[K]> }

export const DEFAULTS: Settings = {
  company: { name: 'My Company', timeZone: 'Asia/Kolkata', country: 'IN', currency: 'INR', labels: { lead: 'Lead', leads: 'Leads' } },
  allocation: {
    stage1Method: 'EQUAL', maxOpen: 50, maxPerDay: 40, weights: { load: 60, match: 25, perf: 15 },
    perfWindowDays: 30, perfMinLeads: 20, punchInRequired: true, lowLeadMark: 0, refillSize: 20,
    autoReturnOnExit: true, matching: { enabled: false, fields: [] },
  },
  leads: { duplicateRule: 'PHONE_OR_EMAIL', trashDays: 30, maxUploadMb: 10 },
  calls: { leaveOutCalledToday: true, wrapUpSec: 5 },
  automation: { firstCall: { on: true, minutes: 30 }, nextStep: { on: true }, keepMoving: { on: true } },
  recycling: { maxAttempts: 3, minSpreadHours: 24, maxRecycles: 2 },
  followUps: { reminderMinutes: 15 },
  attendance: {
    shiftStart: '09:30', shiftEnd: '18:30', weekOffs: [0], graceLateMin: 10, graceEarlyMin: 10,
    fullDayMin: 480, halfDayMin: 240, absentCutoffMin: 120, autoCloseAt: '23:59',
    missingPunchOutCounts: 'HALF_DAY', officeIps: [], captureLocation: false, tlCanCorrect: true, tlPunch: false,
  },
  performance: { periodRule: 'COHORT', redBelowPct: 60, leaderboardVisibleTo: ['ADMIN', 'TEAM_LEAD', 'BDE'] },
  reports: { tlCanExport: true, bdeCanExportSummary: true },
  finance: { companyShareBp: 3000, unpaidReminderDays: 7, tlCanRecordPayments: true },
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v
  return out as T
}

let cache: { at: number; value: Settings } | null = null
const TTL_MS = 5_000

export async function getSettings(db: Db = prisma): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS && db === prisma) return cache.value
  const rows = await db.setting.findMany()
  const value = structuredClone(DEFAULTS) as Settings
  for (const r of rows) {
    if (r.key in value) (value as Record<string, unknown>)[r.key] = deepMerge(value[r.key as SettingGroup], r.value)
  }
  if (db === prisma) cache = { at: Date.now(), value }
  return value
}

export async function getSetting<K extends SettingGroup>(group: K, db: Db = prisma): Promise<Settings[K]> {
  return (await getSettings(db))[group]
}

export function clearSettingsCache() {
  cache = null
}

/** Partial update of one group; validated against the full schema, audited. */
export async function updateSetting(group: string, patch: unknown, actorId: number, ip?: string) {
  if (!(group in settingSchemas)) throw badRequest(`Unknown settings group: ${group}`)
  const g = group as SettingGroup
  const current = await getSetting(g)
  const next = deepMerge(current, patch)
  const r = settingSchemas[g].safeParse(next)
  if (!r.success) throw badRequest('Some settings are not valid', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  if (g === 'company') {
    try { new Intl.DateTimeFormat('en', { timeZone: (r.data as Settings['company']).timeZone }) } catch { throw badRequest('Unknown time zone') }
  }
  if (g === 'attendance') {
    const a = r.data as Settings['attendance']
    if (a.halfDayMin > a.fullDayMin) throw badRequest('Half-day minimum cannot be more than the full-day minimum')
  }
  await prisma.$transaction(async (t) => {
    await t.setting.upsert({ where: { key: g }, create: { key: g, value: r.data as object, updatedBy: actorId }, update: { value: r.data as object, updatedBy: actorId, updatedAt: new Date() } })
    await audit(t, { actorId, action: 'SETTINGS_CHANGE', entity: 'settings', entityId: g, before: current, after: r.data, ip })
  })
  clearSettingsCache()
  return r.data
}
