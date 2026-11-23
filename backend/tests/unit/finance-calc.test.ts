import { describe, it, expect } from 'vitest'
import { revenueShare, profitShare, percentOf, discount, change, growth } from '../../src/modules/finance/calc.js'
import { rupeesToPaise as P, percentToBp, mulBp, split, paiseToRupees } from '../../src/lib/money.js'

describe('money helpers', () => {
  it('parses rupees into paise exactly', () => {
    expect(P('50,000')).toBe(5_000_000n)
    expect(P('₹1,20,000.50')).toBe(12_000_050n)
    expect(P(0.1)).toBe(10n)
    expect(() => P('12.345')).toThrow()
    expect(paiseToRupees(12_000_050n)).toBe('120000.50')
  })
  it('rounds half up to the paisa and always adds up', () => {
    expect(mulBp(1n, 5000)).toBe(1n)        // 0.5 paisa → 1
    expect(mulBp(333n, 3333)).toBe(111n)    // 110.99 → 111
    const s = split(100_001n, 3000)
    expect(s.share + s.remaining).toBe(100_001n)
    expect(percentToBp('12.5')).toBe(1250)
  })
})

describe('calculators (§11.1 examples)', () => {
  it('revenue share: ₹50,000 at 30% → ₹15,000 / ₹35,000', () => {
    const r = revenueShare(P(50000), 3000)
    expect(r.resultPaise).toBe(P(15000)); expect(r.remainingPaise).toBe(P(35000))
  })
  it('profit share: ₹20,000 / ₹50,000 → profit ₹30,000 → ₹9,000 / ₹21,000', () => {
    const r = profitShare(P(20000), P(50000), 3000)
    expect(r.resultPaise).toBe(P(9000)); expect(r.remainingPaise).toBe(P(21000))
  })
  it('profit ≤ 0: no shares, says loss', () => {
    const r = profitShare(P(54000), P(50000), 3000)
    expect(r.resultPaise).toBeNull(); expect(r.note).toBe('Loss of ₹4,000.00, no profit to share')
    expect(profitShare(P(1), P(1), 3000).note).toBe('No profit to share')
  })
  it('percent of: 18% of ₹2,500 = ₹450', () => expect(percentOf(P(2500), 1800).resultPaise).toBe(P(450)))
  it('discount: ₹10,000 at 15% → ₹1,500 off, ₹8,500', () => {
    const r = discount(P(10000), 1500)
    expect(r.remainingPaise).toBe(P(1500)); expect(r.resultPaise).toBe(P(8500))
  })
  it('increase: ₹40,000 + 12% = ₹44,800; decrease too', () => {
    expect(change(P(40000), 1200, 'UP').resultPaise).toBe(P(44800))
    expect(change(P(40000), 1200, 'DOWN').resultPaise).toBe(P(35200))
  })
  it('growth: ₹80,000 → ₹1,00,000 = +25%; from 0 = n/a', () => {
    expect(growth(P(80000), P(100000)).resultBp).toBe(2500)
    expect(growth(P(100000), P(80000)).resultBp).toBe(-2000)
    const z = growth(0n, P(5000)); expect(z.resultBp).toBeNull(); expect(z.note).toBe('n/a (no previous value)')
  })
  it('refuses negative amounts and bad percentages', () => {
    expect(() => revenueShare(-1n, 3000)).toThrow(RangeError)
    expect(() => revenueShare(P(100), 10_001)).toThrow(RangeError)
  })
})
