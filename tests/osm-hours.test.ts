import { describe, expect, it } from 'vitest'
import { formatOsmHours } from '../src/main/core/osm-hours'

describe('formatOsmHours', () => {
  it('ranges and lists', () => {
    expect(formatOsmHours('Mo-Fr 09:00-21:00; Sa 10:00-18:00', 'ru')).toEqual(['Пн–Пт 09:00–21:00', 'Сб 10:00–18:00'])
    expect(formatOsmHours('Mo,We 10:00-14:00,15:00-19:00', 'ru')).toEqual(['Пн, Ср 10:00–14:00, 15:00–19:00'])
    expect(formatOsmHours('Mo-Fr,Su 09:00-18:00', 'ru')).toEqual(['Пн–Пт, Вс 09:00–18:00'])
  })
  it('24/7 and daily', () => {
    expect(formatOsmHours('24/7', 'ru')).toEqual(['Круглосуточно'])
    expect(formatOsmHours('24/7', 'uk')).toEqual(['Цілодобово'])
    expect(formatOsmHours('Mo-Su 08:00-22:00', 'ru')).toEqual(['Ежедневно 08:00–22:00'])
    expect(formatOsmHours('Mo-Su 08:00-22:00', 'uk')).toEqual(['Щодня 08:00–22:00'])
    expect(formatOsmHours('Sa-Su 10:00-12:00', 'uk')).toEqual(['Сб–Нд 10:00–12:00'])
  })
  it('unsupported returns raw', () => {
    for (const r of ['Mo-Fr 09:00-18:00; PH off', 'sunrise-sunset', 'Mo-Fr 09:00-25:00', 'Fr-Mo 09:00-18:00', '']) {
      expect(formatOsmHours(r, 'ru')).toEqual([r])
    }
  })
})
