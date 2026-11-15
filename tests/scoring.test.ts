import { describe, expect, it } from 'vitest'
import { isNoReply, posteriorMean, scorePlace, type Features, type Priors } from '../src/main/core/scoring'
import priors from '../resources/data/priors.json'

const P = priors as Priors
const none = { replied: 0, noReply: 0, label: 'Минск: ответили 0 из 0' }
const base: Features = { webClass: 'own', phoneType: 'unknown', reviews: null, rating: null }

describe('posteriorMean', () => {
  it('prior only', () => expect(posteriorMean({ alpha: 2, beta: 18 }, 0, 0)).toBeCloseTo(0.1, 6))
  it('with history', () => expect(posteriorMean({ alpha: 2, beta: 18 }, 8, 24)).toBeCloseTo(0.1923, 4))
})

describe('scorePlace', () => {
  it('no site + mobile', () => {
    const s = scorePlace({ ...base, webClass: 'none', phoneType: 'mobile' }, P.default, none, P.weights, P.default)
    expect(s.p).toBeCloseTo(0.232, 4)
    expect(s.display).toBe(25)
    expect(s.factors.find((f) => f.key === 'web_none')?.deltaPp).toBe(9)
    expect(s.factors.find((f) => f.key === 'phone_mobile')?.deltaPp).toBe(6)
    expect(s.reason).toBe('сайта нет, номер мобильный')
  })
  it('own site + fixed phone', () => {
    const s = scorePlace({ ...base, phoneType: 'fixed' }, P.default, none, P.weights, P.default)
    expect(s.p).toBeCloseTo(0.0693, 4)
    expect(s.display).toBe(5)
  })
  it('no factors -> empty reason', () => {
    expect(scorePlace(base, P.default, none, P.weights, P.default).reason).toBe('')
  })
})

describe('isNoReply', () => {
  const now = 100 * 86_400_000
  it('written 8 days', () => expect(isNoReply({ status: 'written', writtenAt: now - 8 * 86_400_000, everReplied: false }, now, 7)).toBe(true))
  it('written 6 days', () => expect(isNoReply({ status: 'written', writtenAt: now - 6 * 86_400_000, everReplied: false }, now, 7)).toBe(false))
  it('refused no reply', () => expect(isNoReply({ status: 'refused', writtenAt: null, everReplied: false }, now, 7)).toBe(true))
  it('refused after reply', () => expect(isNoReply({ status: 'refused', writtenAt: null, everReplied: true }, now, 7)).toBe(false))
})
