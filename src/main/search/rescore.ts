import type { Db } from '../db/db'
import { loadSettings } from '../settings'
import { isNoReply, scorePlace, type History, type Priors } from '../core/scoring'
import type { PhoneType, Status, WebClass } from '../../shared/types'

const REPLIED_NOW: Status[] = ['replied', 'demo_opened', 'call', 'deal']

interface Row {
  id: number; status: Status; webClass: WebClass; phoneType: PhoneType; reviews: number | null; rating: number | null
  wasReplied: number; writtenAt: number | null
}

function loadRows(db: Db, scope: { categoryId: string; cityId: number }): Row[] {
  return db.prepare(
    `SELECT p.id, p.status, p.web_class AS webClass, p.phone_type AS phoneType, p.reviews, p.rating,
       EXISTS(SELECT 1 FROM status_log l WHERE l.place_id=p.id AND l.to_status='replied') AS wasReplied,
       (SELECT MAX(l.at) FROM status_log l WHERE l.place_id=p.id AND l.to_status='written') AS writtenAt
     FROM places p WHERE p.category=? AND p.city_id=?`
  ).all(scope.categoryId, scope.cityId) as Row[]
}

function historyOf(db: Db, rows: Row[], cityId: number, now: number): History {
  const days = loadSettings(db).noReplyDays
  let replied = 0
  let noReply = 0
  for (const r of rows) {
    const ever = r.wasReplied === 1 || REPLIED_NOW.includes(r.status)
    if (ever) replied++
    if (isNoReply({ status: r.status, writtenAt: r.writtenAt, everReplied: ever }, now, days)) noReply++
  }
  const cityName = (db.prepare('SELECT name FROM cities WHERE id=?').get(cityId) as { name: string } | undefined)?.name ?? ''
  return { replied, noReply, label: `${cityName}: ответили ${replied} из ${replied + noReply}` }
}

/** История ответов категории в городе (для карточки места). */
export function historyFor(db: Db, scope: { categoryId: string; cityId: number }, now: number): History {
  return historyOf(db, loadRows(db, scope), scope.cityId, now)
}

/** Пересчёт score/score_reason всех мест категории в городе по истории ответов. */
export function rescore(db: Db, priors: Priors, scope: { categoryId: string; cityId: number }, now: number): void {
  const rows = loadRows(db, scope)
  const hist = historyOf(db, rows, scope.cityId, now)
  const prior = priors.categories[scope.categoryId] ?? priors.default
  const upd = db.prepare('UPDATE places SET score=?, score_reason=? WHERE id=?')
  db.transaction(() => {
    for (const r of rows) {
      const s = scorePlace(
        { webClass: r.webClass, phoneType: r.phoneType, reviews: r.reviews, rating: r.rating },
        prior, hist, priors.weights, priors.default
      )
      upd.run(Math.round(s.p * 1000) / 10, s.reason, r.id)
    }
  })()
}
