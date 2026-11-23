import { describe, it, expect, beforeAll } from 'vitest'
import { resetDb, makeUser, login, as, prisma, request, app, PW } from '../helpers.js'

let admin: { id: number; email: string }, adminT: string
let teamA: number, teamB: number
let tlA: { id: number; email: string }, tlAT: string
let b1: { id: number; email: string }, b1T: string, b2T: string, bOtherT: string
let leadA1: number, leadA2: number, leadB: number

beforeAll(async () => {
  await resetDb()
  admin = await makeUser('ADMIN', 'Admin'); adminT = await login(admin.email)
  teamA = (await prisma.team.create({ data: { name: 'A' } })).id
  teamB = (await prisma.team.create({ data: { name: 'B' } })).id
  tlA = await makeUser('TEAM_LEAD', 'TL A'); await prisma.teamLeadLink.create({ data: { teamId: teamA, userId: tlA.id } }); tlAT = await login(tlA.email)
  b1 = await makeUser('BDE', 'B1', { teamId: teamA }); b1T = await login(b1.email)
  const b2 = await makeUser('BDE', 'B2', { teamId: teamA }); b2T = await login(b2.email)
  const bo = await makeUser('BDE', 'BO', { teamId: teamB }); bOtherT = await login(bo.email)
  const st = await prisma.status.findUniqueOrThrow({ where: { key: 'NEW' } })
  const mk = (phone: string, teamId: number, ownerId: number) => prisma.lead.create({ data: { name: 'L ' + phone, phoneE164: phone, statusId: st.id, teamId, ownerId } })
  leadA1 = (await mk('+919800000001', teamA, b1.id)).id
  leadA2 = (await mk('+919800000002', teamA, b2.id)).id
  leadB = (await mk('+919800000003', teamB, bo.id)).id
})

describe('sign in (§12.1–12.2)', () => {
  it('logs in by email or employee code and returns the user', async () => {
    const r = await request(app).post('/api/auth/login').send({ login: admin.email, password: PW })
    expect(r.status).toBe(200)
    expect(r.body.user.role).toBe('ADMIN')
    expect(r.headers['set-cookie']?.[0]).toMatch(/ld_refresh=.*HttpOnly/)
  })
  it('5 wrong passwords lock the account for 15 minutes', async () => {
    const u = await makeUser('BDE', 'Locky')
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ login: u.email, password: 'wrong' })
    const r = await request(app).post('/api/auth/login').send({ login: u.email, password: PW })
    expect(r.status).toBe(401)
    expect(r.body.error.message).toMatch(/Try again in \d+ min/)
  })
  it('first login forces a password change before anything else', async () => {
    const u = await makeUser('BDE', 'Newbie', { mustChange: true })
    const t = await login(u.email)
    expect((await as(t).get('/api/leads')).status).toBe(403)
    const weak = await as(t).post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'short' })
    expect(weak.status).toBe(400)
    const ok = await as(t).post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'Better1234' })
    expect(ok.status).toBe(200)
    expect((await as(ok.body.accessToken).get('/api/leads')).status).toBe(200)
    expect((await as(t).get('/api/leads')).status).toBe(401) // old session ended
  })
  it('deactivating a user ends their sessions immediately', async () => {
    const u = await makeUser('BDE', 'Leaver')
    const t = await login(u.email)
    expect((await as(t).get('/api/auth/me')).status).toBe(200)
    expect((await as(adminT).post(`/api/users/${u.id}/state`).send({ state: 'INACTIVE' })).status).toBe(200)
    expect((await as(t).get('/api/auth/me')).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ login: u.email, password: PW })).status).toBe(401)
  })
  it('no token → 401', async () => expect((await request(app).get('/api/leads')).status).toBe(401))
})

describe('permissions on the server (§2, §16)', () => {
  it('only Admin manages users, uploads, settings and finance', async () => {
    for (const t of [tlAT, b1T]) {
      expect((await as(t).post('/api/users').send({ empCode: 'X', name: 'X', email: 'x@x.com', role: 'BDE' })).status).toBe(403)
      expect((await as(t).post('/api/imports/preview')).status).toBe(403)
      expect((await as(t).patch('/api/settings/company').send({ name: 'Hack' })).status).toBe(403)
      expect((await as(t).get('/api/finance/dashboard')).status).toBe(403)
      expect((await as(t).post('/api/finance/calc/revenue-share').send({ revenue: 100 })).status).toBe(403)
      expect((await as(t).get('/api/audit')).status).toBe(403)
    }
  })
  it('a BDE sees only own leads, with masked numbers', async () => {
    const r = await as(b1T).get('/api/leads')
    expect(r.body.rows.map((l: { id: number }) => l.id)).toEqual([leadA1])
    expect(r.body.rows[0].phone).toBe('98XXXXX001')
    expect((await as(b1T).get(`/api/leads/${leadA2}`)).status).toBe(404)
    expect((await as(b2T).get(`/api/leads/${leadA1}`)).status).toBe(404)
  })
  it('a Team Lead sees own team leads with full numbers, never another team', async () => {
    const r = await as(tlAT).get('/api/leads')
    expect(r.body.rows.map((l: { id: number }) => l.id).sort()).toEqual([leadA1, leadA2])
    expect(r.body.rows[0].phone).toMatch(/^\+91/)
    expect((await as(tlAT).get(`/api/leads/${leadB}`)).status).toBe(404)
    expect((await as(tlAT).post('/api/allocation/distribute/preview').send({ teamId: teamB })).status).toBe(403)
  })
  it('revealing a full number is logged', async () => {
    const r = await as(b1T).post(`/api/leads/${leadA1}/reveal-phone`).send({ purpose: 'CALL' })
    expect(r.body.phone).toBe('+919800000001')
    const log = await prisma.auditLog.findFirst({ where: { action: 'PHONE_REVEAL', entityId: String(leadA1) } })
    expect(log?.actorId).toBe(b1.id)
  })
  it('the audit log cannot be changed, even directly in the database', async () => {
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow()
  })
  it('a BDE cannot see another team\'s data through reports', async () => {
    expect((await as(bOtherT).get(`/api/reports/lead-history?leadId=${leadA1}`)).status).toBe(403)
  })
})
