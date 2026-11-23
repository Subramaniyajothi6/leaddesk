/**
 * Allocation maths, free of the database so it can be unit-tested exactly (§5.3, §5.4, §5.7).
 * Rule-based: the same input always gives the same result, and every pick carries its reason.
 */

/** Stage 1 Equal: ⌊N÷k⌋ each; the remainder goes one each starting at `rotation` (§5.3). */
export function splitEqual(n: number, k: number, rotation = 0): number[] {
  if (k <= 0) return []
  const base = Math.floor(n / k)
  const out = new Array(k).fill(base)
  const rem = n - base * k
  for (let i = 0; i < rem; i++) out[(rotation + i) % k]++
  return out
}

/** Stage 1 By capacity: proportional to free capacity, largest-remainder rounding, never above capacity. */
export function splitCapacity(n: number, capacities: number[]): number[] {
  const caps = capacities.map((c) => Math.max(0, c))
  const total = caps.reduce((a, b) => a + b, 0)
  if (!total) return caps.map(() => 0)
  const give = Math.min(n, total)
  const exact = caps.map((c) => (give * c) / total)
  const out = exact.map(Math.floor)
  let left = give - out.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) { if (!left) break; if (out[i] < caps[i]) { out[i]++; left-- } }
  return out
}

/** Spread leads (already sorted best first) over targets like dealing cards, so every team gets a fair mix. */
export function deal<T>(items: T[], counts: number[]): T[][] {
  const out: T[][] = counts.map(() => [])
  const left = [...counts]
  let idx = 0
  for (const item of items) {
    if (!left.some((c) => c > 0)) break
    while (left[idx % left.length] <= 0) idx++
    const t = idx % left.length
    out[t].push(item)
    left[t]--
    idx++
  }
  return out
}

// ---------------------------------------------------------------- Stage 2

export interface Candidate {
  userId: number
  name: string
  open: number          // open leads now
  max: number           // max open leads at one time
  givenToday: number    // leads assigned today
  maxPerDay: number
  perf: number          // 0..1 (0.5 = team average or not enough data)
  lastAssignedAt: number // ms; 0 if never
  values: Record<string, string[]> // matching values, lower case
  skip?: string          // reason not eligible at all (absent, inactive…)
}

export interface LeadToPlace {
  id: number
  previousOwners: number[]
  match: Record<string, string | null> // lead values for matching fields, lower case
}

export type Method = 'SMART' | 'EQUAL' | 'WORKLOAD'
export interface MatchRule { key: string; mode: 'prefer' | 'must' }
export interface Weights { load: number; match: number; perf: number }

export interface Placement {
  leadId: number
  userId: number
  reason: { method: Method; score?: number; load: string; match?: string[]; perf?: number }
}
export interface PlanResult {
  placements: Placement[]
  leftover: { leadId: number; reason: string }[]
  perUser: { userId: number; name: string; get: number; openAfter: number; max: number }[]
  skipped: { userId: number; name: string; reason: string }[]
}

/**
 * Place leads one at a time, best first (§5.7). Counts are updated after every pick, so work spreads by itself.
 * Never goes over a max (automatic allocation, §5.4). Ties → the BDE who waited longest.
 */
export function plan(leads: LeadToPlace[], candidates: Candidate[], o: { method: Method; weights: Weights; matching: MatchRule[]; rotation?: number }): PlanResult {
  const skipped = candidates.filter((c) => c.skip).map((c) => ({ userId: c.userId, name: c.name, reason: c.skip! }))
  const pool = candidates.filter((c) => !c.skip).map((c, i) => ({ ...c, got: 0, order: i }))
  // Equal: rotating start, so the extra lead is not always the same person's.
  if (o.method === 'EQUAL' && pool.length) {
    const r = (o.rotation ?? 0) % pool.length
    pool.forEach((p, i) => { p.order = (i - r + pool.length) % pool.length })
  }
  const prefer = o.matching.filter((m) => m.mode === 'prefer')
  const must = o.matching.filter((m) => m.mode === 'must')
  const w = { ...o.weights }
  if (!o.matching.length) { w.load += w.match; w.match = 0 } // matching off: its weight goes to room left (§5.7)

  const placements: Placement[] = []
  const leftover: { leadId: number; reason: string }[] = []
  const matches = (c: (typeof pool)[number], key: string, v: string | null) => v == null || v === '' || (c.values[key] ?? []).includes(v)

  for (const lead of leads) {
    const why: string[] = []
    const eligible = pool.filter((c) => {
      if (c.open >= c.max) { why.push('max'); return false }
      if (c.givenToday >= c.maxPerDay) { why.push('day'); return false }
      if (lead.previousOwners.includes(c.userId)) { why.push('prev'); return false }
      if (must.some((m) => !matches(c, m.key, lead.match[m.key] ?? null))) { why.push('must'); return false }
      return true
    })
    if (!eligible.length) {
      const r = !pool.length ? 'No BDE can get leads right now (see who was skipped and why)'
        : why.every((x) => x === 'must') ? `No BDE matches: ${must.map((m) => `${m.key} ${lead.match[m.key]}`).join(', ')}`
        : why.every((x) => x === 'max') ? 'Every eligible BDE is at their max'
        : why.every((x) => x === 'max' || x === 'day') ? 'Every eligible BDE reached their max or their daily limit'
        : 'No eligible BDE left (max, daily limit, previous owner or matching)'
      leftover.push({ leadId: lead.id, reason: r })
      continue
    }
    const scored = eligible.map((c) => {
      const room = 1 - c.open / c.max
      const hit = prefer.filter((m) => { const v = lead.match[m.key]; return v != null && v !== '' && (c.values[m.key] ?? []).includes(v) }).map((m) => m.key)
      const matchFrac = prefer.length ? hit.length / prefer.length : 0
      const score = o.method === 'SMART' ? w.load * room + w.match * matchFrac + w.perf * c.perf
        : o.method === 'WORKLOAD' ? -c.open // fill the lowest first
        : -c.got // EQUAL: fewest given in this run
      return { c, score, hit }
    })
    scored.sort((a, b) => b.score - a.score || (o.method === 'EQUAL' ? a.c.order - b.c.order : a.c.lastAssignedAt - b.c.lastAssignedAt || a.c.order - b.c.order))
    const best = scored[0]
    const c = best.c
    placements.push({
      leadId: lead.id, userId: c.userId,
      reason: { method: o.method, ...(o.method === 'SMART' && { score: Math.round(best.score), perf: Math.round(c.perf * 100) / 100, match: best.hit }), load: `${c.open}/${c.max}` },
    })
    c.open++; c.givenToday++; c.got++
    c.lastAssignedAt = 1e15 + placements.length // just picked → has waited the least
  }
  return {
    placements, leftover, skipped,
    perUser: pool.map((c) => ({ userId: c.userId, name: c.name, get: c.got, openAfter: c.open, max: c.max })),
  }
}

/** BDE performance for Smart (§5.7): conv% ÷ (2 × team avg), capped at 1; too few leads → 0.5. */
export function performance(conv: number, counted: number, teamPct: number, minLeads: number): number {
  if (counted < minLeads || counted === 0) return 0.5
  if (teamPct <= 0) return conv > 0 ? 1 : 0.5
  return Math.min(1, (conv / counted) / (2 * teamPct))
}
