import { describe, it, expect, beforeAll } from 'vitest'
import { resetDb, makeUser, login, as, prisma, csv, easySettings } from '../helpers.js'

let adminT: string, adminId: number
const teams: number[] = []
const bdes: Record<string, number> = {}
let tlCT: string

beforeAll(async () => {
  await resetDb()
  const admin = await makeUser('ADMIN', 'Admin'); adminId = admin.id; adminT = await login(admin.email)
  await easySettings(admin.id)
  for (const n of ['A', 'B', 'C']) teams.push((await prisma.team.create({ data: { name: `Team ${n}` } })).id)
  for (const [i, n] of ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2'].entries()) bdes[n] = (await makeUser('BDE', n, { teamId: teams[i < 3 ? 0 : i < 5 ? 1 : 2] })).id
  const tlC = await makeUser('TEAM_LEAD', 'TL C'); await prisma.teamLeadLink.create({ data: { teamId: teams[2], userId: tlC.id } }); tlCT = await login(tlC.email)
})

describe('upload (§5.2) — 1,000-row file', () => {
  it('reads the file and suggests the mapping', async () => {
    const r = await as(adminT).post('/api/imports/preview').attach('file', csv([['Full Name', 'Mobile', 'Email', 'Source'], ['Asha', '9876543210', 'a@x.com', 'Website']]), 'leads.csv')
    expect(r.status).toBe(200)
    expect(r.body.suggestedMapping).toEqual({ name: 'Full Name', phone: 'Mobile', email: 'Email', source: 'Source' })
  })

  it('imports with correct counts: errors and duplicates are reported, not created', async () => {
    const st = await prisma.status.findUniqueOrThrow({ where: { key: 'NEW' } })
    const phone = (i: number) => `9${String(700_000_000 + i)}`
    for (let i = 60; i < 65; i++) await prisma.lead.create({ data: { name: `Existing ${i}`, phoneE164: `+91${phone(i)}`, statusId: st.id } })
    const rows: (string | number)[][] = [['Name', 'Phone', 'Email', 'Source']]
    for (let i = 0; i < 1000; i++) {
      const name = i >= 10 && i < 20 ? '' : `Lead ${i}`
      const ph = i < 10 ? 'abc' : i >= 40 && i < 60 ? phone(i - 20) : phone(i)
      rows.push([name, ph, i % 4 ? `lead${i}@ex.com` : '', ['Website', 'Referral', 'Walk-in', 'Campaign'][i % 4]])
    }
    const r = await as(adminT).post('/api/imports').attach('file', csv(rows), 'big.csv').field('mapping', JSON.stringify({ name: 'Name', phone: 'Phone', email: 'Email', source: 'Source' }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ totalRows: 1000, added: 955, duplicates: 25, rejected: 20 })
    expect(r.body.summary).toBe('1,000 rows: 955 added, 25 duplicates, 20 rejected')
    const file = await as(adminT).get(`/api/imports/${r.body.batchId}/rejects.csv?kind=ERROR`)
    expect(file.headers['content-type']).toMatch(/text\/csv/)
    expect(file.text).toContain('"Phone ""abc"" is not a valid number"') // CSV-escaped quotes
    expect(file.text).toContain('Name is missing')
    expect(await prisma.lead.count({ where: { batchId: r.body.batchId } })).toBe(955)
  }, 300_000)

  it('check before saving: same verdicts as the upload, grouped, and nothing is written', async () => {
    const st = await prisma.status.findUniqueOrThrow({ where: { key: 'NEW' } })
    await prisma.lead.create({ data: { name: 'Already here', phoneE164: '+919600000001', statusId: st.id } })
    const file = csv([['Name', 'Phone', 'Source'],
      ['Good One', '9600000010', 'Website'], ['Good Two', '9600000011', 'Referral'],
      ['Fb One', '9600000012', 'Facebook'], ['Fb Two', '9600000013', 'Facebook'],
      ['Bad Phone', '123', 'Website'], ['Old Lead', '9600000001', 'Website'], ['Again', '9600000010', 'Website']])
    const mapping = JSON.stringify({ name: 'Name', phone: 'Phone', source: 'Source' })
    const [leads, batches, audits] = await Promise.all([prisma.lead.count(), prisma.importBatch.count(), prisma.auditLog.count()])

    const r = await as(adminT).post('/api/imports/check').attach('file', file, 'check.csv').field('mapping', mapping)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ totalRows: 7, ready: 2, duplicates: 2, errors: 3 })
    expect(r.body.groups).toEqual([
      { reason: 'Source "Facebook" is not in the list of sources', kind: 'ERROR', count: 2 },
      { reason: 'Phone "123" is not a valid number', kind: 'ERROR', count: 1 },
      expect.objectContaining({ kind: 'DUPLICATE', count: 1 }), expect.objectContaining({ kind: 'DUPLICATE', count: 1 }),
    ])
    expect(r.body.rows.map((x: { rowNumber: number }) => x.rowNumber)).toEqual([4, 5, 6, 7, 8])
    expect(r.body.rows.find((x: { rowNumber: number }) => x.rowNumber === 7)).toMatchObject({ name: 'Old Lead', kind: 'DUPLICATE', existingLeadId: expect.any(Number) })
    expect([await prisma.lead.count(), await prisma.importBatch.count(), await prisma.auditLog.count()]).toEqual([leads, batches, audits])

    // The real upload then gives the same counts.
    const u = await as(adminT).post('/api/imports').attach('file', file, 'check.csv').field('mapping', mapping)
    expect(u.body).toMatchObject({ added: 2, duplicates: 2, rejected: 3 })
    expect(await as(tlCT).post('/api/imports/check').attach('file', file, 'check.csv').field('mapping', mapping).then((x) => x.status)).toBe(403)
  })

  it('refuses a file that is not CSV or Excel by its content', async () => {
    const r = await as(adminT).post('/api/imports/preview').attach('file', Buffer.from([0, 1, 2, 3, 0, 0]), 'fake.csv')
    expect(r.status).toBe(400)
  })
})

