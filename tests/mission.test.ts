import { describe, expect, it } from 'vitest'
import { computeMission } from '../src/shared/mission'

const base = { cities: 1, places: 20, inBase: 1, written: 1 }

describe('computeMission', () => {
  it('шаг 1: нет городов', () => expect(computeMission({ ...base, cities: 0 })).toBe(1))
  it('шаг 2: мест меньше 20', () => {
    expect(computeMission({ ...base, places: 19 })).toBe(2)
    expect(computeMission({ ...base, places: 0 })).toBe(2)
  })
  it('шаг 3: 20 мест, в базе 0', () => expect(computeMission({ ...base, inBase: 0 })).toBe(3))
  it('шаг 4: в базе есть, написано 0', () => expect(computeMission({ ...base, written: 0 })).toBe(4))
  it('done', () => expect(computeMission(base)).toBe('done'))
  it('приоритет: города важнее мест', () => expect(computeMission({ cities: 0, places: 0, inBase: 0, written: 0 })).toBe(1))
})
