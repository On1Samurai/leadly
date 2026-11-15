import type { Db } from '../db/db'
import type { BBox, Category, RawPlace } from '../../shared/types'
import { cellCount, cellIndexOf, makeGrid, orderCellsFlagged } from '../core/grid'
import type { GeoMultiPolygon, GeoPolygon } from '../core/geo'
import type { Priors } from '../core/scoring'
import { BudgetExhausted, GoogleAuthError, GoogleTransientError, type GoogleClient } from '../sources/google'
import { OverpassUnavailable } from '../sources/osm'
import { rescore } from './rescore'
import { upsertRaw } from './upsert'

export { upsertRaw } from './upsert'
export { rescore } from './rescore'

export interface PassParams {
  cityId: number; categoryId: string; country: string; lang: 'ru' | 'uk'; sizeKm: number
  densityThreshold: number; nextPageThreshold: number; randomEvery: number; budget: number
}
export interface PassSummary { passId: number; cellsDone: number; newCount: number; dupCount: number; googleUsed: number; stopped: boolean }
export type PassEvent =
  | { type: 'cell'; cellId: number; ix: number; iy: number; newCount: number; dupCount: number; googleRequests: number }
  | { type: 'warning'; text: string }
  | { type: 'done'; summary: PassSummary }
export interface PassControl { paused: boolean; stopped: boolean }
export interface PassDeps {
  db: Db; osm: (bbox: BBox, cat: Category) => Promise<RawPlace[]>; google: GoogleClient | null
  rng: () => number; now: () => number; emit: (e: PassEvent) => void; categories: Category[]; priors: Priors
}

const OSM_TTL = 7 * 86_400_000
interface CellRow { id: number; ix: number; iy: number; bbox: string; osmCount: number; googleYield: number | null }
interface Tally { n: number; d: number; g: number }

export const MAX_CELLS = 2500

/** Сетка города по размеру квадрата. Размер сменился — сетка строится заново, места переносятся в новые квадраты. */
export function ensureCells(db: Db, cityId: number, sizeKm: number): void {
  const c = db.prepare('SELECT bbox, polygon, size_km AS sizeKm FROM cities WHERE id=?').get(cityId) as { bbox: string; polygon: string | null; sizeKm: number | null }
  const has = db.prepare('SELECT 1 FROM cells WHERE city_id=? LIMIT 1').get(cityId)
  if (has && c.sizeKm === sizeKm) return
  const bbox = JSON.parse(c.bbox) as BBox
  if (cellCount(bbox, sizeKm) > MAX_CELLS) throw new Error('city_too_large')
  const grid = makeGrid(bbox, sizeKm, c.polygon ? (JSON.parse(c.polygon) as GeoPolygon | GeoMultiPolygon) : undefined)
  const ins = db.prepare('INSERT INTO cells(city_id,ix,iy,bbox) VALUES (?,?,?,?)')
  db.transaction(() => {
    if (has) {
      db.prepare('UPDATE places SET cell_id=NULL WHERE city_id=?').run(cityId)
      db.prepare('DELETE FROM pass_cells WHERE cell_id IN (SELECT id FROM cells WHERE city_id=?)').run(cityId)
      db.prepare('DELETE FROM cells WHERE city_id=?').run(cityId)
    }
    const byIdx = new Map<string, number>()
    for (const g of grid) byIdx.set(`${g.ix},${g.iy}`, Number(ins.run(cityId, g.ix, g.iy, JSON.stringify(g.bbox)).lastInsertRowid))
    if (has) {
      const upd = db.prepare('UPDATE places SET cell_id=? WHERE id=?')
      for (const p of db.prepare('SELECT id, lat, lon FROM places WHERE city_id=?').all(cityId) as { id: number; lat: number; lon: number }[]) {
        const { ix, iy } = cellIndexOf(p.lat, p.lon, bbox, sizeKm)
        const cell = byIdx.get(`${ix},${iy}`)
        if (cell !== undefined) upd.run(cell, p.id)
      }
    }
    db.prepare('UPDATE cities SET size_km=? WHERE id=?').run(sizeKm, cityId)
  })()
}

