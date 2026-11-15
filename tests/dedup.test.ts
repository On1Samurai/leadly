import { describe, expect, it } from 'vitest'
import { findDuplicate, mergePatch, normalizeName, trigramSim } from '../src/main/core/dedup'
import type { Candidate } from '../src/main/db/repo'
import type { Place } from '../src/shared/types'

const cand = (o: Partial<Candidate>): Candidate => ({
  id: 1, googlePlaceId: null, osmId: null, phoneE164: null, name: 'x', lat: 50, lon: 30, ...o
})
// 1 градус широты ~ 111195 м
const dLat = (m: number): number => m / 111195

describe('dedup', () => {
  it('normalizeName strips legal form and translits', () => {
    expect(normalizeName('ООО «Ёлка»')).toBe('elka')
  })
  it('stop-words are whole words only', () => {
    expect(normalizeName('Барбершоп')).toBe('barbershop')
  })
  it('trigramSim basics', () => {
    expect(trigramSim('', '')).toBe(0)
    expect(trigramSim('abc', 'abc')).toBe(1)
  })
  it('osm vs google same cafe', () => {
    const c = [cand({ id: 7, name: 'Кафе «Ромашка»', osmId: 'node/1' })]
    expect(findDuplicate({ googlePlaceId: 'g1', name: 'Romashka Cafe', lat: 50 + dLat(30), lon: 30 }, c)).toBe(7)
  })
  it('chain branches are distinct', () => {
    const c = [cand({ id: 1, name: 'Кофе Хауз' })]
    expect(findDuplicate({ name: 'Кофе Хауз', lat: 50 + dLat(300), lon: 30 }, c)).toBeNull()
  })
  it('same phone far away', () => {
    const c = [cand({ id: 3, name: 'Альфа', phoneE164: '+380441234567' })]
    expect(findDuplicate({ name: 'Омега', phoneE164: '+380441234567', lat: 50 + dLat(2000), lon: 30 }, c)).toBe(3)
  })
  it('same osmId', () => {
    const c = [cand({ id: 4, name: 'A', osmId: 'node/5' })]
    expect(findDuplicate({ osmId: 'node/5', name: 'B', lat: 10, lon: 10 }, c)).toBe(4)
  })
  it('similar names 60 m', () => {
    const c = [cand({ id: 1, name: 'Ромашка' })]
    expect(findDuplicate({ name: 'Ромашка', lat: 50 + dLat(60), lon: 30 }, c)).toBeNull()
  })
  it('picks closest of near duplicates', () => {
    const c = [cand({ id: 1, name: 'Ромашка', lat: 50 + dLat(40) }), cand({ id: 2, name: 'Ромашка', lat: 50 + dLat(10) })]
    expect(findDuplicate({ name: 'Ромашка', lat: 50, lon: 30 }, c)).toBe(2)
  })
  it('mergePatch keeps old values, fills nulls', () => {
    const old = { phoneE164: '+1', website: null, rating: null, reviews: null, googlePlaceId: null, status: 'new', inBase: true } as unknown as Place
    const p = mergePatch(old, { phoneE164: '+2', website: 'http://a', rating: 4.5, reviews: 10, googlePlaceId: 'g', status: 'asked' as Place['status'], inBase: false })
    expect(p).toEqual({ website: 'http://a', rating: 4.5, reviews: 10, googlePlaceId: 'g' })
  })
})