describe('allocation stage 1 (§5.3)', () => {
  it('previews, then 300 leads → 100 / 100 / 100', async () => {
    const body = { teamIds: teams, count: 300, method: 'EQUAL' }
    const p = await as(adminT).post('/api/allocation/teams/preview').send(body)
    expect(p.body.rows.map((r: { willReceive: number }) => r.willReceive)).toEqual([100, 100, 100])
    expect(await prisma.leadAssignment.count()).toBe(0) // preview saves nothing
    const r = await as(adminT).post('/api/allocation/teams').send(body)
    expect(r.status).toBe(201)
    for (const t of teams) expect(await prisma.lead.count({ where: { teamId: t, ownerId: null } })).toBe(100)
  }, 300_000)

  it('the extra lead rotates between teams', async () => {
    const a = await as(adminT).post('/api/allocation/teams').send({ teamIds: teams, count: 4, method: 'EQUAL' })
    const b = await as(adminT).post('/api/allocation/teams').send({ teamIds: teams, count: 4, method: 'EQUAL' })
    const got = (x: { body: { rows: { willReceive: number }[] } }) => x.body.rows.map((r) => r.willReceive)
    expect(got(a)).not.toEqual(got(b))
    expect(got(a).reduce((s: number, n: number) => s + n, 0)).toBe(4)
  }, 300_000)
})

