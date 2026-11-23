import type { Status } from '@prisma/client'
import { prisma, type Db } from '../db.js'

/** Status lookups used everywhere. Small table, so it is read fresh (cheap) to respect Admin edits. */
export async function allStatuses(db: Db = prisma): Promise<Status[]> {
  return db.status.findMany({ orderBy: { order: 'asc' } })
}
export async function statusIdsBy(db: Db, cat: Status['category'] | Status['category'][]) {
  const cats = Array.isArray(cat) ? cat : [cat]
  return (await db.status.findMany({ where: { category: { in: cats } }, select: { id: true } })).map((s) => s.id)
}
/** "Open lead" = current status category OPEN (§ words used). */
export const openStatusIds = (db: Db = prisma) => statusIdsBy(db, 'OPEN')
/** "Fresh lead" = assigned and still in the starting status `NEW`. */
export async function newStatusId(db: Db = prisma) {
  const s = await db.status.findUnique({ where: { key: 'NEW' } })
  if (!s) throw new Error('Status NEW is missing; run the seed')
  return s.id
}
