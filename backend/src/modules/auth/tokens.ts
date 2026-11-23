import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

export const ACCESS_TTL_SEC = 15 * 60
export const REFRESH_TTL_SEC = 14 * 24 * 3600

export interface AccessClaims { sub: number; tv: number; role: string }

export const signAccess = (c: AccessClaims) => jwt.sign(c, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SEC })
export const signRefresh = (c: { sub: number; tv: number }) => jwt.sign(c, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL_SEC })

export function verifyAccess(t: string): AccessClaims {
  const p = jwt.verify(t, env.JWT_ACCESS_SECRET) as unknown as AccessClaims
  return { sub: Number(p.sub), tv: Number(p.tv), role: String(p.role) }
}
export function verifyRefresh(t: string): { sub: number; tv: number } {
  const p = jwt.verify(t, env.JWT_REFRESH_SECRET) as unknown as { sub: number; tv: number }
  return { sub: Number(p.sub), tv: Number(p.tv) }
}
