import { describe, it, expect, beforeAll } from 'vitest'
import { resetDb, makeUser, login, as, prisma, easySettings } from '../helpers.js'
import { checkLowLeads } from '../../src/modules/allocation/service.js'
import { distributeRecycled } from '../../src/jobs/tasks.js'
import { updateSetting, clearSettingsCache } from '../../src/lib/settings.js'
import { localDate, addDaysYmd, atLocal } from '../../src/lib/time.js'

let adminId: number, adminT: string, tlT: string, p1T: string, p2T: string
let team: number, p1: number, p2: number
const S = (key: string) => prisma.status.findUniqueOrThrow({ where: { key } })
const outcome = (label: string) => prisma.callOutcome.findUniqueOrThrow({ where: { label } })
const lead = (id: number) => prisma.lead.findUniqueOrThrow({ where: { id } })
let mine: number[] = []

beforeAll(async () => {
  await resetDb()
  const admin = await makeUser('ADMIN'); adminId = admin.id; adminT = await login(admin.email)
  await easySettings(admin.id)
  // The first-call follow-up is due 30 min after assignment during working hours. "Keep it moving" would then
  // ask for a next follow-up on every call, depending on the clock. It gets its own test below.
  await updateSetting('automation', { keepMoving: { on: false } }, admin.id); clearSettingsCache()
  team = (await prisma.team.create({ data: { name: 'Work' } })).id
  const tl = await makeUser('TEAM_LEAD', 'Rahul'); await prisma.teamLeadLink.create({ data: { teamId: team, userId: tl.id } }); tlT = await login(tl.email)
  const u1 = await makeUser('BDE', 'Priya', { teamId: team }); p1 = u1.id; p1T = await login(u1.email)
  const u2 = await makeUser('BDE', 'Arun', { teamId: team }); p2 = u2.id; p2T = await login(u2.email)
  const st = await S('NEW')
  for (let i = 0; i < 14; i++) await prisma.lead.create({ data: { name: `Work ${i}`, phoneE164: `+91981000${String(1000 + i)}`, statusId: st.id, teamId: team } })
  const r = await as(tlT).post('/api/allocation/distribute').send({ teamId: team, method: 'EQUAL', count: 10 })
  expect(r.body.given).toBe(10)
  mine = (await prisma.lead.findMany({ where: { ownerId: p1 }, orderBy: { id: 'asc' }, select: { id: true } })).map((l) => l.id)
}, 300_000)

