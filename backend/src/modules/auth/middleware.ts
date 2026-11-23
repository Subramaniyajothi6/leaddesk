import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../../db.js'
import { unauthorized, forbidden } from '../../lib/errors.js'
import { verifyAccess } from './tokens.js'

/**
 * Every API request: valid access token AND the user is still ACTIVE AND the token version matches.
 * Deactivating a user or changing their password bumps token_version, which ends all sessions at once (§12.2).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : typeof req.query.access_token === 'string' && req.path.endsWith('/events') ? req.query.access_token : null
  if (!token) return next(unauthorized())
  let claims
  try { claims = verifyAccess(token) } catch { return next(unauthorized('Session expired, sign in again')) }
  const u = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, role: true, name: true, state: true, tokenVersion: true, mustChangePassword: true } })
  if (!u || u.state !== 'ACTIVE' || u.tokenVersion !== claims.tv) return next(unauthorized('Session ended, sign in again'))
  req.user = { id: u.id, role: u.role, name: u.name, mustChangePassword: u.mustChangePassword }
  // First login: only the password change (and reading who I am) is allowed (§12.1).
  if (u.mustChangePassword && !['/auth/change-password', '/auth/me', '/auth/logout'].some((p) => req.originalUrl.includes(p))) {
    return next(forbidden('Change your password first'))
  }
  next()
}
