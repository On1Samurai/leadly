import type { Db } from '../db/db'
import { getPlace, getSetting, setSetting, setStatus } from '../db/repo'
import { rescorePlace } from '../ipc/places'
import type { WorkerApi, WorkerEvent } from './worker-api'

export type DemoNotice = { placeName: string; kind: WorkerEvent['kind'] }

const PAGE = 500
const OPEN_THROTTLE_MS = 60 * 60_000
const THROTTLE_KEEP_MS = 24 * 60 * 60_000

/** Забирает новые события Worker; возвращает число новых. Уведомления уходят после коммита страницы. */
export async function syncDemoEvents(
  db: Db, api: Pick<WorkerApi, 'events'>, now: number, notify: (e: DemoNotice) => Promise<void>
): Promise<number> {
  let total = 0
  for (;;) {
    const page = await api.events(getSetting<number>(db, 'demo:cursor', 0))
    if (!page.length) break
    const fresh = db.transaction((): (DemoNotice & { slug: string })[] => {
      const out: (DemoNotice & { slug: string })[] = []
      const demo = db.prepare('SELECT id, place_id AS placeId FROM demos WHERE slug=?')
      const ins = db.prepare('INSERT OR IGNORE INTO demo_events(demo_id,remote_id,kind,ts) VALUES (?,?,?,?)')
      for (const e of page) {
        const d = demo.get(e.slug) as { id: number; placeId: number } | undefined
        if (!d || ins.run(d.id, e.id, e.kind, e.ts).changes !== 1) continue
        const p = getPlace(db, d.placeId)
        if (!p) continue
        if (p.status === 'new' || p.status === 'written') {
          setStatus(db, p.id, 'demo_opened', now)
          rescorePlace(db, p, now)
        }
        out.push({ placeName: p.name, kind: e.kind, slug: e.slug })
      }
      setSetting(db, 'demo:cursor', Math.max(...page.map((e) => e.id)))
      return out
    })()
    total += fresh.length
    const last = getSetting<Record<string, number>>(db, 'demo:lastOpenNotify', {})
    let touched = false
    for (const { slug, ...n } of fresh) {
      const prev = last[slug]
      if (n.kind === 'open') {
        if (now - (prev ?? -Infinity) < OPEN_THROTTLE_MS) continue
        last[slug] = now; touched = true
      }
      try { await notify(n) } catch (e) {
        console.error('demo notify failed', (e as Error).name)
        // уведомление не ушло: слот не занят, следующее открытие уведомит
        if (n.kind === 'open') { if (prev === undefined) delete last[slug]; else last[slug] = prev }
      }
    }
    if (touched) {
      for (const k of Object.keys(last)) if (now - last[k] > THROTTLE_KEEP_MS) delete last[k]
      setSetting(db, 'demo:lastOpenNotify', last)
    }
    if (page.length < PAGE) break
  }
  return total
}