describe('status changes (§7.3)', () => {
  it('refuses a change that is not allowed', async () => {
    const l = await lead(mine[0])
    const r = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'CONVERTED' })
    expect(r.status).toBe(422)
    expect(r.body.error.message).toBe('New → Converted is not allowed')
  })
  it('a not-answered call adds an attempt and leaves the status alone (§8.1)', async () => {
    const l = await lead(mine[0])
    const no = await outcome('No answer')
    const r = await as(p1T).post(`/api/leads/${l.id}/calls`).send({ version: l.version, outcomeId: no.id, durationSec: 0 })
    expect(r.status).toBe(201)
    expect(r.body.statusChanged).toBe(false)
    expect(r.body.lead.attemptCount).toBe(1)
    expect(r.body.lead.status.key).toBe('NEW')
    const bad = await as(p1T).post(`/api/leads/${l.id}/calls`).send({ version: r.body.lead.version, outcomeId: no.id, statusId: (await S('CONTACTED')).id })
    expect(bad.status).toBe(422)
  })
  it('an answered call may change the status; a stale version is refused (§7.3 rule 6)', async () => {
    const l = await lead(mine[1])
    const ans = await outcome('Answered')
    const ok = await as(p1T).post(`/api/leads/${l.id}/calls`).send({ version: l.version, outcomeId: ans.id, durationSec: 190, statusId: (await S('CONTACTED')).id, remarks: 'Spoke briefly' })
    expect(ok.status).toBe(201)
    expect(ok.body.lead.status.key).toBe('CONTACTED')
    const stale = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'INTERESTED' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.message).toMatch(/was changed by .*Reload/)
  })
  it('Interested books its follow-up automatically (Next step rule, §8.2)', async () => {
    const l = await lead(mine[1])
    const r = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'INTERESTED' })
    expect(r.status).toBe(200)
    expect(r.body.autoFollowUp).toBe(true)
    expect(r.body.lead.nextFollowUpAt).not.toBeNull()
  })
  it('with the rule off, a status that needs a follow-up must have one', async () => {
    await updateSetting('automation', { nextStep: { on: false } }, adminId); clearSettingsCache()
    const l = await lead(mine[1])
    const r = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'FOLLOW_UP' })
    expect(r.status).toBe(422)
    expect(r.body.error.details).toEqual({ needsFollowUp: true })
    const due = new Date(Date.now() + 26 * 3600_000).toISOString()
    const ok = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'FOLLOW_UP', followUp: { dueAt: due, type: 'MEETING', reason: 'Demo at office' } })
    expect(ok.status).toBe(200)
    await updateSetting('automation', { nextStep: { on: true } }, adminId); clearSettingsCache()
  })
  it('required fields block Converted until filled (§15.1 #5), and close open follow-ups', async () => {
    await as(adminT).put('/api/custom-fields/course').send({ label: 'Course', type: 'text' })
    const conv = await S('CONVERTED')
    await as(adminT).patch(`/api/statuses/${conv.id}`).send({ requiredFields: ['course'] })
    let l = await lead(mine[1])
    const no = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'CONVERTED' })
    expect(no.status).toBe(422)
    expect(no.body.error.message).toBe('Fill Course before setting Converted')
    l = await lead(mine[1])
    const ok = await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'CONVERTED', fields: { course: 'MBA' }, remarks: 'Paid next week' })
    expect(ok.status).toBe(200)
    expect(await prisma.followUp.count({ where: { leadId: l.id, state: 'PENDING' } })).toBe(0)
    const h = await prisma.statusHistory.findFirstOrThrow({ where: { leadId: l.id, toStatusId: conv.id } })
    expect(h.ownerId).toBe(p1) // conversion credited to the owner at that moment (§9.1)
  })
  it('only a Team Lead or Admin reopens a final status, with a reason', async () => {
    const l = await lead(mine[1])
    expect((await as(p1T).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'FOLLOW_UP', followUp: { dueAt: new Date(Date.now() + 86_400_000).toISOString() } })).status).toBe(422)
    expect((await as(tlT).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'INTERESTED' })).status).toBe(422)
    const ok = await as(tlT).post(`/api/leads/${l.id}/status`).send({ version: l.version, statusKey: 'INTERESTED', remarks: 'Customer asked to restart' })
    expect(ok.status).toBe(200)
    expect(ok.body.reopen).toBe(true)
    expect(await prisma.auditLog.count({ where: { action: 'STATUS_REOPEN' } })).toBe(1)
  })
  it('"Call back later" needs a time', async () => {
    const l = await lead(mine[2])
    const r = await as(p1T).post(`/api/leads/${l.id}/calls`).send({ version: l.version, outcomeId: (await outcome('Call back later')).id })
    expect(r.status).toBe(422)
  })
})

describe('Keep it moving (§8.2)', () => {
  it('finishing a due follow-up on an open lead asks for the next one, or a reason to skip', async () => {
    await updateSetting('automation', { keepMoving: { on: true } }, adminId); clearSettingsCache()
    const id = (await prisma.lead.findFirstOrThrow({ where: { ownerId: p2 }, orderBy: { id: 'asc' } })).id // Arun's lead, untouched by the other tests
    await prisma.followUp.updateMany({ where: { leadId: id, state: 'PENDING' }, data: { dueAt: new Date(Date.now() - 60_000) } }) // due now, any time of day
    const ans = await outcome('Answered')
    let l = await lead(id)
    const no = await as(p2T).post(`/api/leads/${id}/calls`).send({ version: l.version, outcomeId: ans.id, statusId: (await S('CONTACTED')).id })
    expect(no.status).toBe(422)
    expect(no.body.error.details).toEqual({ needsNextFollowUp: true })
    l = await lead(id)
    const ok = await as(p2T).post(`/api/leads/${id}/calls`).send({ version: l.version, outcomeId: ans.id, statusId: (await S('CONTACTED')).id, skipNextFollowUpReason: 'Will call us back' })
    expect(ok.status).toBe(201)
    await updateSetting('automation', { keepMoving: { on: false } }, adminId); clearSettingsCache()
  })
})

