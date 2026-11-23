import { Router } from 'express'
import { z } from 'zod'
import { Prisma, type CalcType } from '@prisma/client'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp, ledTeamIds } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound, forbidden, unprocessable } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { rupeesToPaise, percentToBp, split } from '../../lib/money.js'
import { localDate } from '../../lib/time.js'
import { revenueShare, profitShare, percentOf, discount, change, growth, type CalcResult } from './calc.js'
import { convertedUnpaid } from '../metrics/routes.js'
import { notify, adminIds } from '../notifications/service.js'

/** Finance is Admin only (§11.4); Team Leads may only record payments for their converted leads (setting). */
export const financeRouter = Router()

const amount = z.union([z.string(), z.number()]).transform((v, ctx) => { try { return rupeesToPaise(v) } catch { ctx.addIssue({ code: 'custom', message: 'Not a valid amount (max 2 decimals)' }); return z.NEVER } })
const percent = z.union([z.string(), z.number()]).transform((v, ctx) => { try { return percentToBp(v) } catch { ctx.addIssue({ code: 'custom', message: 'Not a valid percentage' }); return z.NEVER } })

// ---------- calculators: every calculation is saved to history automatically (§11.2) ----------
const calcBodies = {
  REVENUE_SHARE: z.object({ revenue: amount, companyPct: percent.optional() }),
  PROFIT_SHARE: z.object({ investment: amount, revenue: amount, companyPct: percent.optional() }),
  PERCENT_OF: z.object({ amount, pct: percent }),
  DISCOUNT: z.object({ price: amount, pct: percent }),
  CHANGE: z.object({ amount, pct: percent, direction: z.enum(['UP', 'DOWN']) }),
  GROWTH: z.object({ previous: amount, current: amount }),
}

financeRouter.post('/calc/:type', allow('ADMIN'), async (req, res) => {
  const type = parse(z.enum(['REVENUE_SHARE', 'PROFIT_SHARE', 'PERCENT_OF', 'DISCOUNT', 'CHANGE', 'GROWTH']), String(req.params.type).toUpperCase().replace(/-/g, '_')) as CalcType
  const extra = parse(z.object({ periodFrom: z.string().date().optional(), periodTo: z.string().date().optional(), save: z.boolean().default(true) }), { periodFrom: req.body?.periodFrom, periodTo: req.body?.periodTo, save: req.body?.save })
  const s = await getSettings()
  const b = parse(calcBodies[type as keyof typeof calcBodies], req.body) as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  let r: CalcResult
  let bp: number | null = null
  try {
    switch (type) {
      case 'REVENUE_SHARE': bp = b.companyPct ?? s.finance.companyShareBp; r = revenueShare(b.revenue, bp!); break
      case 'PROFIT_SHARE': bp = b.companyPct ?? s.finance.companyShareBp; r = profitShare(b.investment, b.revenue, bp!); break
      case 'PERCENT_OF': bp = b.pct; r = percentOf(b.amount, bp!); break
      case 'DISCOUNT': bp = b.pct; r = discount(b.price, bp!); break
      case 'CHANGE': bp = b.pct; r = change(b.amount, bp!, b.direction); break
      default: r = growth(b.previous, b.current)
    }
  } catch (e) { if (e instanceof RangeError) throw badRequest(e.message); throw e }
  const inputs = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]))
  const row = extra.save ? await prisma.finCalculation.create({ data: { type, inputs, percentBp: bp, resultPaise: r.resultPaise, remainingPaise: r.remainingPaise, resultBp: r.resultBp, note: r.note, periodFrom: extra.periodFrom ? new Date(extra.periodFrom) : null, periodTo: extra.periodTo ? new Date(extra.periodTo) : null, byUserId: me(req).id } }) : null
  res.status(extra.save ? 201 : 200).json({ id: row?.id ?? null, type, percentBp: bp, remainingPct: type.endsWith('_SHARE') && bp != null ? (10_000 - bp) / 100 : undefined, ...r, extra: r.extra })
})

