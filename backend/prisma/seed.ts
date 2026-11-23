/**
 * npm run db:seed            → default statuses, outcomes, sources and the first Admin
 * npm run db:seed -- --demo  → also demo teams, people and 300 leads (sample data, safe to remove)
 */
import crypto from 'node:crypto'
import { prisma } from '../src/db.js'
import { seedBase } from '../src/seed/base.js'
import { seedDemo } from '../src/seed/demo.js'
import { hashPassword } from '../src/modules/auth/routes.js'

async function main() {
  await seedBase(prisma)
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@leaddesk.local'
  if (!(await prisma.user.findFirst({ where: { role: 'ADMIN' } }))) {
    const password = process.env.SEED_ADMIN_PASSWORD || `Ld-${crypto.randomBytes(5).toString('hex')}7`
    await prisma.user.create({ data: { empCode: 'ADM-001', name: 'Admin', email, role: 'ADMIN', passwordHash: await hashPassword(password), mustChangePassword: true } })
    console.log(`First Admin created: ${email} / ${password} (must change on first login)`)
  }
  if (process.argv.includes('--demo')) console.log(await seedDemo(prisma))
  console.log('Seed done')
}

main().finally(() => prisma.$disconnect())