describe('recycling (§7.3 rule 4)', () => {
  it('3 failed attempts spread over 24 h → back to the pool as fresh, never to the same BDE again', async () => {
    const id = mine[3]
    const no = await outcome('Busy')
    for (let i = 0; i < 2; i++) { const l = await lead(id); await as(p1T).post(`/api/leads/${id}/calls`).send({ version: l.version, outcomeId: no.id }) }
    await prisma.lead.update({ where: { id }, data: { firstAttemptAt: new Date(Date.now() - 25 * 3600_000) } })
    const l = await lead(id)
    const r = await as(p1T).post(`/api/leads/${id}/calls`).send({ version: l.version, outcomeId: no.id })
    expect(r.body.recycle).toBe('recycled')
    const after = await lead(id)
    expect(after).toMatchObject({ ownerId: null, recycleCount: 1, attemptCount: 0 })
    expect((await prisma.status.findUniqueOrThrow({ where: { id: after.statusId } })).key).toBe('NEW')
    await distributeRecycled(team)
    expect((await lead(id)).ownerId).toBe(p2)
  })
  it('after the max recycles the lead becomes Lost', async () => {
    const id = mine[4]
    await prisma.lead.update({ where: { id }, data: { recycleCount: 2, attemptCount: 2, firstAttemptAt: new Date(Date.now() - 30 * 3600_000) } })
    const l = await lead(id)
    const r = await as(p1T).post(`/api/leads/${id}/calls`).send({ version: l.version, outcomeId: (await outcome('Switched off')).id })
    expect(r.body.recycle).toBe('lost')
  })
})

describe('follow-ups (§8)', () => {
  it('lists tabs, reschedules, cancels with a reason; quick picks skip holidays', async () => {
    const id = mine[2]
    const tomorrow = addDaysYmd(localDate(new Date(), 'Asia/Kolkata'), 1)
    await as(adminT).put(`/api/holidays/${tomorrow}`).send({ name: 'Test holiday' })
    const qp = await as(p1T).get('/api/follow-ups/quick-picks')
    const t = qp.body.find((x: { label: string }) => x.label === 'Tomorrow 11:00')
    expect(localDate(new Date(t.at), 'Asia/Kolkata')).not.toBe(tomorrow)
    const f = await as(p1T).post(`/api/follow-ups/lead/${id}`).send({ dueAt: new Date(Date.now() - 60_000 + 3600_000).toISOString(), type: 'WHATSAPP' })
    expect(f.status).toBe(201)
    const list = await as(p1T).get('/api/follow-ups?tab=all&type=WHATSAPP')
    expect(list.body.rows.some((x: { id: number }) => x.id === f.body.id)).toBe(true)
    expect(list.body.rows[0].lead.phone).toMatch(/X/)
    expect((await as(p1T).patch(`/api/follow-ups/${f.body.id}`).send({ dueAt: atLocal(addDaysYmd(tomorrow, 2), '10:00', 'Asia/Kolkata').toISOString() })).status).toBe(200)
    expect((await as(p1T).patch(`/api/follow-ups/${f.body.id}`).send({ cancelReason: 'Customer travelling' })).status).toBe(200)
    expect((await as(p2T).patch(`/api/follow-ups/${f.body.id}`).send({ cancelReason: 'x' })).status).toBe(404)
  })
  it('next-to-call queue: overdue → due today → fresh', async () => {
    const r = await as(p2T).get('/api/me/queue')
    expect(r.status).toBe(200)
    expect(r.body.queue.length).toBeGreaterThan(0)
  })
  it('timeline shows assignment, calls and status changes; WhatsApp fills the template', async () => {
    const d = await as(p1T).get(`/api/leads/${mine[1]}`)
    const kinds = new Set(d.body.timeline.map((x: { kind: string }) => x.kind))
    for (const k of ['assignment', 'call', 'status']) expect(kinds.has(k)).toBe(true)
    const tpl = await prisma.messageTemplate.findFirstOrThrow()
    const w = await as(p1T).post(`/api/leads/${mine[2]}/whatsapp`).send({ templateId: tpl.id })
    expect(w.body.link).toMatch(/^https:\/\/wa\.me\/91\d+\?text=Hello%20Work/)
  })
})

