/**
 * Money is whole paise (bigint), percentages are basis points (1% = 100 bp).
 * Rounding rule (§11.1): share rounds half up to the nearest paisa; remaining = total − share.
 */
export const BP = 10_000n

/** "50,000.50" | 50000.5 → 5000050n paise. Refuses more than 2 decimals. */
export function rupeesToPaise(v: string | number): bigint {
  const s = String(v).replace(/[,\s₹]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Not a valid amount: ${v}`)
  const neg = s.startsWith('-')
  const [whole, frac = ''] = s.replace('-', '').split('.')
  const p = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2))
  return neg ? -p : p
}

export function paiseToRupees(p: bigint | number): string {
  const n = BigInt(p)
  const neg = n < 0n
  const a = neg ? -n : n
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

/** "30" | "12.5" → basis points */
export function percentToBp(v: string | number): number {
  const s = String(v).trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Not a valid percentage: ${v}`)
  return Math.round(Number(s) * 100)
}

/** amount × bp ÷ 10000, rounded half up (away from zero for negatives). */
export function mulBp(paise: bigint, bp: number): bigint {
  const num = paise * BigInt(bp)
  const neg = num < 0n
  const a = neg ? -num : num
  const q = (a + BP / 2n) / BP
  return neg ? -q : q
}

/** Split a total into share (rounded) + remaining (total − share), always adds up exactly. */
export function split(totalPaise: bigint, shareBp: number) {
  const share = mulBp(totalPaise, shareBp)
  return { share, remaining: totalPaise - share }
}

/** (current − previous) ÷ previous in bp, half up; null when previous is 0. */
export function growthBp(previous: bigint, current: bigint): number | null {
  if (previous === 0n) return null
  const num = (current - previous) * BP
  const neg = (num < 0n) !== (previous < 0n)
  const a = num < 0n ? -num : num
  const d = previous < 0n ? -previous : previous
  const q = (a * 2n + d) / (2n * d)
  return Number(neg ? -q : q)
}

/** Safe JSON for bigint fields. */
export const toNum = (v: bigint | null | undefined) => (v == null ? null : Number(v))
