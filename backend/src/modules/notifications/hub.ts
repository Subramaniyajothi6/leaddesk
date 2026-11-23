import type { Response } from 'express'

/** Server-Sent Events: one open stream per browser tab, keyed by user. */
const streams = new Map<number, Set<Response>>()

export function addStream(userId: number, res: Response) {
  let s = streams.get(userId)
  if (!s) streams.set(userId, (s = new Set()))
  s.add(res)
  return () => { s!.delete(res); if (!s!.size) streams.delete(userId) }
}

export function sendTo(userId: number, event: string, data: unknown) {
  const s = streams.get(userId)
  if (!s) return
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of s) r.write(payload)
}

export function broadcast(userIds: number[], event: string, data: unknown) {
  for (const id of new Set(userIds)) sendTo(id, event, data)
}