describe('running out of leads (§5.5)', () => {
  it('alerts the Team Lead once a day; with auto-distribute on it refills from the pool', async () => {
    await updateSetting('allocation', { lowLeadMark: 100 }, adminId); clearSettingsCache()
    const a = await checkLowLeads(p2)
    expect(a.action).toBe('alerted')
    await checkLowLeads(p2)
    expect(await prisma.notification.count({ where: { type: 'NEEDS_LEADS' } })).toBe(1)
    await prisma.team.update({ where: { id: team }, data: { autoDistribute: true } })
    const before = await prisma.lead.count({ where: { ownerId: p2 } })
    const r = await checkLowLeads(p2)
    expect(r.action).toBe('refilled')
    expect(await prisma.lead.count({ where: { ownerId: p2 } })).toBeGreaterThan(before)
    expect(await prisma.allocationRun.count({ where: { method: 'AUTO_REFILL' } })).toBe(1)
    await updateSetting('allocation', { lowLeadMark: 0 }, adminId); clearSettingsCache()
  })
})

describe('attendance (§10)', () => {
  it('punch in once, punch out, Team Lead punching is off by default', async () => {
    const i = await as(p1T).post('/api/attendance/punch-in').send({})
    expect(i.status).toBe(201)
    expect((await as(p1T).post('/api/attendance/punch-in').send({})).status).toBe(409)
    const o = await as(p1T).post('/api/attendance/punch-out').send({})
    expect(o.status).toBe(200)
    expect(o.body.dayStatus).toBe('ABSENT') // a few seconds of work
    expect((await as(tlT).post('/api/attendance/punch-in').send({})).status).toBe(403)
  })
  it('correction request → Team Lead approves → status recalculated and audited', async () => {
    const y = addDaysYmd(localDate(new Date(), 'Asia/Kolkata'), -1)
    const req = await as(p2T).post('/api/attendance/corrections').send({ date: y, punchInAt: atLocal(y, '09:25', 'Asia/Kolkata').toISOString(), punchOutAt: atLocal(y, '18:40', 'Asia/Kolkata').toISOString(), reason: 'Phone battery died' })
    expect(req.status).toBe(201)
    expect((await as(p2T).post(`/api/attendance/corrections/${req.body.id}/decide`).send({ approve: true })).status).toBe(403)
    const ok = await as(tlT).post(`/api/attendance/corrections/${req.body.id}/decide`).send({ approve: true })
    expect(ok.status).toBe(200)
    expect(ok.body.attendance.dayStatus).toBe('PRESENT')
    expect(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CORRECT' } })).toBe(1)
    const me = await as(p2T).get(`/api/attendance/me?month=${y.slice(0, 7)}`)
    expect(me.body.days.find((d: { date: string }) => d.date === y).dayStatus).toBe('PRESENT')
  })
  it('time off makes a BDE not eligible for leads today', async () => {
    const today = localDate(new Date(), 'Asia/Kolkata')
    expect((await as(tlT).post('/api/attendance/time-off').send({ userId: p2, from: today, to: today })).status).toBe(201)
    const e = await as(tlT).get(`/api/allocation/eligibility?teamId=${team}`)
    expect(e.body.bdes.find((b: { userId: number }) => b.userId === p2).notEligibleToday).toBe('On leave')
  })
})
