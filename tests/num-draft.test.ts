import { describe, expect, it } from 'vitest'
import { parseNumDraft } from '../src/shared/settings'

describe('parseNumDraft', () => {
  it('пусто -> null', () => { expect(parseNumDraft('', 'dailyGoal')).toBeNull(); expect(parseNumDraft('  ', 'googleBudget')).toBeNull() })
  it('0 на поле с min 1 -> null, на min 0 -> 0', () => {
    expect(parseNumDraft('0', 'dailyGoal')).toBeNull()
    expect(parseNumDraft('0', 'randomEvery')).toBeNull()
    expect(parseNumDraft('0', 'googleBudget')).toBe(0)
  })
  it('выше max -> null', () => { expect(parseNumDraft('1000001', 'googleBudget')).toBeNull(); expect(parseNumDraft('1000000', 'googleBudget')).toBe(1_000_000) })
  it('валидное и мусор', () => { expect(parseNumDraft(' 12 ', 'dailyGoal')).toBe(12); expect(parseNumDraft('1.5', 'dailyGoal')).toBeNull(); expect(parseNumDraft('-3', 'dailyGoal')).toBeNull() })
})
