import type { PhoneType, Status, WebClass } from '../../shared/types'

export interface Prior { alpha: number; beta: number }
export type WeightKey = 'web_none' | 'web_social' | 'web_template' | 'phone_mobile' | 'phone_fixed'
  | 'reviews_lt10' | 'reviews_gt100' | 'rating_lt4'
export interface Priors { default: Prior; categories: Record<string, Prior>; weights: Record<WeightKey, number> }
export interface Features { webClass: WebClass; phoneType: PhoneType; reviews: number | null; rating: number | null }
export interface History { replied: number; noReply: number; label: string }
export interface Factor { group: 'need' | 'reach' | 'response'; key: string; label: string; deltaPp: number }
export interface Score { p: number; display: number; factors: Factor[]; reason: string }

const LABELS: Record<WeightKey, string> = {
  web_none: 'сайта нет', web_social: 'только соцсети', web_template: 'шаблонное меню',
  phone_mobile: 'номер мобильный', phone_fixed: 'номер городской',
  reviews_lt10: 'мало отзывов', reviews_gt100: 'много отзывов', rating_lt4: 'рейтинг ниже 4'
}
const GROUPS: Record<WeightKey, 'need' | 'reach'> = {
  web_none: 'need', web_social: 'need', web_template: 'need', rating_lt4: 'need',
  phone_mobile: 'reach', phone_fixed: 'reach', reviews_lt10: 'reach', reviews_gt100: 'reach'
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))
export const logit = (p: number): number => {
  const c = Math.min(1 - 1e-6, Math.max(1e-6, p))
  return Math.log(c / (1 - c))
}

export function posteriorMean(prior: Prior, replied: number, noReply: number): number {
  const a = prior.alpha + replied
  return a / (a + prior.beta + noReply)
}

export function applicable(f: Features): WeightKey[] {
  const keys: WeightKey[] = []
  if (f.webClass === 'none') keys.push('web_none')
  else if (f.webClass === 'social') keys.push('web_social')
  else if (f.webClass === 'template') keys.push('web_template')
  if (f.phoneType === 'mobile') keys.push('phone_mobile')
  else if (f.phoneType === 'fixed') keys.push('phone_fixed')
  if (f.reviews !== null && f.reviews < 10) keys.push('reviews_lt10')
  if (f.reviews !== null && f.reviews > 100) keys.push('reviews_gt100')
  if (f.rating !== null && f.rating < 4) keys.push('rating_lt4')
  return keys
}

export function scorePlace(
  f: Features, prior: Prior, hist: History, weights: Priors['weights'], defaultPrior: Prior
): Score {
  const mean = posteriorMean(prior, hist.replied, hist.noReply)
  const baseLogit = logit(mean)
  const keys = applicable(f)
  const total = keys.reduce((s, k) => s + weights[k], 0)
  const p = sigmoid(baseLogit + total)

  const factors: Factor[] = keys.map((k) => ({
    group: GROUPS[k], key: k, label: LABELS[k],
    deltaPp: Math.round((p - sigmoid(baseLogit + total - weights[k])) * 100)
  }))
  if (hist.replied + hist.noReply > 0) {
    factors.push({
      group: 'response', key: 'history', label: hist.label,
      deltaPp: Math.round((mean - posteriorMean(defaultPrior, 0, 0)) * 100)
    })
  }

  const own = factors.filter((x) => x.group !== 'response')
  const positive = own.filter((x) => x.deltaPp > 0).sort((a, b) => b.deltaPp - a.deltaPp).slice(0, 2)
  let reason = ''
  if (positive.length) reason = positive.map((x) => x.label).join(', ')
  else if (own.length) reason = own.reduce((m, x) => (Math.abs(x.deltaPp) > Math.abs(m.deltaPp) ? x : m)).label

  return { p, display: Math.max(5, Math.round((p * 100) / 5) * 5), factors, reason }
}

export function isNoReply(
  s: { status: Status; writtenAt: number | null; everReplied: boolean }, now: number, days: number
): boolean {
  if (s.status === 'written') return s.writtenAt !== null && now - s.writtenAt >= days * 86_400_000
  if (s.status === 'refused') return !s.everReplied
  return false
}