financeRouter.get('/calculations', allow('ADMIN'), async (req, res) => {
  const q = parse(z.object({ type: z.string().optional(), userId: z.coerce.number().optional(), from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query)
  const where: Prisma.FinCalculationWhereInput = { ...(q.type && { type: q.type.toUpperCase() as CalcType }), ...(q.userId && { byUserId: q.userId }), ...((q.from || q.to) && { at: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(new Date(q.to).getTime() + 86_400_000) }) } }) }
  const [rows, total] = await Promise.all([prisma.finCalculation.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * 50, take: 50 }), prisma.finCalculation.count({ where })])
  res.json({ total, rows })
})

// ---------- transactions (§11.3) ----------
const txnBody = z.object({
  kind: z.enum(['REVENUE', 'INVESTMENT']).default('REVENUE'), leadId: z.number().int().optional(), amount,
  method: z.string().trim().max(40).optional(), referenceNo: z.string().trim().max(80).optional(), receivedOn: z.string().date(), notes: z.string().trim().max(500).optional(),
})

financeRouter.post('/transactions', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const b = parse(txnBody, req.body)
  const s = await getSettings()
  if (b.amount <= 0n) throw badRequest('Amount must be more than zero')
  if (b.receivedOn > localDate(new Date(), s.company.timeZone)) throw badRequest('Received date is in the future')
  let teamId: number | null = null
  if (u.role === 'TEAM_LEAD') {
    if (!s.finance.tlCanRecordPayments) throw forbidden('Team Leads cannot record payments (setting)')
    if (b.kind !== 'REVENUE' || !b.leadId) throw forbidden('Team Leads record payments for converted leads only')
  }
  if (b.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: b.leadId, deletedAt: null }, include: { status: true } })
    if (!lead) throw notFound('Lead')
    if (b.kind !== 'REVENUE') throw badRequest('An investment is not linked to a lead')
    if (lead.status.category !== 'WON') throw unprocessable(`A payment can only be linked to a converted lead (this one is ${lead.status.label})`)
    if (u.role === 'TEAM_LEAD' && (!lead.teamId || !(await ledTeamIds(u.id)).includes(lead.teamId))) throw forbidden('This lead is not in your team')
    teamId = lead.teamId
  }
  const row = await tx(async (t) => {
    const r = await t.finTransaction.create({ data: { kind: b.kind, leadId: b.leadId ?? null, teamId, amountPaise: b.amount, method: b.method, referenceNo: b.referenceNo, receivedOn: new Date(b.receivedOn), recordedBy: u.id, notes: b.notes } })
    await audit(t, { actorId: u.id, action: 'TXN_RECORD', entity: 'transaction', entityId: r.id, after: r, ip: clientIp(req) })
    if (u.role !== 'ADMIN') for (const a of await adminIds(t)) await notify(t, a, { type: 'PAYMENT_TO_CONFIRM', title: `Payment to confirm: ₹${(Number(b.amount) / 100).toLocaleString('en-IN')}`, body: `Recorded by ${u.name}`, link: '/finance/transactions?state=PENDING' })
    return r
  })
  res.status(201).json(row)
})

/** Confirm: the company % in force today is copied in, and both shares are calculated and saved (§11.3). */
financeRouter.post('/transactions/:id/confirm', allow('ADMIN'), async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const s = await getSettings()
  const r = await tx(async (t) => {
    const rows = await t.$queryRaw<{ id: number }[]>`SELECT id FROM transactions WHERE id = ${id} FOR UPDATE`
    if (!rows.length) throw notFound('Transaction')
    const before = await t.finTransaction.findUniqueOrThrow({ where: { id } })
    if (before.state !== 'PENDING') throw unprocessable(`This transaction is already ${before.state.toLowerCase()}`)
    const data: Prisma.FinTransactionUpdateInput = { state: 'CONFIRMED', confirmedBy: u.id, confirmedAt: new Date() }
    if (before.kind === 'REVENUE') {
      const bp = s.finance.companyShareBp
      const sp = split(before.amountPaise, bp)
      Object.assign(data, { companyShareBp: bp, companySharePaise: sp.share, remainingPaise: sp.remaining })
      await t.finCalculation.create({ data: { type: 'REVENUE_SHARE', inputs: { revenue: String(before.amountPaise), source: 'transaction' }, percentBp: bp, resultPaise: sp.share, remainingPaise: sp.remaining, transactionId: id, byUserId: u.id, note: 'Share at confirmation' } })
    }
    const after = await t.finTransaction.update({ where: { id }, data })
    await audit(t, { actorId: u.id, action: 'TXN_CONFIRM', entity: 'transaction', entityId: id, before, after, ip: clientIp(req) })
    if (before.recordedBy !== u.id) await notify(t, before.recordedBy, { type: 'PAYMENT_CONFIRMED', title: 'A payment you recorded was confirmed', link: '/finance' })
    return after
  })
  res.json(r)
})