describe('allocation stage 2 (§5.4, §5.7)', () => {
  it('Equal: 100 to 3 BDEs → 34 / 33 / 33, each assignment with its reason', async () => {
    const r = await as(adminT).post('/api/allocation/distribute').send({ teamId: teams[0], method: 'EQUAL', count: 100 })
    expect(r.status).toBe(201)
    expect(r.body.perBde.map((x: { get: number }) => x.get).sort()).toEqual([33, 33, 34])
    const a = await prisma.leadAssignment.findFirst({ where: { level: 'BDE', userId: bdes.A1 } })
    expect(a?.reason).toMatchObject({ method: 'EQUAL' })
    // first-call follow-up created automatically (§8.2)
    expect(await prisma.followUp.count({ where: { userId: bdes.A1, auto: true, reason: 'First call' } })).toBeGreaterThan(0)
  }, 300_000)

  it('two distributions at the same moment never assign one lead twice (§5.6)', async () => {
    const [x, y] = await Promise.all([
      as(adminT).post('/api/allocation/distribute').send({ teamId: teams[1], method: 'SMART', count: 40 }),
      as(adminT).post('/api/allocation/distribute').send({ teamId: teams[1], method: 'SMART', count: 40 }),
    ])
    expect([x.status, y.status]).toEqual([201, 201])
    const dupes = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT lead_id FROM lead_assignments WHERE level = 'BDE' AND ended_at IS NULL GROUP BY lead_id HAVING COUNT(*) > 1) d`
    expect(Number(dupes[0].n)).toBe(0)
    expect(x.body.given + y.body.given).toBe(80)
  }, 300_000)

  it('automatic never goes over a max; leftovers stay in the pool with the reason', async () => {
    await as(adminT).put('/api/limits').send({ scope: 'TEAM', scopeId: teams[2], maxOpen: 40, maxPerDay: 500 })
    const r = await as(tlCT).post('/api/allocation/distribute').send({ teamId: teams[2], method: 'SMART' })
    expect(r.body.given).toBe(80)
    expect(r.body.message).toMatch(/not given: Every eligible BDE is at their max/)
    expect(await prisma.lead.count({ where: { teamId: teams[2], ownerId: null } })).toBeGreaterThan(0)
  }, 300_000)

  it('manual may go over a max only with a typed reason, which is audited; then undo', async () => {
    const pool = await prisma.lead.findMany({ where: { teamId: teams[2], ownerId: null }, take: 3, select: { id: true } })
    const ids = pool.map((p) => p.id)
    const no = await as(tlCT).post('/api/allocation/assign').send({ leadIds: ids, userId: bdes.C1 })
    expect(no.status).toBe(422)
    expect(no.body.error.message).toBe('C1 will be at 43 / 40. Type a reason to go over the max.')
    const yes = await as(tlCT).post('/api/allocation/assign').send({ leadIds: ids, userId: bdes.C1, overMaxReason: 'Strong closer this week' })
    expect(yes.status).toBe(201)
    expect(yes.body).toMatchObject({ assigned: 3, overMax: true, loadAfter: '43/40' })
    expect(await prisma.auditLog.count({ where: { action: 'ASSIGN_OVER_MAX' } })).toBe(1)
    const ba = await prisma.bulkAction.findFirstOrThrow({ where: { runId: yes.body.runId } })
    const u = await as(tlCT).post(`/api/allocation/bulk/${ba.id}/undo`)
    expect(u.body).toMatchObject({ restored: 3, skipped: [] })
    expect(await prisma.lead.count({ where: { id: { in: ids }, ownerId: null } })).toBe(3)
    // history kept: the undone assignments are ended, not deleted
    expect(await prisma.leadAssignment.count({ where: { leadId: { in: ids }, level: 'BDE', endReason: 'UNDONE' } })).toBe(3)
  }, 300_000)

  it('an inactive BDE cannot get leads; history page lists the runs', async () => {
    await as(adminT).post(`/api/users/${bdes.B2}/state`).send({ state: 'INACTIVE' })
    const one = await prisma.lead.findFirstOrThrow({ where: { teamId: teams[1], ownerId: null } })
    const r = await as(adminT).post('/api/allocation/assign').send({ leadIds: [one.id], userId: bdes.B2 })
    expect(r.status).toBe(422)
    const runs = await as(tlCT).get('/api/allocation/runs')
    expect(runs.body.rows.every((x: { teamId: number | null }) => x.teamId === teams[2])).toBe(true)
  }, 300_000)
})
