import { describe, expect, it } from 'vitest'
import type { PassStatus } from '../src/shared/ipc'
import { cellStyle, cellValue, initialState, passErrorText, reduce, topThreshold } from '../src/renderer/src/search-view'

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

  describe('reduce', () => {
    const status: PassStatus = {
      running: true, cityId: 1, paused: true,
      counters: { cellsDone: 5, cellsTotal: 49, newCount: 12, dupCount: 3, googleUsed: 2 }, warnings: ['w1']
    }
    const cell = (ix: number, n: number): { type: 'cell'; cellId: number; ix: number; iy: number; newCount: number; dupCount: number; googleRequests: number } =>
      ({ type: 'cell', cellId: ix, ix, iy: 0, newCount: n, dupCount: 1, googleRequests: 0 })
    const done = (passId: number): { type: 'done'; summary: { passId: number; cellsDone: number; newCount: number; dupCount: number; googleUsed: number; stopped: boolean } } =>
      ({ type: 'done', summary: { passId, cellsDone: 49, newCount: 20, dupCount: 4, googleUsed: 7, stopped: passId === 0 } })

    it('restore: берёт счётчики, паузу и предупреждения из status', () => {
      const s = reduce(initialState(50), { type: 'restore', status })
      expect(s).toMatchObject({ running: true, paused: true, warnings: ['w1'], counters: { cellsDone: 5, cellsTotal: 49, newCount: 12, dupCount: 3, googleUsed: 2, budget: 50 } })
    })
    it('после restore событие меняет только свой квадрат', () => {
      const s = reduce(reduce(initialState(50), { type: 'restore', status }), { type: 'event', e: cell(2, 4) })
      expect(cellValue(s, { ix: 2, iy: 0, newCount: 9 })).toBe(4)
      expect(cellValue(s, { ix: 3, iy: 0, newCount: 9 })).toBe(9)
      expect(s.counters.cellsDone).toBe(6)
      expect(s.counters.newCount).toBe(16)
    })
    it('start сбрасывает квадраты в 0 для нового прохода', () => {
      const s = reduce(initialState(50), { type: 'start', cellsTotal: 49 })
      expect(cellValue(s, { ix: 3, iy: 0, newCount: 9 })).toBe(0)
      expect(s.running).toBe(true)
    })
    it('warning добавляется в список; city_too_large — в ошибку', () => {
      let s = reduce(initialState(0), { type: 'event', e: { type: 'warning', text: 'x' } })
      expect(s.warnings).toEqual(['x'])
      s = reduce(s, { type: 'event', e: { type: 'warning', text: 'Проход прерван: city_too_large' } })
      expect(s.warnings).toEqual(['x'])
      expect(s.error).toContain('Слишком большая территория')
    })
    it('done: выход из running, итоги из summary, finished', () => {
      const s = reduce(reduce(initialState(5), { type: 'start', cellsTotal: 49 }), { type: 'event', e: done(3) })
      expect(s).toMatchObject({ running: false, paused: false, finished: true, counters: { cellsDone: 49, newCount: 20, dupCount: 4, googleUsed: 7 } })
    })
    it('done с passId 0 (сбой): не finished и счётчики не затираются', () => {
      let s = reduce(initialState(5), { type: 'start', cellsTotal: 49 })
      s = reduce(s, { type: 'event', e: cell(1, 2) })
      s = reduce(s, { type: 'event', e: done(0) })
      expect(s.running).toBe(false)
      expect(s.finished).toBe(false)
      expect(s.counters.newCount).toBe(2)
    })
    it('startFailed: pass_running оставляет running=true, остальное — нет', () => {
      const s0 = reduce(initialState(5), { type: 'start', cellsTotal: 1 })
      expect(reduce(s0, { type: 'startFailed', error: new Error('pass_running') })).toMatchObject({ running: true, error: 'Поиск уже идёт' })
      expect(reduce(s0, { type: 'startFailed', error: new Error('boom') })).toMatchObject({ running: false, error: 'Ошибка: boom' })
    })
  })
})
