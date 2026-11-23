import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { badRequest } from '../../lib/errors.js'

export interface Sheet { headers: string[]; rows: Record<string, string>[] }

/** Read .xlsx or .csv by CONTENT, not by extension (§12.4). First row = headers. */
export async function readSheet(buf: Buffer, fileName: string): Promise<Sheet> {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b // xlsx is a zip ("PK")
  if (isZip) return readXlsx(buf)
  if (buf.subarray(0, 4096).includes(0)) throw badRequest(`"${fileName}" is not a CSV or Excel (.xlsx) file`)
  return readCsv(buf.toString('utf8').replace(/^﻿/, ''))
}

function readCsv(text: string): Sheet {
  const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  const headers = (r.meta.fields ?? []).filter(Boolean)
  if (!headers.length) throw badRequest('The file has no header row')
  return { headers, rows: r.data }
}

async function readXlsx(buf: Buffer): Promise<Sheet> {
  const wb = new ExcelJS.Workbook()
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer) } catch { throw badRequest('This Excel file could not be read. Save it as .xlsx or .csv and try again.') }
  const ws = wb.worksheets[0]
  if (!ws) throw badRequest('The Excel file has no sheets')
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => { headers[col - 1] = cellText(c.value).trim() })
  if (!headers.filter(Boolean).length) throw badRequest('The first row must contain column names')
  const rows: Record<string, string>[] = []
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return
    const o: Record<string, string> = {}
    let any = false
    headers.forEach((h, i) => { if (!h) return; const v = cellText(row.getCell(i + 1).value).trim(); o[h] = v; if (v) any = true })
    if (any) rows.push(o)
  })
  return { headers: headers.filter(Boolean), rows }
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('text' in v && v.text != null) return String(v.text)
    if ('result' in v && v.result != null) return cellText(v.result as ExcelJS.CellValue)
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? v.hyperlink)
    return ''
  }
  if (typeof v === 'number' && Number.isInteger(v)) return String(v)
  return String(v)
}

/** Guess which file column is which field, by common header names. */
export function suggestMapping(headers: string[], customKeys: { key: string; label: string }[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const guess: Record<string, string> = {}
  const pick = (field: string, names: string[]) => {
    const h = headers.find((x) => names.includes(norm(x)))
    if (h) guess[field] = h
  }
  pick('name', ['name', 'fullname', 'leadname', 'customername', 'candidatename', 'studentname', 'contactname'])
  pick('phone', ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phonenumber', 'contact', 'contactno', 'whatsapp', 'number'])
  pick('email', ['email', 'emailid', 'emailaddress', 'mail'])
  pick('source', ['source', 'leadsource', 'channel'])
  for (const f of customKeys) pick(`custom.${f.key}`, [norm(f.key), norm(f.label)])
  return guess
}
