import type { Db } from '../db/db'
import { setSetting } from '../db/repo'
import { loadSettings } from '../settings'
import { historyOf, loadRows, modelWeights, REPLIED_NOW, rescore } from '../search/rescore'
import { applicable, isNoReply, logit, posteriorMean, sigmoid, type Priors, type WeightKey } from './scoring'

export interface Sample { keys: WeightKey[]; offset: number; y: 0 | 1 }
export interface Model { weights: Record<WeightKey, number>; n: number; positives: number; trainedAt: number }
export { modelWeights }
export const MIN_LABELS = 30
export const MIN_POSITIVE = 5

/** MAP-оценка весов: градиентный спуск от w0 с гауссовым априором sigma. */
export function fitWeights(
  samples: Sample[], w0: Record<WeightKey, number>, sigma = 0.5, iters = 200
): Record<WeightKey, number> {
  const w = { ...w0 }
  if (!samples.length) return w
  const keys = Object.keys(w0) as WeightKey[]
  for (let it = 0; it < iters; it++) {
    const g = Object.fromEntries(keys.map((k) => [k, 0])) as Record<WeightKey, number>
    for (const s of samples) {
      const z = s.offset + s.keys.reduce((a, k) => a + w[k], 0)
      const err = sigmoid(z) - s.y
      for (const k of s.keys) g[k] += err
    }
    for (const k of keys) w[k] -= (0.5 / samples.length) * (g[k] + (w[k] - w0[k]) / (sigma * sigma))
  }
  return w
}

export function trainModel(db: Db, priors: Priors, now: number): Model | null {
  const days = loadSettings(db).noReplyDays
  const pairs = db.prepare('SELECT DISTINCT category AS categoryId, city_id AS cityId FROM places')
    .all() as { categoryId: string; cityId: number }[]
  const samples: Sample[] = []
  let positives = 0
  for (const pair of pairs) {
    const rows = loadRows(db, pair)
    // shortcut: история пары включает само место (утечка метки), при росте базы считать историю без него
    const h = historyOf(db, rows, pair.cityId, now)
    const prior = priors.categories[pair.categoryId] ?? priors.default
    const offset = logit(posteriorMean(prior, h.replied, h.noReply))
    for (const r of rows) {
      const ever = r.wasReplied === 1 || REPLIED_NOW.includes(r.status)
      const y = ever ? 1 : isNoReply({ status: r.status, writtenAt: r.writtenAt, everReplied: ever }, now, days) ? 0 : null
      if (y === null) continue
      if (y === 1) positives++
      samples.push({ keys: applicable({ webClass: r.webClass, phoneType: r.phoneType, reviews: r.reviews, rating: r.rating }), offset, y })
    }
  }
  if (samples.length < MIN_LABELS || positives < MIN_POSITIVE) {
    db.prepare("DELETE FROM settings WHERE key='model'").run()
    return null
  }
  const model: Model = { weights: fitWeights(samples, priors.weights), n: samples.length, positives, trainedAt: now }
  setSetting(db, 'model', model)
  return model
}

export function rescoreAll(db: Db, priors: Priors, now: number): void {
  trainModel(db, priors, now)
  const { weights } = modelWeights(db, priors)
  const pairs = db.prepare('SELECT DISTINCT category AS categoryId, city_id AS cityId FROM places')
    .all() as { categoryId: string; cityId: number }[]
  for (const p of pairs) rescore(db, priors, p, now, weights)
}
