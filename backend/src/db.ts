import { PrismaClient, Prisma } from '@prisma/client'
import './config/env.js'

export const prisma = new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] })
export type Tx = Prisma.TransactionClient
export type Db = PrismaClient | Tx
export { Prisma }

/** Interactive transaction with a generous timeout (the database is remote). */
export function tx<T>(fn: (t: Tx) => Promise<T>, opts: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {}) {
  return prisma.$transaction(fn, { timeout: opts.timeout ?? 60_000, maxWait: 20_000, isolationLevel: opts.isolationLevel })
}
