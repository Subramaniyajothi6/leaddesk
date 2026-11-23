import { describe, it, expect } from 'vitest'
import { splitEqual, splitCapacity, deal, plan, performance, type Candidate } from '../../src/modules/allocation/engine.js'

const cand = (userId: number, name: string, open: number, o: Partial<Candidate> = {}): Candidate =>
  ({ userId, name, open, max: 50, givenToday: 0, maxPerDay: 1000, perf: 0.5, lastAssignedAt: 0, values: {}, ...o })
const leads = (n: number, o: Partial<{ previousOwners: number[]; match: Record<string, string | null> }> = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, previousOwners: [], match: {}, ...o }))
const counts = (r: ReturnType<typeof plan>) => Object.fromEntries(r.perUser.map((u) => [u.name, u.get]))

describe('Stage 1 split (§5.3)', () => {
  it('300 to 3 teams → 100 / 100 / 100', () => expect(splitEqual(300, 3)).toEqual([100, 100, 100]))
  it('301 → 101 / 100 / 100, and the extra rotates next time', () => {
    expect(splitEqual(301, 3, 0)).toEqual([101, 100, 100])
    expect(splitEqual(301, 3, 1)).toEqual([100, 101, 100])
    expect(splitEqual(302, 3, 2)).toEqual([101, 100, 101])
  })
  it('by capacity: proportional, exact total, never above capacity', () => {
    const r = splitCapacity(300, [210, 390, 160])
    expect(r.reduce((a, b) => a + b, 0)).toBe(300)
    expect(r).toEqual([83, 154, 63])
    expect(splitCapacity(1000, [10, 20])).toEqual([10, 20])
    expect(splitCapacity(5, [0, 0])).toEqual([0, 0])
  })
  it('deal gives each team a mix from best to worst', () => {
    expect(deal([1, 2, 3, 4, 5, 6, 7], [3, 2, 2])).toEqual([[1, 4, 7], [2, 5], [3, 6]])
  })
})

describe('Stage 2 automatic (§5.4, §5.7)', () => {
  const w = { load: 60, match: 25, perf: 15 }
  it('Equal: 100 to 3 BDEs → 34 / 33 / 33', () => {
    const r = plan(leads(100), [cand(1, 'A', 0), cand(2, 'B', 0), cand(3, 'C', 0)], { method: 'EQUAL', weights: w, matching: [] })
    expect(counts(r)).toEqual({ A: 34, B: 33, C: 33 })
  })
  it('Equal: the rotating start moves the extra lead', () => {
    const r = plan(leads(100), [cand(1, 'A', 0), cand(2, 'B', 0), cand(3, 'C', 0)], { method: 'EQUAL', weights: w, matching: [], rotation: 1 })
    expect(counts(r)).toEqual({ A: 33, B: 34, C: 33 })
  })
  it('Workload: open 10, 30, 0 and 60 new → end at 33, 33, 34 (+23, +3, +34)', () => {
    const r = plan(leads(60), [cand(1, 'A', 10), cand(2, 'B', 30), cand(3, 'C', 0)], { method: 'WORKLOAD', weights: w, matching: [] })
    // Everyone ends level (33, 33, 34); who gets the one extra lead is the "waited longest" tie-break.
    expect(r.perUser.map((u) => u.openAfter).sort()).toEqual([33, 33, 34])
    expect(r.placements).toHaveLength(60)
    const c = counts(r)
    expect(c.A).toBeGreaterThanOrEqual(23); expect(c.B).toBeGreaterThanOrEqual(3); expect(c.C).toBeGreaterThanOrEqual(33)
  })
  it('Smart example: Meena 79 > Priya 54 > Ravi 35 for a Tamil lead', () => {
    const c = [
      cand(1, 'Meena', 10, { perf: 0.4, values: { language: ['tamil'] } }),
      cand(2, 'Priya', 38, { perf: 1.0, values: { language: ['tamil'] } }),
      cand(3, 'Ravi', 30, { perf: 0.7, values: { language: ['hindi'] } }),
    ]
    const r = plan(leads(1, { match: { language: 'tamil' } }), c, { method: 'SMART', weights: w, matching: [{ key: 'language', mode: 'prefer' }] })
    expect(r.placements[0]).toMatchObject({ userId: 1, reason: { method: 'SMART', score: 79, load: '10/50', match: ['language'], perf: 0.4 } })
  })
  it('never goes over a max; the rest stays in the pool with the reason', () => {
    const r = plan(leads(30), [cand(1, 'A', 45), cand(2, 'B', 48)], { method: 'SMART', weights: w, matching: [] })
    expect(r.placements).toHaveLength(7)
    expect(r.leftover).toHaveLength(23)
    expect(r.leftover[0].reason).toBe('Every eligible BDE is at their max')
  })
  it('respects the daily limit', () => {
    const r = plan(leads(10), [cand(1, 'A', 0, { givenToday: 38, maxPerDay: 40 })], { method: 'SMART', weights: w, matching: [] })
    expect(r.placements).toHaveLength(2)
  })
  it('a recycled lead never goes back to a previous owner', () => {
    const r = plan(leads(1, { previousOwners: [1] }), [cand(1, 'A', 0), cand(2, 'B', 40)], { method: 'SMART', weights: w, matching: [] })
    expect(r.placements[0].userId).toBe(2)
  })
  it('must-match leaves the lead in the pool when nobody matches', () => {
    const r = plan(leads(3, { match: { language: 'tamil' } }), [cand(1, 'A', 0, { values: { language: ['hindi'] } })], { method: 'SMART', weights: w, matching: [{ key: 'language', mode: 'must' }] })
    expect(r.placements).toHaveLength(0)
    expect(r.leftover[0].reason).toBe('No BDE matches: language tamil')
  })
  it('skipped BDEs (absent) are listed with the reason and get nothing', () => {
    const r = plan(leads(5), [cand(1, 'A', 0, { skip: 'Absent today' }), cand(2, 'B', 0)], { method: 'EQUAL', weights: w, matching: [] })
    expect(r.skipped).toEqual([{ userId: 1, name: 'A', reason: 'Absent today' }])
    expect(counts(r)).toEqual({ B: 5 })
  })
  it('same input → same result (rule-based, no randomness)', () => {
    const mk = () => [cand(1, 'A', 3), cand(2, 'B', 9), cand(3, 'C', 1)]
    const a = plan(leads(40), mk(), { method: 'SMART', weights: w, matching: [] })
    const b = plan(leads(40), mk(), { method: 'SMART', weights: w, matching: [] })
    expect(a.placements).toEqual(b.placements)
  })
})

describe('performance (§5.7)', () => {
  it('team average scores 0.5, capped at 1, new joiners neutral', () => {
    expect(performance(10, 100, 0.1, 20)).toBeCloseTo(0.5)
    expect(performance(40, 100, 0.1, 20)).toBe(1)
    expect(performance(5, 10, 0.1, 20)).toBe(0.5)
  })
})
