import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma, tx } from '../../db.js'
import { parse, idParam } from '../../lib/validate.js'
import { allow, me, clientIp } from '../../lib/access.js'
import { audit } from '../../lib/audit.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { getSettings } from '../../lib/settings.js'
import { newStatusId } from '../../lib/statuses.js'
import { validateLead, type RawLead } from '../leads/validate.js'
import { activeRules, scoreOf } from '../leads/scoring.js'
import { findDuplicates } from './duplicates.js'
import { readSheet, suggestMapping } from './parse.js'

export const importsRouter = Router()
importsRouter.use(allow('ADMIN'))

const HARD_MAX = 50 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_MAX, files: 1, fields: 10 } })

async function fileFrom(req: import('express').Request) {
  const f = req.file
  if (!f) throw badRequest('Attach a .xlsx or .csv file in the "file" field')
  const { leads } = await getSettings()
  if (f.size > leads.maxUploadMb * 1024 * 1024) throw badRequest(`The file is larger than ${leads.maxUploadMb} MB`)
  return f
}

/** Step 1: read the file and suggest a column mapping. Nothing is saved. */
importsRouter.post('/preview', upload.single('file'), async (req, res) => {
  const f = await fileFrom(req)
  const sheet = await readSheet(f.buffer, f.originalname)
  const fields = await prisma.customFieldDef.findMany({ where: { active: true } })
  res.json({ fileName: f.originalname, rowCount: sheet.rows.length, headers: sheet.headers, sample: sheet.rows.slice(0, 5), suggestedMapping: suggestMapping(sheet.headers, fields) })
})

const mappingSchema = z.object({
  name: z.string().min(1), phone: z.string().min(1), email: z.string().optional(), source: z.string().optional(),
}).catchall(z.string()) // custom.<key> → header

/** Turn a file row into lead fields using the mapping { field → header }. */
function mapRow(row: Record<string, string>, mapping: Record<string, string>, defaultSource?: string): RawLead {
  const custom: Record<string, unknown> = {}
  for (const [field, header] of Object.entries(mapping)) if (field.startsWith('custom.')) custom[field.slice(7)] = row[header]
  return { name: row[mapping.name], phone: row[mapping.phone], email: mapping.email ? row[mapping.email] : undefined, source: (mapping.source ? row[mapping.source] : '') || defaultSource, custom }
}

type Good = { row: number; lead: NonNullable<Extract<ReturnType<typeof validateLead>, { ok: true }>['lead']> }
type Reject = { rowNumber: number; raw: Record<string, string>; reason: string; kind: 'ERROR' | 'DUPLICATE'; existingLeadId?: number }

/** Validate every row and find duplicates (in the file and in the database). Reads only, never writes. */
async function checkRows(rows: Record<string, string>[], mapping: Record<string, string>, defaultSource: string | undefined, dupAction: 'SKIP' | 'MERGE') {
  const s = await getSettings()
  const [fields, sources] = await Promise.all([prisma.customFieldDef.findMany(), prisma.leadSource.findMany()])
  const good: Good[] = []
  const rejects: Reject[] = []
  const seenPhone = new Map<string, number>()
  const seenEmail = new Map<string, number>()
  const rule = s.leads.duplicateRule

  rows.forEach((row, i) => {
    const rowNumber = i + 2 // header is row 1
    const v = validateLead(mapRow(row, mapping, defaultSource), { country: s.company.country, fields, sources })
    if (!v.ok) return rejects.push({ rowNumber, raw: row, reason: v.errors.join('; '), kind: 'ERROR' })
    const samePhone = rule !== 'EMAIL' ? seenPhone.get(v.lead.phoneE164) : undefined
    const sameEmail = rule !== 'PHONE' && v.lead.email ? seenEmail.get(v.lead.email) : undefined
    if (samePhone || sameEmail) return rejects.push({ rowNumber, raw: row, reason: `Same ${samePhone ? 'phone' : 'email'} as row ${samePhone ?? sameEmail} in this file`, kind: 'DUPLICATE' })
    seenPhone.set(v.lead.phoneE164, rowNumber)
    if (v.lead.email) seenEmail.set(v.lead.email, rowNumber)
    good.push({ row: rowNumber, lead: v.lead })
  })

  const dupes = await findDuplicates(prisma, good.map((g) => ({ phone: g.lead.phoneE164, email: g.lead.email })), rule)
  const fresh: Good[] = []
  const merges: (Good & { existingId: number })[] = []
  good.forEach((g, i) => {
    const ex = dupes.get(i)
    if (!ex) return fresh.push(g)
    rejects.push({ rowNumber: g.row, raw: rows[g.row - 2], reason: dupAction === 'MERGE' ? 'Already exists: empty fields merged into the existing lead' : 'Already exists (skipped)', kind: 'DUPLICATE', existingLeadId: ex })
    if (dupAction === 'MERGE') merges.push({ ...g, existingId: ex })
  })
  rejects.sort((a, b) => a.rowNumber - b.rowNumber)
  return { fresh, merges, rejects }
}

