import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { me } from '../../lib/access.js'
import { addStream } from './hub.js'
import { vapidPublicKey } from './service.js'

export const notificationsRouter = Router()

notificationsRouter.get('/notifications', async (req, res) => {
  const u = me(req)
  const unreadOnly = req.query.unread === 'true'
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: u.id, ...(unreadOnly && { readAt: null }) }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId: u.id, readAt: null } }),
  ])
  res.json({ unread, rows })
})

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  const id = parse(idParam, req.params.id)
  await prisma.notification.updateMany({ where: { id, userId: me(req).id, readAt: null }, data: { readAt: new Date() } })
  res.json({ ok: true })
})

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: me(req).id, readAt: null }, data: { readAt: new Date() } })
  res.json({ ok: true, count: r.count })
})

/** Live updates for the bell and dashboards (Server-Sent Events). The token may come as ?access_token= since EventSource can't send headers. */
notificationsRouter.get('/events', (req, res) => {
  const u = me(req)
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.write(`event: hello\ndata: ${JSON.stringify({ userId: u.id })}\n\n`)
  const off = addStream(u.id, res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => { clearInterval(ping); off() })
})

notificationsRouter.get('/push/public-key', (_req, res) => res.json({ key: vapidPublicKey() }))

notificationsRouter.post('/push/subscribe', async (req, res) => {
  const b = parse(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }), req.body)
  await prisma.pushSubscription.upsert({ where: { endpoint: b.endpoint }, create: { userId: me(req).id, endpoint: b.endpoint, keys: b.keys }, update: { userId: me(req).id, keys: b.keys } })
  res.status(201).json({ ok: true })
})

notificationsRouter.post('/push/unsubscribe', async (req, res) => {
  const b = parse(z.object({ endpoint: z.string().url() }), req.body)
  await prisma.pushSubscription.deleteMany({ where: { endpoint: b.endpoint, userId: me(req).id } })
  res.json({ ok: true })
})
