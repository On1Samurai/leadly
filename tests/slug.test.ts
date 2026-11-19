import { describe, expect, it } from 'vitest'
import { makeSlug, SLUG_RE } from '../src/main/demo/slug'

describe('makeSlug', () => {
  it('translits name and adds suffix', () => {
    const s = makeSlug('Кофе Поинт', () => 0, () => false)
    expect(s).toMatch(/^kofe-point-[a-z0-9]{4}$/)
    expect(SLUG_RE.test(s)).toBe(true)
  })
  it('retries when taken', () => {
    let n = 0
    let calls = 0
    const rng = () => (calls++ % 36) / 36
    const s = makeSlug('Кофе', rng, () => n++ < 2)
    expect(n).toBe(3)
    expect(s).toMatch(/^kofe-/)
  })
  it('throws when exhausted', () => {
    expect(() => makeSlug('Кофе', () => 0.5, () => true)).toThrow('slug_exhausted')
  })
  it('emoji-only name gives demo', () => {
    expect(makeSlug('☕🍰', () => 0, () => false)).toMatch(/^demo-[a-z0-9]{4}$/)
  })
})
