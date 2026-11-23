import { split, mulBp, growthBp, paiseToRupees } from '../../lib/money.js'

/**
 * Finance calculators (§11.1). All amounts in paise (bigint), percentages in basis points.
 * Share = total × % rounded half up to the paisa; remaining = total − share (always adds up exactly).
 */
export type CalcResult = { resultPaise: bigint | null; remainingPaise: bigint | null; resultBp: number | null; note: string | null; extra?: Record<string, string> }

const assertAmount = (p: bigint, label: string) => { if (p < 0n) throw new RangeError(`${label} cannot be negative`) }
const assertPct = (bp: number, max = 10_000) => { if (!Number.isInteger(bp) || bp < 0 || bp > max) throw new RangeError(`Percentage must be between 0 and ${max / 100}`) }
const rs = (p: bigint) => `₹${Number(paiseToRupees(p)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function revenueShare(revenue: bigint, companyBp: number): CalcResult {
  assertAmount(revenue, 'Revenue'); assertPct(companyBp)
  const { share, remaining } = split(revenue, companyBp)
  return { resultPaise: share, remainingPaise: remaining, resultBp: null, note: `Company ${companyBp / 100}% = ${rs(share)}, remaining ${(10_000 - companyBp) / 100}% = ${rs(remaining)}` }
}

export function profitShare(investment: bigint, revenue: bigint, companyBp: number): CalcResult {
  assertAmount(investment, 'Investment'); assertAmount(revenue, 'Revenue'); assertPct(companyBp)
  const profit = revenue - investment
  if (profit <= 0n) return { resultPaise: null, remainingPaise: null, resultBp: null, note: profit === 0n ? 'No profit to share' : `Loss of ${rs(-profit)}, no profit to share`, extra: { profitPaise: String(profit) } }
  const { share, remaining } = split(profit, companyBp)
  return { resultPaise: share, remainingPaise: remaining, resultBp: null, note: `Profit ${rs(profit)} → company ${rs(share)}, remaining ${rs(remaining)}`, extra: { profitPaise: String(profit) } }
}

export function percentOf(amount: bigint, bp: number): CalcResult {
  assertAmount(amount, 'Amount'); assertPct(bp, 1_000_000)
  const r = mulBp(amount, bp)
  return { resultPaise: r, remainingPaise: null, resultBp: null, note: `${bp / 100}% of ${rs(amount)} = ${rs(r)}` }
}

export function discount(price: bigint, bp: number): CalcResult {
  assertAmount(price, 'Price'); assertPct(bp)
  const d = mulBp(price, bp)
  return { resultPaise: price - d, remainingPaise: d, resultBp: null, note: `${rs(d)} off, final price ${rs(price - d)}` }
}

export function change(amount: bigint, bp: number, direction: 'UP' | 'DOWN'): CalcResult {
  assertAmount(amount, 'Amount'); assertPct(bp, 1_000_000)
  const delta = mulBp(amount, bp)
  const r = direction === 'UP' ? amount + delta : amount - delta
  return { resultPaise: r, remainingPaise: delta, resultBp: null, note: `${rs(amount)} ${direction === 'UP' ? '+' : '−'} ${bp / 100}% = ${rs(r)}` }
}

export function growth(previous: bigint, current: bigint): CalcResult {
  assertAmount(previous, 'Previous value'); assertAmount(current, 'Current value')
  const g = growthBp(previous, current)
  if (g == null) return { resultPaise: current - previous, remainingPaise: null, resultBp: null, note: 'n/a (no previous value)' }
  return { resultPaise: current - previous, remainingPaise: null, resultBp: g, note: `${g >= 0 ? '+' : ''}${(g / 100).toFixed(2)}%` }
}
