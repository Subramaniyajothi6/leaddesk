import request from 'supertest'
import { createApp } from '../src/app.js'
import { prisma } from '../src/db.js'
import { seedBase } from '../src/seed/base.js'
import { clearSettingsCache, updateSetting } from '../src/lib/settings.js'
import { clearHolidayCache } from '../src/lib/workdays.js'
import { hashPassword } from '../src/modules/auth/routes.js'

export const app = createApp()
export const PW = 'Test@1234'

/** Empty every table (the test database branch only) and load the defaults. */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes(process.env.TEST_DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '###')) throw new Error('Refusing to reset: not the test database')
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
  clearSettingsCache(); clearHolidayCache()
  await seedBase(prisma)
}

let n = 0
export async function makeUser(role: 'ADMIN' | 'TEAM_LEAD' | 'BDE', name?: string, o: { teamId?: number; mustChange?: boolean } = {}) {
  n++
  const u = await prisma.user.create({ data: { empCode: `T-${role}-${n}`, name: name ?? `${role} ${n}`, email: `u${n}-${Date.now()}@test.local`, role, passwordHash: await hashPassword(PW), mustChangePassword: o.mustChange ?? false, joinedOn: new Date('2026-01-01') } })
  if (o.teamId) await prisma.teamMembership.create({ data: { teamId: o.teamId, userId: u.id } })
  return u
}

export async function login(email: string, password = PW) {
  const r = await request(app).post('/api/auth/login').send({ login: email, password })
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.accessToken as string
}

export function as(token: string) {
  const h = (m: 'get' | 'post' | 'patch' | 'put' | 'delete') => (url: string) => request(app)[m](url).set('Authorization', `Bearer ${token}`)
  return { get: h('get'), post: h('post'), patch: h('patch'), put: h('put'), delete: h('delete') }
}

/** Working every day, no punch-in needed: tests must not depend on today being a Sunday. */
export async function easySettings(adminId: number) {
  await updateSetting('attendance', { weekOffs: [] }, adminId)
  await updateSetting('allocation', { punchInRequired: false }, adminId)
  clearSettingsCache()
}

export function csv(rows: (string | number)[][]) {
  return Buffer.from(rows.map((r) => r.join(',')).join('\n'))
}

export { prisma, request }
