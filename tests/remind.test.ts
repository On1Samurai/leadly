process.env.TZ = 'Europe/Minsk'
import { describe, expect, it } from 'vitest'

describe('remindAt', () => {
  const now = new Date(2026, 10, 14, 15, 30).getTime()
  const at = (h: number, d: number, m = 10): number => new Date(2026, m, d, h, 0).getTime()

  it('завтра, 3 дня, неделя: 10:00 местного', async () => {
    const { remindAt } = await import('../src/shared/remind')
    expect(remindAt(now, 'tomorrow')).toBe(at(10, 15))
    expect(remindAt(now, 'days3')).toBe(at(10, 17))
    expect(remindAt(now, 'week')).toBe(at(10, 21))
  })

  it('через границу месяца и после полуночи', async () => {
    const { remindAt } = await import('../src/shared/remind')
    expect(remindAt(new Date(2026, 10, 30, 0, 5).getTime(), 'tomorrow')).toBe(new Date(2026, 11, 1, 10, 0).getTime())
  })

  it('выбранная дата: 10:00 местного этого дня', async () => {
    const { remindAt, parseDateInput } = await import('../src/shared/remind')
    expect(remindAt(now, { date: '2026-12-31' })).toBe(new Date(2026, 11, 31, 10, 0).getTime())
    expect(parseDateInput('2026-12-31')).toEqual({ date: '2026-12-31' })
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('2026-13-40')).toBeNull()
    // прошлое отклоняется; сегодня после 10:00 тоже
    expect(parseDateInput('2026-11-13', now)).toBeNull()
    expect(parseDateInput('2026-11-14', now)).toBeNull()
    expect(parseDateInput('2026-11-15', now)).toEqual({ date: '2026-11-15' })
  })
})
