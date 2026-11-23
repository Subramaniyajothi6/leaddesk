import webpush from 'web-push'
import { prisma, type Db } from '../../db.js'
import { env } from '../../config/env.js'
import { sendTo } from './hub.js'

const pushOn = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
if (pushOn) webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)

export interface Note { type: string; title: string; body?: string; link?: string; dedupeKey?: string }

/**
 * Save an in-app notification, push it live (SSE) and as Web Push if the user subscribed.
 * `dedupeKey` makes it once-only (e.g. "needs-leads:12:2026-11-18" = once per BDE per day, §5.5).
 */
export async function notify(db: Db, userId: number, n: Note) {
  if (n.dedupeKey) {
    const exists = await db.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: n.dedupeKey } } })
    if (exists) return null
  }
  const row = await db.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey } })
  sendTo(userId, 'notification', row)
  if (pushOn) void pushTo(userId, n)
  return row
}

export async function notifyMany(db: Db, userIds: number[], n: Note) {
  for (const id of new Set(userIds)) await notify(db, id, n.dedupeKey ? { ...n, dedupeKey: `${n.dedupeKey}:${id}` } : n)
}

async function pushTo(userId: number, n: Note) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify({ title: n.title, body: n.body, link: n.link }))
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
    }
  }
}

export const vapidPublicKey = () => env.VAPID_PUBLIC_KEY || null

/** Admins, plus the Team Lead(s) of a team, or Admins when the team has no Team Lead (§2 rule 3). */
export async function teamLeadersOf(db: Db, teamId: number): Promise<number[]> {
  const links = await db.teamLeadLink.findMany({ where: { teamId, toAt: null, user: { state: 'ACTIVE' } }, select: { userId: true } })
  if (links.length) return links.map((l) => l.userId)
  const admins = await db.user.findMany({ where: { role: 'ADMIN', state: 'ACTIVE' }, select: { id: true } })
  return admins.map((a) => a.id)
}

export async function adminIds(db: Db): Promise<number[]> {
  return (await db.user.findMany({ where: { role: 'ADMIN', state: 'ACTIVE' }, select: { id: true } })).map((a) => a.id)
}
