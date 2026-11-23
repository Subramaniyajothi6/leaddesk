import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../../db.js'
import { parse } from '../../lib/validate.js'
import { unauthorized, badRequest } from '../../lib/errors.js'
import { audit } from '../../lib/audit.js'
import { me, clientIp, ledTeamIds, teamOf } from '../../lib/access.js'
import { isProd } from '../../config/env.js'
import { signAccess, signRefresh, verifyRefresh, REFRESH_TTL_SEC, ACCESS_TTL_SEC } from './tokens.js'
import { requireAuth } from './middleware.js'

export const MAX_FAILED = 5
export const LOCK_MINUTES = 15
const COOKIE = 'ld_refresh'

export const hashPassword = (p: string) => bcrypt.hash(p, 10)

/** At least 8 characters with a letter and a number. */
export const passwordRule = z.string().min(8, 'At least 8 characters').regex(/[A-Za-z]/, 'Needs a letter').regex(/\d/, 'Needs a number')

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isProd ? 30 : 1000, standardHeaders: 'draft-7', legacyHeaders: false })

export const authRouter = Router()

function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: isProd, sameSite: isProd ? 'strict' : 'lax', maxAge: REFRESH_TTL_SEC * 1000, path: '/api/auth' })
}

async function session(userId: number) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const teams = u.role === 'TEAM_LEAD' ? await ledTeamIds(u.id) : u.role === 'BDE' ? [await teamOf(u.id)].filter(Boolean) : []
  return {
    accessToken: signAccess({ sub: u.id, tv: u.tokenVersion, role: u.role }),
    expiresIn: ACCESS_TTL_SEC,
    user: { id: u.id, name: u.name, email: u.email, empCode: u.empCode, role: u.role, mustChangePassword: u.mustChangePassword, teamIds: teams },
  }
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ login: z.string().min(1), password: z.string().min(1) }), req.body)
  const login = body.login.trim()
  const u = await prisma.user.findFirst({ where: { OR: [{ email: login.toLowerCase() }, { empCode: login }] } })
  const fail = async (msg = 'Wrong email / employee code or password') => {
    await audit(prisma, { actorId: u?.id ?? null, action: 'LOGIN_FAILED', entity: 'user', entityId: u?.id, after: { login }, ip: clientIp(req) })
    throw unauthorized(msg)
  }
  if (!u) return fail()
  if (u.state !== 'ACTIVE') return fail('This account is not active')
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    const mins = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000)
    return fail(`Too many wrong tries. Try again in ${mins} min`)
  }
  if (!(await bcrypt.compare(body.password, u.passwordHash))) {
    const failed = u.failedLogins + 1
    await prisma.user.update({
      where: { id: u.id },
      data: failed >= MAX_FAILED ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
    })
    return fail(failed >= MAX_FAILED ? `Too many wrong tries. Locked for ${LOCK_MINUTES} min` : undefined)
  }
  await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  await audit(prisma, { actorId: u.id, action: 'LOGIN', entity: 'user', entityId: u.id, ip: clientIp(req) })
  setRefreshCookie(res, signRefresh({ sub: u.id, tv: u.tokenVersion }))
  res.json(await session(u.id))
})

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[COOKIE] ?? req.body?.refreshToken
  if (!token) throw unauthorized()
  let c
  try { c = verifyRefresh(token) } catch { throw unauthorized('Session expired, sign in again') }
  const u = await prisma.user.findUnique({ where: { id: c.sub } })
  if (!u || u.state !== 'ACTIVE' || u.tokenVersion !== c.tv) throw unauthorized('Session ended, sign in again')
  setRefreshCookie(res, signRefresh({ sub: u.id, tv: u.tokenVersion }))
  res.json(await session(u.id))
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/api/auth' })
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json((await session(me(req).id)).user)
})

/** Also used for the forced first-login change. Ends other sessions (token version +1). */
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordRule }), req.body)
  const u = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } })
  if (!(await bcrypt.compare(body.currentPassword, u.passwordHash))) throw badRequest('Current password is wrong')
  if (body.currentPassword === body.newPassword) throw badRequest('Choose a new password different from the current one')
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, tokenVersion: { increment: 1 } },
  })
  await audit(prisma, { actorId: u.id, action: 'PASSWORD_CHANGE', entity: 'user', entityId: u.id, ip: clientIp(req) })
  setRefreshCookie(res, signRefresh({ sub: u.id, tv: updated.tokenVersion }))
  res.json(await session(u.id))
})