/** A confirmed transaction is never edited: it is cancelled with a reason (and re-entered if needed). */
financeRouter.post('/transactions/:id/cancel', allow('ADMIN'), async (req, res) => {
  const u = me(req)
  const id = parse(idParam, req.params.id)
  const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body)
  const before = await prisma.finTransaction.findUnique({ where: { id } })
  if (!before) throw notFound('Transaction')
  if (before.state === 'CANCELLED') throw unprocessable('Already cancelled')
  const after = await prisma.finTransaction.update({ where: { id }, data: { state: 'CANCELLED', cancelReason: b.reason } })
  await audit(prisma, { actorId: u.id, action: 'TXN_CANCEL', entity: 'transaction', entityId: id, before, after, ip: clientIp(req) })
  res.json(after)
})

financeRouter.get('/transactions', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const q = parse(z.object({ state: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']).optional(), kind: z.enum(['REVENUE', 'INVESTMENT']).optional(), teamId: z.coerce.number().optional(), from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query)
  const where: Prisma.FinTransactionWhereInput = {
    ...(q.state && { state: q.state }), ...(q.kind && { kind: q.kind }), ...(q.teamId && { teamId: q.teamId }),
    ...((q.from || q.to) && { receivedOn: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) } }),
    ...(u.role === 'TEAM_LEAD' && { recordedBy: u.id }), // a Team Lead sees only the payments they recorded
  }
  const [rows, total] = await Promise.all([prisma.finTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50, include: { lead: { select: { id: true, name: true } } } }), prisma.finTransaction.count({ where })])
  res.json({ total, rows: u.role === 'ADMIN' ? rows : rows.map(({ companyShareBp: _a, companySharePaise: _b, remainingPaise: _c, ...r }) => r) })
})

/** Converted leads with no payment after N days (setting). Team Lead: own teams, to record payments. */
financeRouter.get('/unpaid', allow('ADMIN', 'TEAM_LEAD'), async (req, res) => {
  const u = me(req)
  const s = await getSettings()
  res.json(await convertedUnpaid(s.finance.unpaidReminderDays, u.role === 'TEAM_LEAD' ? await ledTeamIds(u.id) : null))
})

