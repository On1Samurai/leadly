import { PASS_EVENT, type PassEvent } from '../../shared/ipc'
import { enqueueAudits } from '../audit/queue'
import { runPass, type PassControl, type PassParams } from '../search/pass'
import { Budget, GoogleClient } from '../sources/google'
import { getSecret } from '../secrets'
import { loadSettings } from '../settings'
import { CATEGORIES, PRIORS } from './data'
import { define, type IpcDeps, type Table } from './define'

export function passHandlers(t: Table, d: IpcDeps): { isRunning(): boolean } {
  let current: PassControl | null = null
  let currentCity: number | null = null
  let counters = { cellsDone: 0, newCount: 0, dupCount: 0, googleUsed: 0 }
  let warnings: string[] = []

  define(t, 'pass.start', (e, p) => {
    if (current) throw new Error('pass_running')
    if (!CATEGORIES.some((c) => c.id === p.categoryId)) throw new Error('unknown_category')
    const city = d.db.prepare('SELECT 1 FROM cities WHERE id=?').get(p.cityId)
    if (!city) throw new Error('no_city')
    const s = loadSettings(d.db)
    const key = getSecret(d.db, 'google', d.secretEnv)
    const google = key ? new GoogleClient(key, new Budget(s.googleBudget)) : null
    const params: PassParams = {
      cityId: p.cityId, categoryId: p.categoryId, country: s.country, lang: s.lang, sizeKm: s.sizeKm,
      densityThreshold: s.densityThreshold, nextPageThreshold: s.nextPageThreshold, randomEvery: s.randomEvery,
      budget: s.googleBudget
    }
    const ctl: PassControl = { paused: false, stopped: false }
    current = ctl
    currentCity = p.cityId
    counters = { cellsDone: 0, newCount: 0, dupCount: 0, googleUsed: 0 }
    warnings = []
    const emit = (ev: PassEvent): void => {
      if (ev.type === 'cell') {
        counters.cellsDone++; counters.newCount += ev.newCount; counters.dupCount += ev.dupCount; counters.googleUsed += ev.googleRequests
      } else if (ev.type === 'warning') warnings.push(ev.text)
      try { e.sender.send(PASS_EVENT, ev) } catch { /* окно закрыто */ }
      if (ev.type === 'done') {
        try { enqueueAudits(d.db, d.auditQueue) } catch { /* не мешаем завершению прохода */ }
      }
    }
    void runPass({
      db: d.db, osm: d.osm, google, rng: d.rng, now: d.now, emit, categories: CATEGORIES, priors: PRIORS
    }, params, ctl)
      .catch((err: unknown) => {
        emit({ type: 'warning', text: `Проход прерван: ${err instanceof Error ? err.message : String(err)}` })
        // UI не должен застрять в «идёт проход»
        emit({ type: 'done', summary: { passId: 0, cellsDone: 0, newCount: 0, dupCount: 0, googleUsed: 0, stopped: true } })
      })
      .finally(() => { current = null; currentCity = null; d.onPassEnd?.() })
  })
  define(t, 'pass.status', () => {
    const cellsTotal = currentCity === null ? 0
      : (d.db.prepare('SELECT COUNT(*) AS n FROM cells WHERE city_id=?').get(currentCity) as { n: number }).n
    return {
      running: current !== null, cityId: currentCity, paused: current?.paused ?? false,
      counters: { ...counters, cellsTotal }, warnings: [...warnings]
    }
  })
  define(t, 'pass.pause', () => { if (current) current.paused = true })
  define(t, 'pass.resume', () => { if (current) current.paused = false })
  define(t, 'pass.stop', () => { if (current) { current.stopped = true; current.paused = false } })
  define(t, 'pass.cells', (_e, cityId) => (d.db.prepare(
    `SELECT c.ix, c.iy, c.bbox, COALESCE(SUM(pc.new_count),0) AS newCount, COALESCE(SUM(pc.google_requests),0) AS googleRequests
     FROM cells c LEFT JOIN pass_cells pc ON pc.cell_id=c.id WHERE c.city_id=? GROUP BY c.id ORDER BY c.iy, c.ix`
  ).all(cityId) as { ix: number; iy: number; bbox: string; newCount: number; googleRequests: number }[])
    .map((r) => ({ ...r, bbox: JSON.parse(r.bbox) as unknown })))

  return { isRunning: () => current !== null }
}
