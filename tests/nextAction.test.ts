import { describe, expect, it } from 'vitest'
import { nextAction, type NextActionInput } from '../src/shared/nextAction'
import { percentLabel, roundPercent } from '../src/shared/percent'

const mk = (over: Partial<NextActionInput> = {}): NextActionInput => ({
  id: 1, name: 'Кафе', status: 'new', remindAt: null, score: 20, textReady: false, lastIn: null, lastOut: null, ...over
})
const NOW = 1_000_000

describe('nextAction', () => {
  it('напоминание важнее ответа', () => {
    const r = nextAction([
      mk({ id: 1, name: 'А', status: 'replied', lastIn: 5 }),
      mk({ id: 2, name: 'Б', remindAt: NOW - 10 })
    ], NOW)
    expect(r).toEqual({ kind: 'remind', placeId: 2, line: 'Напомнить: Б', button: 'Открыть' })
  })
  it('из просроченных берётся самое старое; будущее не считается', () => {
    const r = nextAction([
      mk({ id: 1, remindAt: NOW - 5 }), mk({ id: 2, remindAt: NOW - 50 }), mk({ id: 3, remindAt: NOW + 5 })
    ], NOW)
    expect(r?.placeId).toBe(2)
  })
  it('ответ важнее нового', () => {
    const r = nextAction([
      mk({ id: 1, score: 90, textReady: true }),
      mk({ id: 2, name: 'Ответил', status: 'replied', lastIn: 10, lastOut: 5 })
    ], NOW)
    expect(r).toEqual({ kind: 'reply', placeId: 2, line: 'Ответил ответили — ответьте', button: 'Ответить' })
  })
  it('из новых выбран с textReady, даже если score ниже', () => {
    const r = nextAction([
      mk({ id: 1, score: 80 }), mk({ id: 2, name: 'Готов', score: 20, textReady: true })
    ], NOW)
    expect(r).toEqual({ kind: 'write', placeId: 2, line: 'Готов: ≈20%, текст готов', button: 'Написать' })
  })
  it('нет textReady — лучший new по score', () => {
    const r = nextAction([mk({ id: 1, score: 20 }), mk({ id: 2, name: 'Топ', score: 41 })], NOW)
    expect(r).toEqual({ kind: 'write', placeId: 2, line: 'Топ: ≈40%', button: 'Написать' })
  })
  it('без кандидатов null', () => {
    expect(nextAction([], NOW)).toBeNull()
    expect(nextAction([mk({ status: 'written' }), mk({ status: 'deal' })], NOW)).toBeNull()
  })
  it('ответ, на который уже ответили, не выбирается', () => {
    expect(nextAction([mk({ status: 'replied', lastIn: 5, lastOut: 9 })], NOW)).toBeNull()
    expect(nextAction([mk({ status: 'replied', lastIn: 5, lastOut: 5 })], NOW)).toBeNull()
  })
})

describe('percent', () => {
  it('округляет до 5, минимум 5', () => {
    expect(roundPercent(0)).toBe(5)
    expect(roundPercent(2.4)).toBe(5)
    expect(roundPercent(23.2)).toBe(25)
    expect(roundPercent(22.4)).toBe(20)
    expect(roundPercent(97)).toBe(95)
    expect(percentLabel(23.2)).toBe('≈25%')
  })
})