const importBody = z.object({
  mapping: z.string().transform((s, ctx) => { try { return JSON.parse(s) } catch { ctx.addIssue({ code: 'custom', message: 'mapping must be JSON' }); return z.NEVER } }).pipe(mappingSchema),
  dupAction: z.enum(['SKIP', 'MERGE']).default('SKIP'),
  defaultSource: z.string().optional(),
})

async function readForImport(req: import('express').Request) {
  const f = await fileFrom(req)
  const body = parse(importBody, req.body)
  const sheet = await readSheet(f.buffer, f.originalname)
  for (const h of Object.values(body.mapping)) if (!sheet.headers.includes(h)) throw badRequest(`Column "${h}" is not in the file`)
  if (!sheet.rows.length) throw badRequest('The file has no data rows')
  if (sheet.rows.length > 20_000) throw badRequest('Upload at most 20,000 rows at a time')
  return { f, body, sheet }
}

/**
 * Step 2a: check every row exactly as the real upload would, and say what would happen. Nothing is saved.
 * Problems are grouped by reason, and the first 200 problem rows are listed.
 */
importsRouter.post('/check', upload.single('file'), async (req, res) => {
  const { body, sheet } = await readForImport(req)
  const { fresh, merges, rejects } = await checkRows(sheet.rows, body.mapping, body.defaultSource, body.dupAction)
  const nameCol = body.mapping.name, phoneCol = body.mapping.phone
  const groups = new Map<string, { reason: string; kind: string; count: number }>()
  for (const r of rejects) {
    // "Same phone as row 4 in this file" → one group for all in-file repeats
    const reason = r.reason.replace(/ as row \d+ in this file$/, ' as another row in this file')
    for (const part of r.kind === 'ERROR' ? reason.split('; ') : [reason]) {
      const g = groups.get(part) ?? { reason: part, kind: r.kind, count: 0 }
      g.count++
      groups.set(part, g)
    }
  }
  res.json({
    totalRows: sheet.rows.length, ready: fresh.length, merged: merges.length,
    duplicates: rejects.filter((r) => r.kind === 'DUPLICATE').length, errors: rejects.filter((r) => r.kind === 'ERROR').length,
    groups: [...groups.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'ERROR' ? -1 : 1)),
    rows: rejects.slice(0, 200).map((r) => ({ rowNumber: r.rowNumber, kind: r.kind, reason: r.reason, name: r.raw[nameCol] ?? '', phone: r.raw[phoneCol] ?? '', existingLeadId: r.existingLeadId ?? null })),
  })
})

/**
 * Step 2b: validate every row, stop duplicates, add the good rows to the company pool (§5.2).
 * dupAction: SKIP (default) or MERGE (fill empty fields of the existing lead, recorded in its history).
 */
