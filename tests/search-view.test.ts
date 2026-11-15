import { describe, expect, it } from 'vitest'
import { cellStyle, passErrorText, topThreshold } from '../src/renderer/src/search-view'

describe('search-view', () => {
  it('cellStyle: пустой квадрат — только контур', () => {
    expect(cellStyle(0, 10, false)).toEqual({ fillOpacity: 0, weight: 0.5, color: '#ffffff', opacity: 0.25 })
  })
  it('cellStyle: заливка пропорциональна newCount', () => {
    expect(cellStyle(10, 10, false).fillOpacity).toBeCloseTo(0.58)
    expect(cellStyle(5, 10, false).fillOpacity).toBeCloseTo(0.33)
    expect(cellStyle(3, 0, false).fillOpacity).toBeCloseTo(0.08)
  })
  it('cellStyle: верхние — толстый контур', () => {
    const s = cellStyle(4, 10, true)
    expect(s.weight).toBe(2.5)
    expect(s.opacity).toBe(1)
  })
  it('topThreshold: верхние 10% среди положительных, минимум один', () => {
    expect(topThreshold([0, 0, 0])).toBe(Infinity)
    expect(topThreshold([0, 7, 3])).toBe(7)
    const many = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(topThreshold(many)).toBe(19)
  })
  it('passErrorText: русские сообщения', () => {
    expect(passErrorText(new Error("Error invoking remote method 'pass.start': Error: pass_running"))).toBe('Поиск уже идёт')
    expect(passErrorText(new Error('city_too_large'))).toBe('Слишком большая территория — выберите город, а не область или страну')
    expect(passErrorText(new Error('boom'))).toBe('Ошибка: boom')
  })
})
