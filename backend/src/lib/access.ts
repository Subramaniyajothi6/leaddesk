import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import { prisma, type Db } from '../db.js'
import { forbidden, notFound } from './errors.js'

export interface AuthUser {
  id: number
  role: Role
  name: string
  mustChangePassword: boolean
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export const me = (req: Request): AuthUser => {
  if (!req.user) throw forbidden()
  return req.user
}

/** Route guard: only these roles. Checked on the server for every request (§2 rule 1). */
export const allow = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden())
  next()
}

/** Teams a Team Lead currently leads. */
export async function ledTeamIds(userId: number, db: Db = prisma): Promise<number[]> {
  const links = await db.teamLeadLink.findMany({ where: { userId, toAt: null }, select: { teamId: true } })
  return links.map((l) => l.teamId)
}

/** Current team of a BDE (null if none). */
export async function teamOf(userId: number, db: Db = prisma): Promise<number | null> {
  const m = await db.teamMembership.findFirst({ where: { userId, toAt: null }, select: { teamId: true } })
  return m?.teamId ?? null
}

/**
 * The one scoping function for leads (§2 rule 1):
 * Admin → everything, Team Lead → leads of their teams, BDE → own leads only.
 */
export async function leadScope(u: AuthUser, db: Db = prisma) {
  if (u.role === 'ADMIN') return { deletedAt: null }
  if (u.role === 'TEAM_LEAD') return { deletedAt: null, teamId: { in: await ledTeamIds(u.id, db) } }
  return { deletedAt: null, ownerId: u.id }
}

/** Throws 404 (not 403, to avoid leaking existence) if the lead is outside the user's scope. */
export async function assertLeadAccess(u: AuthUser, leadId: number, db: Db = prisma) {
  const lead = await db.lead.findFirst({ where: { id: leadId, ...(await leadScope(u, db)) } })
  if (!lead) throw notFound('Lead')
  return lead
}

/** Team Lead may act on a team they lead; Admin on any team. */
export async function assertTeamAccess(u: AuthUser, teamId: number, db: Db = prisma) {
  if (u.role === 'ADMIN') return
  if (u.role === 'TEAM_LEAD' && (await ledTeamIds(u.id, db)).includes(teamId)) return
  throw forbidden('You can only act on your own teams')
}

/** Teams a user may see in team-level screens. */
export async function visibleTeamIds(u: AuthUser, db: Db = prisma): Promise<number[] | null> {
  if (u.role === 'ADMIN') return null // all
  if (u.role === 'TEAM_LEAD') return ledTeamIds(u.id, db)
  const t = await teamOf(u.id, db)
  return t ? [t] : []
}

export const clientIp = (req: Request) => (req.ip ?? '').replace('::ffff:', '') || null
