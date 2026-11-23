import { describe, it, expect, beforeAll } from 'vitest'
import { resetDb, makeUser, login, as, prisma, easySettings } from '../helpers.js'
import { updateSetting, clearSettingsCache } from '../../src/lib/settings.js'

/**
 * Hand-calculated scenario (§16): 2 teams × 2 BDEs, 10 leads each.
 * B1 converts 3. B2 marks 1 Invalid (excluded). B3 converts 1; one of B3's untouched leads moves to B4.
 * Counted: B1 10, B2 9, B3 9, B4 11 → Team A 19 (3 conv, 15.8%), Team B 20 (1 conv, 5.0%), company 39 (4, 10.3%).
 */
let adminId: number, adminT: string, tlAT: string, tlBT: string
const T: Record<string, number> = {}
const U: Record<string, { id: number; t: string }> = {}
let convertedLead = 0

async function walk(t: string, id: number, keys: string[], fields?: object) {
  for (const k of keys) {
    const l = await prisma.lead.findUniqueOrThrow({ where: { id } })
    const r = await as(t).post(`/api/leads/${id}/status`).send({ version: l.version, statusKey: k, ...(k === 'CONVERTED' && fields ? { fields } : {}) })
    if (r.status !== 200) throw new Error(`${k}: ${JSON.stringify(r.body)}`)
  }
}

beforeAll(async () => {
  await resetDb()
  const admin = await makeUser('ADMIN'); adminId = admin.id; adminT = await login(admin.email)
  await easySettings(admin.id)
  await updateSetting('automation', { keepMoving: { on: false } }, admin.id); clearSettingsCache()
  for (const n of ['A', 'B']) T[n] = (await prisma.team.create({ data: { name: `Team ${n}` } })).id
  const tlA = await makeUser('TEAM_LEAD', 'TL A'); await prisma.teamLeadLink.create({ data: { teamId: T.A, userId: tlA.id } }); tlAT = await login(tlA.email)
  const tlB = await makeUser('TEAM_LEAD', 'TL B'); await prisma.teamLeadLink.create({ data: { teamId: T.B, userId: tlB.id } }); tlBT = await login(tlB.email)
  for (const [n, team] of [['B1', 'A'], ['B2', 'A'], ['B3', 'B'], ['B4', 'B']]) { const u = await makeUser('BDE', n, { teamId: T[team] }); U[n] = { id: u.id, t: await login(u.email) } }
  const st = await prisma.status.findUniqueOrThrow({ where: { key: 'NEW' } })
  const src = await prisma.leadSource.findFirstOrThrow({ where: { name: 'Referral' } })
  for (let i = 0; i < 40; i++) await prisma.lead.create({ data: { name: `M ${i}`, phoneE164: `+91982000${String(1000 + i)}`, statusId: st.id, sourceId: src.id } })
  expect((await as(adminT).post('/api/allocation/teams').send({ teamIds: [T.A, T.B], count: 40, method: 'EQUAL' })).status).toBe(201)
  expect((await as(tlAT).post('/api/allocation/distribute').send({ teamId: T.A, method: 'EQUAL' })).body.given).toBe(20)
  expect((await as(tlBT).post('/api/allocation/distribute').send({ teamId: T.B, method: 'EQUAL' })).body.given).toBe(20)
  const owned = async (u: string) => (await prisma.lead.findMany({ where: { ownerId: U[u].id }, orderBy: { id: 'asc' } })).map((l) => l.id)
  const b1 = await owned('B1'); const b2 = await owned('B2'); const b3 = await owned('B3')
  const path = ['CONTACTED', 'INTERESTED', 'CONVERTED']
  for (const id of b1.slice(0, 3)) await walk(U.B1.t, id, path)
  convertedLead = b1[0]
  await walk(U.B2.t, b2[0], ['INVALID'])
  await walk(U.B3.t, b3[0], path)
  expect((await as(tlBT).post('/api/allocation/assign').send({ leadIds: [b3[9]], userId: U.B4.id })).status).toBe(201)
}, 600_000)

describe('dashboards agree with the hand-calculated sheet (§9, §16)', () => {
  it('Admin dashboard', async () => {
    const r = await as(adminT).get('/api/dashboard/admin?period=month')
    expect(r.status).toBe(200)
    expect(r.body.kpis.conversions.value).toBe(4)
    expect(r.body.kpis.conversionPct).toMatchObject({ value: 10.3, counted: 39, rule: 'COHORT' })
    const teams = Object.fromEntries(r.body.teams.map((t: { team: string; counted: number; conversions: number; conversionPct: number }) => [t.team, [t.counted, t.conversions, t.conversionPct]]))
    expect(teams).toEqual({ 'Team A': [19, 3, 15.8], 'Team B': [20, 1, 5] })
    expect(r.body.sources.find((s: { source: string }) => s.source === 'Referral')).toMatchObject({ counted: 39, conversions: 4 })
    expect(r.body.funnel[0]).toMatchObject({ label: 'Uploaded' })
    expect(r.body.funnel.find((f: { label: string }) => f.label === 'Converted').count).toBe(4)
    expect(r.body.setup.items.find((i: { key: string }) => i.key === 'targets').done).toBe(false)
  })
  it('Team Lead dashboard: per-BDE numbers and the team total match', async () => {
    const r = await as(tlBT).get('/api/dashboard/team?period=month')
    expect(r.status).toBe(200)
    const rows = Object.fromEntries(r.body.bdes.map((b: { name: string; counted: number; conversions: number }) => [b.name, [b.counted, b.conversions]]))
    expect(rows).toEqual({ B3: [9, 1], B4: [11, 0] })
    expect(r.body.totals).toMatchObject({ counted: 20, conversions: 1, conversionPct: 5 })
    expect((await as(tlAT).get(`/api/dashboard/team?teamId=${T.B}`)).status).toBe(403)
  })
  it('BDE dashboard and leaderboard use the same numbers', async () => {
    const d = await as(U.B1.t).get('/api/dashboard/bde?period=month')
    expect(d.body.kpis).toMatchObject({ counted: 10, conversions: 3, conversionPct: 30 })
    expect(d.body.rank).toBe(1)
    const lb = await as(U.B4.t).get('/api/leaderboard?period=month')
    expect(lb.body.rows[0]).toMatchObject({ name: 'B1', conversions: 3, conversionPct: 30, rank: 1 })
    expect(lb.body.rows.find((x: { me: boolean }) => x.me).name).toBe('B4')
  })
  it('performance report = dashboard numbers', async () => {
    const r = await as(adminT).get('/api/reports/performance?period=month')
    const tot = r.body.rows.reduce((a: { c: number; v: number }, x: { counted: number; conversions: number }) => ({ c: a.c + x.counted, v: a.v + x.conversions }), { c: 0, v: 0 })
    expect(tot).toEqual({ c: 39, v: 4 })
    expect(r.body.footer.join(' ')).toMatch(/Cohort: leads assigned/)
  })
})

