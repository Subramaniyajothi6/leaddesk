import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/** Normalise to E.164 (+91XXXXXXXXXX). Returns null if it is not a valid number. */
export function normalizePhone(raw: unknown, country: string = 'IN'): string | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  // Excel often turns numbers into 9.87654321E9 or adds ".0"
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, '')
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0)
  const p = parsePhoneNumberFromString(s, country as CountryCode)
  if (!p || !p.isValid()) return null
  return p.number
}

/** 98XXXXX210: national number with the middle hidden (§12.3). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '')
  const nat = digits.length > 10 ? digits.slice(-10) : digits
  if (nat.length < 6) return 'XXXX'
  return nat.slice(0, 2) + 'X'.repeat(nat.length - 5) + nat.slice(-3)
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
