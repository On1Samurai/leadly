process.env.TZ = 'America/New_York'
import { describe, expect, it } from 'vitest'
import { atLocal, nextDaily, nextHour } from '../src/main/scheduler'

const H = 3_600_000
describe('DST (America/New_York)', () => {
  it('atLocal keeps wall-clock 09:00 across spring forward and fall back', () => {
    const a = new Date(2026, 2, 7, 10).getTime() // 7 марта
    expect(atLocal(a, '09:00', 1)).toBe(new Date(2026, 2, 8, 9, 0).getTime())
    expect(atLocal(a, '09:00', 1) - a).toBe(22 * H)
    const b = new Date(2026, 9, 31, 10).getTime() // 31 октября
    expect(atLocal(b, '09:00', 1)).toBe(new Date(2026, 10, 1, 9, 0).getTime())
    expect(atLocal(b, '09:00', 1) - b).toBe(24 * H)
  })
  it('nextDaily tomorrow across transitions', () => {
    const a = new Date(2026, 2, 7, 10).getTime()
    expect(nextDaily(a, '04:00', true)).toBe(new Date(2026, 2, 8, 4, 0).getTime())
    const b = new Date(2026, 9, 31, 10).getTime()
    expect(nextDaily(b, '04:00', true)).toBe(new Date(2026, 10, 1, 4, 0).getTime())
  })
  it('nextHour is exactly the next hour boundary, including the repeated hour', () => {
    expect(nextHour(Date.UTC(2026, 2, 8, 6, 30))).toBe(Date.UTC(2026, 2, 8, 7, 0)) // 1:30 EST -> 3:00 EDT
    expect(nextHour(Date.UTC(2026, 10, 1, 5, 30))).toBe(Date.UTC(2026, 10, 1, 6, 0)) // 1:30 EDT -> 1:00 EST
    expect(nextHour(Date.UTC(2026, 10, 1, 6, 30))).toBe(Date.UTC(2026, 10, 1, 7, 0))
  })
})
