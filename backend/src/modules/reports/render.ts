import { createRequire } from 'node:module'
import ExcelJS from 'exceljs'
import type { Response } from 'express'

const require = createRequire(import.meta.url)

/** One table shape for every report, rendered as JSON, CSV, Excel or PDF with the same numbers. */
export interface Table {
  title: string
  columns: { key: string; label: string; kind?: 'text' | 'int' | 'pct' | 'money' | 'date' }[]
  rows: Record<string, unknown>[]
  footer: string[] // filters, period rule, generated time (§14)
}

const fmtCell = (v: unknown, kind?: string) => {
  if (v == null) return ''
  if (kind === 'money') return (Number(v) / 100).toFixed(2)
  if (kind === 'pct') return typeof v === 'number' ? v.toFixed(1) : String(v)
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/** Neutralise spreadsheet formulas in exported text (CSV / formula injection). */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s)

export function toCsv(t: Table) {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [t.columns.map((c) => esc(c.label)).join(',')]
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(safe(fmtCell(r[c.key], c.kind)))).join(','))
  lines.push('', ...t.footer.map((f) => esc(f)))
  return '﻿' + lines.join('\r\n')
}

export async function toXlsx(t: Table) {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\/?*[\]:]/g, ' '))
  ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, Math.min(40, c.label.length + 4)) }))
  ws.getRow(1).font = { bold: true }
  for (const r of t.rows) {
    ws.addRow(Object.fromEntries(t.columns.map((c) => {
      const v = r[c.key]
      if (v == null) return [c.key, null]
      if (c.kind === 'money') return [c.key, Number(v) / 100]
      if (c.kind === 'int' || c.kind === 'pct') return [c.key, Number(v)]
      return [c.key, typeof v === 'string' ? safe(v) : v]
    })))
  }
  t.columns.forEach((c, i) => { if (c.kind === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00'; if (c.kind === 'pct') ws.getColumn(i + 1).numFmt = '0.0' })
  ws.addRow([])
  for (const f of t.footer) ws.addRow([f]).font = { italic: true, color: { argb: 'FF666666' } }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

let printer: { createPdfKitDocument: (d: object) => NodeJS.ReadableStream & { end(): void } } | null = null
function pdfPrinter() {
  if (printer) return printer
  const PdfPrinter = require('pdfmake')
  const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>
  const f = (n: string) => Buffer.from(vfs[n], 'base64')
  printer = new PdfPrinter({ Roboto: { normal: f('Roboto-Regular.ttf'), bold: f('Roboto-Medium.ttf'), italics: f('Roboto-Italic.ttf'), bolditalics: f('Roboto-MediumItalic.ttf') } })
  return printer!
}

export function toPdf(t: Table): Promise<Buffer> {
  const doc = pdfPrinter().createPdfKitDocument({
    pageOrientation: t.columns.length > 6 ? 'landscape' : 'portrait', pageMargins: [28, 32, 28, 40],
    defaultStyle: { font: 'Roboto', fontSize: 8.5 },
    content: [
      { text: t.title, fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
      { table: { headerRows: 1, widths: t.columns.map(() => '*'), body: [t.columns.map((c) => ({ text: c.label, bold: true })), ...t.rows.map((r) => t.columns.map((c) => ({ text: fmtCell(r[c.key], c.kind), alignment: c.kind && c.kind !== 'text' && c.kind !== 'date' ? 'right' : 'left' })))] }, layout: 'lightHorizontalLines' },
      { text: t.footer.join('\n'), italics: true, color: '#666666', margin: [0, 10, 0, 0], fontSize: 7.5 },
    ],
  })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

export async function send(res: Response, t: Table, format: string) {
  const name = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (format === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`); return res.send(toCsv(t)) }
  if (format === 'xlsx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); return res.send(await toXlsx(t)) }
  if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`); return res.send(await toPdf(t)) }
  res.json(t)
}