async function loadOsm(deps: PassDeps, cityId: number, cat: Category, bbox: BBox): Promise<RawPlace[]> {
  const key = `${cityId}:${cat.id}`
  const hit = deps.db.prepare('SELECT json, fetched_at AS at FROM osm_cache WHERE key=?').get(key) as { json: string; at: number } | undefined
  if (hit && deps.now() - hit.at < OSM_TTL) return JSON.parse(hit.json) as RawPlace[]
  const places = await deps.osm(bbox, cat)
  deps.db.prepare('INSERT INTO osm_cache(key,json,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at')
    .run(key, JSON.stringify(places), deps.now())
  return places
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runPass(deps: PassDeps, p: PassParams, ctl: PassControl): Promise<PassSummary> {
  const { db } = deps
  const cat = deps.categories.find((c) => c.id === p.categoryId)
  if (!cat) throw new Error(`Unknown category ${p.categoryId}`)
  const city = db.prepare('SELECT bbox FROM cities WHERE id=?').get(p.cityId) as { bbox: string }
  const cityBox = JSON.parse(city.bbox) as BBox
  const passId = Number(db.prepare(
    "INSERT INTO passes(city_id,category,mode,budget,started_at) VALUES (?,?,'full',?,?)"
  ).run(p.cityId, p.categoryId, p.budget, deps.now()).lastInsertRowid)
  const sum: PassSummary = { passId, cellsDone: 0, newCount: 0, dupCount: 0, googleUsed: 0, stopped: false }

  try {
    ensureCells(db, p.cityId, p.sizeKm)
    const cells = db.prepare(
      'SELECT id, ix, iy, bbox, osm_count AS osmCount, google_yield AS googleYield FROM cells WHERE city_id=?'
    ).all(p.cityId) as CellRow[]
    const byIdx = new Map(cells.map((c) => [`${c.ix},${c.iy}`, c]))
    const tally = new Map<number, Tally>()
    const t = (id: number): Tally => { let x = tally.get(id); if (!x) { x = { n: 0, d: 0, g: 0 }; tally.set(id, x) } return x }
    const ctxFor = (cellId: number | null) => ({ country: p.country, cityId: p.cityId, cellId, categoryId: p.categoryId, now: deps.now() })
    const add = (raw: RawPlace): void => {
      const { ix, iy } = cellIndexOf(raw.lat, raw.lon, cityBox, p.sizeKm)
      const cell = byIdx.get(`${ix},${iy}`) ?? null
      const r = upsertRaw(db, raw, ctxFor(cell?.id ?? null))
      if (r === 'suppressed') return
      if (r === 'new') sum.newCount++; else sum.dupCount++
      if (cell) { if (r === 'new') t(cell.id).n++; else t(cell.id).d++ }
    }

    // OSM по всему городу
    try {
      const osm = await loadOsm(deps, p.cityId, cat, cityBox)
      const counts = new Map<number, number>()
      for (const raw of osm) {
        add(raw)
        const { ix, iy } = cellIndexOf(raw.lat, raw.lon, cityBox, p.sizeKm)
        const c = byIdx.get(`${ix},${iy}`)
        if (c) counts.set(c.id, (counts.get(c.id) ?? 0) + 1)
      }
      const upd = db.prepare('UPDATE cells SET osm_count=? WHERE id=?')
      db.transaction(() => { for (const c of cells) { c.osmCount = counts.get(c.id) ?? 0; upd.run(c.osmCount, c.id) } })()
    } catch (e) {
      if (!(e instanceof OverpassUnavailable)) throw e
      deps.emit({ type: 'warning', text: 'OpenStreetMap не отвечает, ищем только в Google' })
    }

    let googleOn = deps.google !== null && p.categoryId !== 'b2b' // B2B только по OSM (спец. §8.2)
    const byId = new Map(cells.map((c) => [c.id, c]))
    const order = orderCellsFlagged(cells.map((c) => ({ id: c.id, osmCount: c.osmCount, googleYield: c.googleYield ?? 0 })), p.randomEvery, deps.rng)
    for (const { cell: st, random } of order) {
      while (ctl.paused && !ctl.stopped) await sleep(100)
      if (ctl.stopped) { sum.stopped = true; break }
      const cell = byId.get(st.id)!
      const tl = t(cell.id)
      if (googleOn && (cell.osmCount >= p.densityThreshold || (cell.googleYield ?? 0) > 0 || random)) {
        let token: string | undefined
        let newG = 0
        let ok = false
        try {
          for (;;) {
            if (sum.googleUsed >= p.budget) { googleOn = false; break }
            sum.googleUsed++; tl.g++
            let page
            try {
              page = await deps.google!.search(JSON.parse(cell.bbox) as BBox, cat, p.lang, token)
            } catch (e) {
              if (e instanceof BudgetExhausted) { sum.googleUsed--; tl.g-- }
              throw e
            }
            let fresh = 0
            for (const raw of page.places) {
              const before = sum.newCount
              add(raw)
              if (sum.newCount > before) fresh++
            }
            ok = true
            newG += fresh
            token = page.nextPageToken
            if (!token || fresh < p.nextPageThreshold) break
          }
        } catch (e) {
          if (e instanceof BudgetExhausted) googleOn = false
          else if (e instanceof GoogleAuthError) {
            googleOn = false
            deps.emit({ type: 'warning', text: 'Google не принял ключ — проверьте его в настройках' })
          } else if (!(e instanceof GoogleTransientError)) throw e
        }
        if (ok) {
          cell.googleYield = newG
          db.prepare('UPDATE cells SET google_yield=?, last_google_at=? WHERE id=?').run(newG, deps.now(), cell.id)
        }
      }
      db.prepare("INSERT INTO pass_cells(pass_id,cell_id,state,new_count,dup_count,google_requests) VALUES (?,?,'done',?,?,?)")
        .run(passId, cell.id, tl.n, tl.d, tl.g)
      sum.cellsDone++
      deps.emit({ type: 'cell', cellId: cell.id, ix: cell.ix, iy: cell.iy, newCount: tl.n, dupCount: tl.d, googleRequests: tl.g })
    }

    rescore(db, deps.priors, { categoryId: p.categoryId, cityId: p.cityId }, deps.now())
    deps.emit({ type: 'done', summary: sum })
    return sum
  } finally {
    db.prepare('UPDATE passes SET finished_at=?, google_used=?, cells_done=?, new_count=?, dup_count=? WHERE id=?')
      .run(deps.now(), sum.googleUsed, sum.cellsDone, sum.newCount, sum.dupCount, passId)
  }
}