/** Finance dashboard (§11.4): only CONFIRMED transactions count; pending listed separately. */
financeRouter.get('/dashboard', allow('ADMIN'), async (req, res) => {
  const q = parse(z.object({ from: z.string().date().optional(), to: z.string().date().optional(), teamId: z.coerce.number().optional(), sourceId: z.coerce.number().optional() }), req.query)
  const s = await getSettings()
  const today = localDate(new Date(), s.company.timeZone)
  const from = q.from ?? `${today.slice(0, 7)}-01`
  const to = q.to ?? today
  const filt = Prisma.sql`${q.teamId ? Prisma.sql`AND x.team_id = ${q.teamId}` : Prisma.empty} ${q.sourceId ? Prisma.sql`AND l.source_id = ${q.sourceId}` : Prisma.empty}`
  const [cards] = await prisma.$queryRaw<{ revenue: bigint | null; share: bigint | null; remaining: bigint | null; investment: bigint | null; pending: bigint | null; pending_n: bigint }[]>`
    SELECT
      SUM(x.amount_paise) FILTER (WHERE x.kind = 'REVENUE' AND x.state = 'CONFIRMED') AS revenue,
      SUM(x.company_share_paise) FILTER (WHERE x.kind = 'REVENUE' AND x.state = 'CONFIRMED') AS share,
      SUM(x.remaining_paise) FILTER (WHERE x.kind = 'REVENUE' AND x.state = 'CONFIRMED') AS remaining,
      SUM(x.amount_paise) FILTER (WHERE x.kind = 'INVESTMENT' AND x.state = 'CONFIRMED') AS investment,
      SUM(x.amount_paise) FILTER (WHERE x.state = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE x.state = 'PENDING') AS pending_n
    FROM transactions x LEFT JOIN leads l ON l.id = x.lead_id
    WHERE x.received_on BETWEEN ${from}::date AND ${to}::date ${filt}`
  const monthly = await prisma.$queryRaw<{ month: string; revenue: bigint | null; investment: bigint | null }[]>`
    SELECT to_char(date_trunc('month', x.received_on), 'YYYY-MM') AS month,
      SUM(x.amount_paise) FILTER (WHERE x.kind = 'REVENUE') AS revenue, SUM(x.amount_paise) FILTER (WHERE x.kind = 'INVESTMENT') AS investment
    FROM transactions x LEFT JOIN leads l ON l.id = x.lead_id
    WHERE x.state = 'CONFIRMED' AND x.received_on >= (date_trunc('month', ${to}::date) - interval '11 months') AND x.received_on <= ${to}::date ${filt}
    GROUP BY 1 ORDER BY 1`
  const byTeam = await prisma.$queryRaw<{ team: string | null; revenue: bigint }[]>`
    SELECT t.name AS team, SUM(x.amount_paise) AS revenue FROM transactions x LEFT JOIN teams t ON t.id = x.team_id LEFT JOIN leads l ON l.id = x.lead_id
    WHERE x.kind = 'REVENUE' AND x.state = 'CONFIRMED' AND x.received_on BETWEEN ${from}::date AND ${to}::date ${filt} GROUP BY t.name ORDER BY 2 DESC`
  const bySource = await prisma.$queryRaw<{ source: string | null; revenue: bigint }[]>`
    SELECT ls.name AS source, SUM(x.amount_paise) AS revenue FROM transactions x LEFT JOIN leads l ON l.id = x.lead_id LEFT JOIN lead_sources ls ON ls.id = l.source_id
    WHERE x.kind = 'REVENUE' AND x.state = 'CONFIRMED' AND x.received_on BETWEEN ${from}::date AND ${to}::date ${filt} GROUP BY ls.name ORDER BY 2 DESC`
  const n = (v: bigint | null | undefined) => Number(v ?? 0)
  const revenueP = n(cards.revenue), investmentP = n(cards.investment)
  res.json({
    period: { from, to }, shareRule: 'Shares use the % in force on the confirmation date',
    cards: { confirmedRevenuePaise: revenueP, companySharePaise: n(cards.share), remainingSharePaise: n(cards.remaining), investmentPaise: investmentP, profitPaise: revenueP - investmentP, pendingPaise: n(cards.pending), pendingCount: Number(cards.pending_n) },
    monthly: monthly.map((m) => ({ month: m.month, revenuePaise: n(m.revenue), investmentPaise: n(m.investment) })),
    byTeam: byTeam.map((x) => ({ team: x.team ?? 'No team (other income)', revenuePaise: n(x.revenue) })),
    bySource: bySource.map((x) => ({ source: x.source ?? 'No source', revenuePaise: n(x.revenue) })),
    pending: await prisma.finTransaction.findMany({ where: { state: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { lead: { select: { id: true, name: true } } } }),
    unpaid: (await convertedUnpaid(s.finance.unpaidReminderDays, q.teamId ? [q.teamId] : null)).length,
    recentTransactions: await prisma.finTransaction.findMany({ where: { state: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    recentCalculations: await prisma.finCalculation.findMany({ orderBy: { at: 'desc' }, take: 10 }),
  })
})
