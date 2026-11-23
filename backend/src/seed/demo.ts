import type { PrismaClient } from '@prisma/client'
import { hashPassword } from '../modules/auth/routes.js'

/**
 * Sample company for demos and the review: 3 teams, 3 Team Leads, 10 BDEs, 300 leads in the company pool.
 * All demo people share the password Demo@1234 and do not need to change it.
 * Safe to remove: everything has emp codes starting with DEMO-.
 */
export async function seedDemo(db: PrismaClient) {
  if (await db.user.findFirst({ where: { empCode: { startsWith: 'DEMO-' } } })) return 'Demo data already present'
  const pw = await hashPassword('Demo@1234')
  const mk = (empCode: string, name: string, role: 'ADMIN' | 'TEAM_LEAD' | 'BDE') =>
    db.user.create({ data: { empCode, name, email: `${empCode.toLowerCase()}@demo.leaddesk.local`, role, passwordHash: pw, mustChangePassword: false, joinedOn: new Date('2026-09-01') } })
  await mk('DEMO-ADM', 'Demo Admin', 'ADMIN')
  const teams = await Promise.all(['Team A', 'Team B', 'Team C'].map((name, i) => db.team.create({ data: { name, method: i === 1 ? 'EQUAL' : 'SMART' } })))
  const tls = [await mk('DEMO-TL1', 'Rahul S', 'TEAM_LEAD'), await mk('DEMO-TL2', 'Divya M', 'TEAM_LEAD'), await mk('DEMO-TL3', 'Karthik N', 'TEAM_LEAD')]
  for (const [i, t] of teams.entries()) await db.teamLeadLink.create({ data: { teamId: t.id, userId: tls[i].id } })
  const names = ['Priya K', 'Arun V', 'Meena R', 'Kavin T', 'Deepa S', 'Vikram N', 'Lakshmi P', 'Rohit M', 'Anu J', 'Farhan A']
  const bdes = []
  for (const [i, n] of names.entries()) {
    const u = await mk(`DEMO-B${String(i + 1).padStart(2, '0')}`, n, 'BDE')
    await db.teamMembership.create({ data: { teamId: teams[i < 4 ? 0 : i < 7 ? 1 : 2].id, userId: u.id } })
    bdes.push(u)
  }
  const sources = await db.leadSource.findMany()
  const status = await db.status.findUniqueOrThrow({ where: { key: 'NEW' } })
  const first = ['Karthik', 'Sneha', 'Ravi', 'Asha', 'Manoj', 'Divya', 'Suresh', 'Nisha', 'Ajay', 'Pooja', 'Gokul', 'Keerthi', 'Hari', 'Swetha', 'Vijay']
  const last = ['Raj', 'Prakash', 'Kumar', 'Iyer', 'Nair', 'Reddy', 'Shah', 'Menon', 'Das', 'Pillai']
  const batch = await db.importBatch.create({ data: { fileName: 'demo-leads.xlsx', uploadedBy: 0, totalRows: 300, accepted: 300, duplicates: 0, rejected: 0 } })
  await db.lead.createMany({
    data: Array.from({ length: 300 }, (_, i) => ({
      name: `${first[i % first.length]} ${last[(i * 7) % last.length]}`,
      phoneE164: `+9198${String(40000000 + i * 137).padStart(8, '0')}`,
      email: i % 3 ? `lead${i}@example.com` : null,
      sourceId: sources[i % sources.length].id, batchId: batch.id, statusId: status.id,
      score: [20, 0, 10, 5][i % 4], custom: { city: ['Chennai', 'Coimbatore', 'Madurai'][i % 3] },
    })),
  })
  return 'Demo data: 1 demo Admin (DEMO-ADM), 3 teams, 3 Team Leads (DEMO-TL1..3), 10 BDEs (DEMO-B01..10), 300 leads in the company pool. Password for all: Demo@1234'
}