describe('finance (§11)', () => {
  let txn1 = 0
  it('a Team Lead records a payment only for a converted lead in their team → Pending', async () => {
    const notWon = await prisma.lead.findFirstOrThrow({ where: { ownerId: U.B1.id, status: { key: 'NEW' } } })
    expect((await as(tlAT).post('/api/finance/transactions').send({ leadId: notWon.id, amount: '50000', receivedOn: '2026-11-20' })).status).toBe(422)
    const other = await prisma.lead.findFirstOrThrow({ where: { ownerId: U.B3.id, status: { key: 'CONVERTED' } } })
    expect((await as(tlAT).post('/api/finance/transactions').send({ leadId: other.id, amount: '1000', receivedOn: '2026-11-20' })).status).toBe(403)
    const r = await as(tlAT).post('/api/finance/transactions').send({ leadId: convertedLead, amount: '50,000', method: 'UPI', referenceNo: 'UPI123', receivedOn: '2026-11-20' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ state: 'PENDING', amountPaise: 5_000_000 })
    txn1 = r.body.id
    const dash = await as(adminT).get('/api/dashboard/admin')
    expect(dash.body.actions.some((a: { kind: string }) => a.kind === 'PAYMENTS')).toBe(true)
  })
  it('Admin confirms: the company % is copied in; changing it later does not change old figures', async () => {
    const c = await as(adminT).post(`/api/finance/transactions/${txn1}/confirm`)
    expect(c.body).toMatchObject({ state: 'CONFIRMED', companyShareBp: 3000, companySharePaise: 1_500_000, remainingPaise: 3_500_000 })
    await as(adminT).patch('/api/settings/finance').send({ companyShareBp: 4000 })
    const again = await prisma.finTransaction.findUniqueOrThrow({ where: { id: txn1 } })
    expect(Number(again.companySharePaise)).toBe(1_500_000)
    expect((await as(adminT).post(`/api/finance/transactions/${txn1}/confirm`)).status).toBe(422)
    const inv = await as(adminT).post('/api/finance/transactions').send({ kind: 'INVESTMENT', amount: '20000', receivedOn: '2026-11-20' })
    await as(adminT).post(`/api/finance/transactions/${inv.body.id}/confirm`)
    const d = await as(adminT).get('/api/finance/dashboard?from=2026-11-01&to=2026-11-30')
    expect(d.body.cards).toMatchObject({ confirmedRevenuePaise: 5_000_000, companySharePaise: 1_500_000, investmentPaise: 2_000_000, profitPaise: 3_000_000 })
    expect((await as(adminT).post(`/api/finance/transactions/${txn1}/cancel`).send({})).status).toBe(400)
  })
  it('calculators save history that cannot be edited', async () => {
    const r = await as(adminT).post('/api/finance/calc/profit-share').send({ investment: '54000', revenue: '50000', companyPct: '30' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ resultPaise: null, note: 'Loss of ₹4,000.00, no profit to share' })
    const g = await as(adminT).post('/api/finance/calc/growth').send({ previous: 0, current: 5000 })
    expect(g.body.note).toBe('n/a (no previous value)')
    const h = await as(adminT).get('/api/finance/calculations?type=profit_share')
    expect(h.body.total).toBe(1)
    await expect(prisma.finCalculation.updateMany({ data: { note: 'x' } })).rejects.toThrow()
  })
})

describe('exports (§14)', () => {
  it('Excel, CSV and PDF carry the same report with a footer', async () => {
    const x = await as(adminT).get('/api/reports/performance?period=month&format=xlsx').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    expect(x.headers['content-type']).toMatch(/spreadsheetml/)
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK')
    const c = await as(adminT).get('/api/reports/performance?period=month&format=csv')
    expect(c.text).toMatch(/Cohort: leads assigned/)
    const p = await as(adminT).get('/api/reports/attendance?format=pdf').buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))) })
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF')
    expect(await prisma.auditLog.count({ where: { action: 'EXPORT' } })).toBe(3)
  })
  it('a BDE exports only their own summary, never lead data', async () => {
    const own = await as(U.B1.t).get('/api/reports/performance?format=csv')
    expect(own.status).toBe(200)
    expect(own.text.split('\n').filter((l) => l.startsWith('B')).length).toBe(1)
    expect((await as(U.B1.t).get(`/api/reports/lead-history?leadId=${convertedLead}`)).status).toBe(403)
    expect((await as(U.B1.t).get('/api/reports/finance')).status).toBe(403)
  })
})
