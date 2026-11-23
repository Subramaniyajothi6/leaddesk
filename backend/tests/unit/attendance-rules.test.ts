import { describe, it, expect } from 'vitest'
import { computeDay, attendanceBp } from '../../src/modules/attendance/rules.js'
import { DEFAULTS } from '../../src/lib/settings.js'
import { atLocal } from '../../src/lib/time.js'

const tz = 'Asia/Kolkata'
const s = DEFAULTS.attendance
const at = (ymd: string, hhmm: string) => atLocal(ymd, hhmm, tz)
const day = (o: Partial<Parameters<typeof computeDay>[0]> = {}) => computeDay({ ymd: '2026-11-18', punchInAt: null, punchOutAt: null, joinedOn: new Date('2026-01-01'), exitedOn: null, holiday: false, weekOff: false, leave: false, closed: true, ...o }, s, tz)

describe('day status (§10.3)', () => {
  it('full day on time → PRESENT', () => expect(day({ punchInAt: at('2026-11-18', '09:30'), punchOutAt: at('2026-11-18', '18:30') })).toMatchObject({ dayStatus: 'PRESENT', workedMin: 540, late: false, earlyOut: false }))
  it('late after the 10-min grace is a flag; the day can still be PRESENT', () => expect(day({ punchInAt: at('2026-11-18', '09:41'), punchOutAt: at('2026-11-18', '18:30') })).toMatchObject({ dayStatus: 'PRESENT', late: true }))
  it('09:40 is within grace', () => expect(day({ punchInAt: at('2026-11-18', '09:40'), punchOutAt: at('2026-11-18', '18:30') }).late).toBe(false))
  it('5 hours → HALF_DAY with early out', () => expect(day({ punchInAt: at('2026-11-18', '09:30'), punchOutAt: at('2026-11-18', '14:30') })).toMatchObject({ dayStatus: 'HALF_DAY', earlyOut: true }))
  it('under 4 hours → ABSENT', () => expect(day({ punchInAt: at('2026-11-18', '09:30'), punchOutAt: at('2026-11-18', '12:00') }).dayStatus).toBe('ABSENT'))
  it('no punch-in → ABSENT once the day is closed, undecided before', () => {
    expect(day().dayStatus).toBe('ABSENT')
    expect(day({ closed: false }).dayStatus).toBeNull()
  })
  it('missing punch-out counts as half day (setting) and is flagged', () => expect(day({ punchInAt: at('2026-11-18', '09:30') })).toMatchObject({ dayStatus: 'HALF_DAY', missingPunchOut: true }))
  it('holiday / week-off / leave are never absent', () => {
    expect(day({ holiday: true }).dayStatus).toBe('HOLIDAY')
    expect(day({ weekOff: true }).dayStatus).toBe('WEEK_OFF')
    expect(day({ leave: true }).dayStatus).toBe('LEAVE')
  })
  it('days before joining or after exit are not working days', () => {
    expect(day({ joinedOn: new Date('2026-11-20') }).working).toBe(false)
    expect(day({ exitedOn: new Date('2026-11-10') }).working).toBe(false)
  })
  it('night shift crossing midnight belongs to the punch-in date', () => {
    const r = day({ punchInAt: at('2026-11-18', '22:00'), punchOutAt: at('2026-11-19', '06:30') })
    expect(r).toMatchObject({ dayStatus: 'PRESENT', workedMin: 510, earlyOut: false })
  })
})

describe('attendance % (§9.2)', () => {
  it('half day = 0.5; holidays, week-offs and leave are not counted', () => {
    const d = (dayStatus: any, working = true) => ({ dayStatus, working })
    expect(attendanceBp([d('PRESENT'), d('HALF_DAY'), d('ABSENT'), d('PRESENT'), d('WEEK_OFF'), d('HOLIDAY'), d('LEAVE'), d(null, false)])).toBe(6250)
  })
})
