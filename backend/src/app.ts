import express, { type Request, type Response, type NextFunction } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { Prisma } from '@prisma/client'
import { env } from './config/env.js'
import { AppError } from './lib/errors.js'
import { requireAuth } from './modules/auth/middleware.js'
import { authRouter } from './modules/auth/routes.js'
import { usersRouter } from './modules/users/routes.js'
import { teamsRouter } from './modules/teams/routes.js'
import { configRouter } from './modules/config/routes.js'
import { leadsRouter } from './modules/leads/routes.js'
import { importsRouter } from './modules/imports/routes.js'
import { allocationRouter } from './modules/allocation/routes.js'
import { workRouter } from './modules/work/routes.js'
import { followUpsRouter } from './modules/followups/routes.js'
import { attendanceRouter } from './modules/attendance/routes.js'
import { notificationsRouter } from './modules/notifications/routes.js'
import { dashboardRouter } from './modules/metrics/routes.js'
import { reportsRouter } from './modules/reports/routes.js'
import { financeRouter } from './modules/finance/routes.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  // bigint (paise) → number in every JSON response
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
  app.use('/api/auth', authRouter)

  // Everything below needs a signed-in, active user. Permissions are checked per route (§2).
  const api = express.Router()
  api.use(requireAuth)
  api.use('/users', usersRouter)
  api.use('/teams', teamsRouter)
  api.use('/', configRouter)
  api.use('/leads', leadsRouter)
  api.use('/imports', importsRouter)
  api.use('/allocation', allocationRouter)
  api.use('/', workRouter)
  api.use('/follow-ups', followUpsRouter)
  api.use('/attendance', attendanceRouter)
  api.use('/', notificationsRouter)
  api.use('/', dashboardRouter)
  api.use('/reports', reportsRouter)
  api.use('/finance', financeRouter)
  app.use('/api', api)

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } }))
  app.use(errorHandler)
  return app
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'This already exists', details: err.meta } })
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  }
  const e = err as { type?: string; code?: string; message?: string; status?: number }
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } })
  if (e?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'File is too large' } })
  console.error(err)
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server' } })
}
