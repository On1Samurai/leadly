import type { TodayView } from '../shared/ipc'
import type { Place } from '../shared/types'
import type { Db } from './db/db'
import { getPlace } from './db/repo'
import { toView } from './ipc/places'
import { loadSettings } from './settings'
import { atLocal } from './time'


/** «Сегодня»: written считается с локальной полуночи. */
export function todayView(db: Db, now: number, goal: number): TodayView {
  const s = loadSettings(db)
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  const written = (db.prepare("SELECT COUNT(DISTINCT place_id) AS n FROM status_log WHERE to_status='written' AND at>=?")
    .get(from) as { n: number }).n
  const views = (ids: { id: number }[]) => ids.map((r) => getPlace(db, r.id)).filter((p): p is Place => p !== null)
    .map((p) => toView(db, p, s))
  const remindToday = views(db.prepare(
    "SELECT id FROM places WHERE remind_at IS NOT NULL AND remind_at < ? AND status NOT IN ('refused','deal') ORDER BY remind_at"
  ).all(atLocal(now, '00:00', 1)) as { id: number }[])
  const replied = views(db.prepare("SELECT id FROM places WHERE status='replied' ORDER BY score DESC, id LIMIT 50").all() as { id: number }[])
  const wanted = views(db.prepare(
    `SELECT p.id FROM places p WHERE p.status NOT IN ('deal','refused') AND EXISTS (
       SELECT 1 FROM demo_events e JOIN demos d ON d.id=e.demo_id WHERE d.place_id=p.id AND e.kind='want' AND e.ts>=?
         AND e.ts>COALESCE((SELECT MAX(created_at) FROM messages m WHERE m.place_id=p.id AND m.direction='out'),0))
     ORDER BY p.score DESC, p.id LIMIT 50`
  ).all(now - 7 * 86_400_000) as { id: number }[])
  return { goal, written, remindToday, replied, wanted, leftToday: Math.max(0, goal - written) }
}