importsRouter.post('/', upload.single('file'), async (req, res) => {
  const { f, body, sheet } = await readForImport(req)
  const [rules, statusNew] = await Promise.all([activeRules(), newStatusId()])
  const actor = me(req).id
  const { fresh, merges, rejects } = await checkRows(sheet.rows, body.mapping, body.defaultSource, body.dupAction)

  const result = await tx(async (t) => {
    const batch = await t.importBatch.create({
      data: { fileName: f.originalname.slice(0, 200), uploadedBy: actor, totalRows: sheet.rows.length, accepted: fresh.length, duplicates: rejects.filter((r) => r.kind === 'DUPLICATE').length, rejected: rejects.filter((r) => r.kind === 'ERROR').length, mapping: body.mapping },
    })
    if (fresh.length) {
      await t.lead.createMany({
        data: fresh.map((g) => ({
          name: g.lead.name, phoneE164: g.lead.phoneE164, email: g.lead.email, sourceId: g.lead.sourceId, batchId: batch.id, custom: g.lead.custom as object, statusId: statusNew,
          score: scoreOf(rules, { sourceName: g.lead.sourceName, statusKey: 'NEW', custom: g.lead.custom }),
        })),
      })
    }
    for (const m of merges) {
      const ex = await t.lead.findUniqueOrThrow({ where: { id: m.existingId } })
      const custom = { ...(m.lead.custom as object), ...Object.fromEntries(Object.entries(ex.custom as object).filter(([, v]) => v != null && v !== '')) }
      const data = { email: ex.email ?? m.lead.email, sourceId: ex.sourceId ?? m.lead.sourceId, custom }
      await t.lead.update({ where: { id: ex.id }, data: { ...data, version: { increment: 1 } } })
      await t.leadRemark.create({ data: { leadId: ex.id, byUserId: actor, body: `Merged from upload "${f.originalname}" row ${m.row}` } })
      await audit(t, { actorId: actor, action: 'LEAD_MERGE', entity: 'lead', entityId: ex.id, before: { email: ex.email, sourceId: ex.sourceId, custom: ex.custom }, after: data })
    }
    if (rejects.length) await t.importReject.createMany({ data: rejects.map((r) => ({ batchId: batch.id, rowNumber: r.rowNumber, raw: r.raw, reason: r.reason, kind: r.kind, existingLeadId: r.existingLeadId })) })
    await t.bulkAction.create({ data: { kind: 'IMPORT', byUserId: actor, leadCount: fresh.length, before: { batchId: batch.id } } })
    await audit(t, { actorId: actor, action: 'IMPORT', entity: 'import_batch', entityId: batch.id, after: { file: f.originalname, total: sheet.rows.length, added: fresh.length, duplicates: batch.duplicates, rejected: batch.rejected }, ip: clientIp(req) })
    return batch
  }, { timeout: 120_000 })

  res.status(201).json({
    batchId: result.id, totalRows: result.totalRows, added: result.accepted, duplicates: result.duplicates, rejected: result.rejected, merged: merges.length,
    summary: `${result.totalRows.toLocaleString('en-IN')} rows: ${result.accepted.toLocaleString('en-IN')} added, ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'}, ${result.rejected} rejected`,
  })
})

importsRouter.get('/', async (_req, res) => {
  res.json(await prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }))
})

/** Download the duplicates and/or errors as CSV (the import error file, §5.2 step 4). */
importsRouter.get('/:id/rejects.csv', async (req, res) => {
  const id = parse(idParam, req.params.id)
  const kind = parse(z.enum(['ERROR', 'DUPLICATE', 'ALL']).default('ALL'), req.query.kind)
  const batch = await prisma.importBatch.findUnique({ where: { id } })
  if (!batch) throw notFound('Upload')
  const rows = await prisma.importReject.findMany({ where: { batchId: id, ...(kind !== 'ALL' && { kind }) }, orderBy: { rowNumber: 'asc' } })
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r.raw as object)))]
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s }
  const lines = [['Row', 'Problem', 'Type', 'Existing lead', ...headers].map(esc).join(',')]
  for (const r of rows) lines.push([r.rowNumber, r.reason, r.kind, r.existingLeadId ?? '', ...headers.map((h) => (r.raw as Record<string, unknown>)[h])].map(esc).join(','))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="upload-${id}-${kind.toLowerCase()}.csv"`)
  res.send('﻿' + lines.join('\r\n'))
})
