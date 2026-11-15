import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { ensureCells, runPass, upsertRaw, type PassDeps, type PassEvent, type PassParams, type PassControl } from '../src/main/search/pass'
import { rescore } from '../src/main/search/rescore'
import { deletePlaceForever, setStatus } from '../src/main/db/repo'
import { GoogleAuthError, GoogleTransientError, type GoogleClient } from '../src/main/sources/google'
import { OverpassUnavailable } from '../src/main/sources/osm'
import type { Category, RawPlace } from '../src/shared/types'
import type { Priors } from '../src/main/core/scoring'

const BBOX = { south: 50, west: 30, north: 50.017, east: 30.04 } // сетка 3x2 при 1 км
const DLAT = 1000 / 111320
const DLON = 1000 / (111320 * Math.cos((50.0085 * Math.PI) / 180))
const cat: Category = { id: 'cafe', title: 'Кафе', osm: [{ amenity: 'cafe' }], query: { ru: 'кафе', uk: 'кафе' } }
const priors: Priors = {
  default: { alpha: 1, beta: 9 }, categories: {},
  weights: { web_none: 0.5, web_social: 0.5, web_template: 0.5, phone_mobile: 0.5, phone_fixed: 0.5, reviews_lt10: 0.5, reviews_gt100: 0.5, rating_lt4: 0.5 }
}
const params: PassParams = {
  cityId: 1, categoryId: 'cafe', country: 'UA', lang: 'ru', sizeKm: 1, densityThreshold: 3,
  nextPageThreshold: 10, randomEvery: 0, budget: 100
}

let seq = 0
// n-е место внутри квадрата (ix,iy), решётка 4x5 с шагом >150 м
function raw(source: 'osm' | 'google', ix: number, iy: number, n: number, over: Partial<RawPlace> = {}): RawPlace {
  seq++
  return {
    source, sourceId: `${source}/${seq}`, name: `Zavedenie${seq}x`,
    lat: BBOX.south + iy * DLAT + 0.0005 + (n % 4) * 0.002,
    lon: BBOX.west + ix * DLON + 0.0005 + Math.floor(n / 4) * 0.0025,
    phones: [], contacts: [], ...over
  }
}
const many = (source: 'osm' | 'google', ix: number, iy: number, k: number, from = 0): RawPlace[] =>
  Array.from({ length: k }, (_, i) => raw(source, ix, iy, from + i))

let dir: string
let db: Db
beforeEach(() => {
  seq = 0
  dir = mkdtempSync(join(tmpdir(), 'll-pass-'))
  db = openDb(join(dir, 't.db'))
  db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'Тест','UA',?,0)").run(JSON.stringify(BBOX))
})
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

function setup(osmPlaces: RawPlace[] | 'down', googleFn: (call: number) => Promise<{ places: RawPlace[]; nextPageToken?: string }> | null) {
  const events: PassEvent[] = []
  const c = { osm: 0, google: 0 }
  const google = googleFn
    ? ({ search: async () => { c.google++; return googleFn(c.google)! } } as unknown as GoogleClient)
    : null
  const deps: PassDeps = {
    db, google, rng: () => 0, now: () => 1_000_000, emit: (e) => events.push(e), categories: [cat], priors,
    osm: async () => {
      c.osm++
      if (osmPlaces === 'down') throw new OverpassUnavailable('down')
      return osmPlaces
    }
  }
  return { deps, events, c }
}
const ctl = (): PassControl => ({ paused: false, stopped: false })
const count = () => (db.prepare('SELECT COUNT(*) n FROM places').get() as { n: number }).n
const warnings = (e: PassEvent[]) => e.flatMap((x) => (x.type === 'warning' ? [x.text] : []))

describe('runPass', () => {
  it('google skipped below density', async () => {
    const s = setup(many('osm', 0, 0, 2), async () => ({ places: [] }))
    const r = await runPass(s.deps, params, ctl())
    expect(s.c.google).toBe(0)
    expect(r.cellsDone).toBe(6)
    expect(r.newCount).toBe(2)
  })

  it('next page only when many new', async () => {
    const pages = [{ places: many('google', 0, 0, 12), nextPageToken: 't1' },
      { places: many('google', 0, 0, 5, 12), nextPageToken: 't2' }, { places: [] }]
    const s = setup(many('osm', 0, 0, 3, 17).map((p) => ({ ...p, lon: p.lon })), async (n) => pages[n - 1])
    const r = await runPass(s.deps, params, ctl())
    expect(s.c.google).toBe(2)
    expect(r.googleUsed).toBe(2)
  })

  it('budget is exact', async () => {
    const osm = [0, 1, 2].flatMap((ix) => [0, 1].flatMap((iy) => (ix === 2 && iy === 1 ? [] : many('osm', ix, iy, 3))))
    const s = setup(osm, async () => ({ places: [] }))
    const r = await runPass(s.deps, { ...params, budget: 3 }, ctl())
    expect(s.c.google).toBe(3)
    expect(r.googleUsed).toBe(3)
    expect(r.cellsDone).toBe(6)
  })

  it('auth error mid-pass keeps results', async () => {
    const osm = [...many('osm', 0, 0, 3), ...many('osm', 1, 0, 3), ...many('osm', 2, 0, 3)]
    const s = setup(osm, async (n) => {
      if (n === 2) throw new GoogleAuthError('bad')
      return { places: many('google', 0, 1, 2) }
    })
    const r = await runPass(s.deps, params, ctl())
    expect(s.c.google).toBe(2)
    expect(count()).toBe(9 + 2)
    expect(warnings(s.events).some((t) => t.includes('ключ'))).toBe(true)
    expect(r.stopped).toBe(false)
    expect(r.cellsDone).toBe(6)
  })

  it('overpass down falls back', async () => {
    const s = setup('down', async () => ({ places: [] }))
    const r = await runPass(s.deps, { ...params, randomEvery: 2 }, ctl())
    expect(warnings(s.events)).toContain('OpenStreetMap не отвечает, ищем только в Google')
    expect(s.c.google).toBe(3)
    expect(r.stopped).toBe(false)
    expect(r.cellsDone).toBe(6)
  })

  it('second run is all duplicates', async () => {
    const osm = many('osm', 0, 0, 5)
    const gp = many('google', 0, 0, 2, 5)
    const s = setup(osm, async () => ({ places: gp }))
    const r1 = await runPass(s.deps, params, ctl())
    expect(r1.newCount).toBe(7)
    const r2 = await runPass(s.deps, params, ctl())
    expect(r2.newCount).toBe(0)
    expect(r2.dupCount).toBe(7)
    expect(s.c.osm).toBe(1) // второй раз из кэша
    expect(count()).toBe(7)
  })

  it('stop flag ends early', async () => {
    const s = setup(many('osm', 0, 0, 5), async () => ({ places: [] }))
    const c = ctl()
    s.deps.emit = (e) => { s.events.push(e); if (e.type === 'cell') c.stopped = true }
    const r = await runPass(s.deps, params, c)
    expect(r.stopped).toBe(true)
    expect(r.cellsDone).toBe(1)
    const row = db.prepare('SELECT finished_at f FROM passes').get() as { f: number | null }
    expect(row.f).not.toBeNull()
  })

  it('unexpected source error still writes finished_at', async () => {
    const s = setup(many('osm', 0, 0, 3), async () => { throw new Error('boom') })
    await expect(runPass(s.deps, params, ctl())).rejects.toThrow('boom')
    const row = db.prepare('SELECT finished_at f FROM passes').get() as { f: number | null }
    expect(row.f).not.toBeNull()
  })
})

describe('google_yield', () => {
  const yieldOf = () => (db.prepare('SELECT google_yield g FROM cells WHERE ix=0 AND iy=0').get() as { g: number | null }).g
  it('only duplicates gives yield 0 and no further calls', async () => {
    const osm = many('osm', 0, 0, 3)
    const s = setup(osm, async () => ({ places: osm }))
    await runPass(s.deps, params, ctl())
    expect(yieldOf()).toBe(0)
    db.prepare('UPDATE cells SET osm_count=0').run()
    s.c.google = 0
    // OSM из кэша вернёт 3 места, поэтому osm_count снова 3; убираем кэш-эффект порогом
    await runPass(s.deps, { ...params, densityThreshold: 99 }, ctl())
    expect(s.c.google).toBe(0)
  })

  it('transient error keeps prior yield', async () => {
    const s = setup(many('osm', 0, 0, 3), async () => { throw new GoogleTransientError('x') })
    await runPass(s.deps, params, ctl()) // создаёт cells
    db.prepare('UPDATE cells SET google_yield=7 WHERE ix=0 AND iy=0').run()
    await runPass(s.deps, params, ctl())
    expect(yieldOf()).toBe(7)
  })

  it('score stored as percent with 1 decimal', () => {
    upsertRaw(db, raw('osm', 0, 0, 0), { country: 'UA', cityId: 1, cellId: null, categoryId: 'cafe', now: 5 })
    rescore(db, priors, { categoryId: 'cafe', cityId: 1 }, 10)
    const sc = (db.prepare('SELECT score FROM places').get() as { score: number }).score
    // prior 1/10, веса: web_none 0.5 -> logit(0.1)+0.5
    const p = 1 / (1 + Math.exp(-(Math.log(0.1 / 0.9) + 0.5)))
    expect(sc).toBe(Math.round(p * 1000) / 10)
    expect(sc * 10).not.toBe(Math.round(sc / 5) * 50)
  })
})

describe('upsertRaw / rescore', () => {
  const ctx = { country: 'UA', cityId: 1, cellId: null, categoryId: 'cafe', now: 5 }
  it('merges duplicate, recomputes webClass, keeps category', () => {
    const a = raw('osm', 0, 0, 0, { name: 'Smak', phones: ['+380 44 123 45 67; +380 50 123 45 67'] })
    expect(upsertRaw(db, a, ctx)).toBe('new')
    const b = { ...a, source: 'google' as const, sourceId: 'g1', website: 'https://smak-cafe.ua', rating: 4.5, reviews: 20 }
    expect(upsertRaw(db, b, { ...ctx, categoryId: 'bar' })).toBe('dup')
    const p = db.prepare('SELECT * FROM places').get() as Record<string, unknown>
    expect(p.category).toBe('cafe')
    expect(p.website).toBe('https://smak-cafe.ua')
    expect(p.web_class).not.toBe('none')
    expect(p.google_place_id).toBe('g1')
    expect((db.prepare("SELECT COUNT(*) n FROM contacts WHERE kind='call'").get() as { n: number }).n).toBeGreaterThanOrEqual(1)
  })

  it('rescore counts replied history', () => {
    upsertRaw(db, raw('osm', 0, 0, 0), ctx)
    upsertRaw(db, raw('osm', 0, 0, 1), ctx)
    setStatus(db, 1, 'written', 1)
    setStatus(db, 1, 'replied', 2)
    setStatus(db, 2, 'written', 1)
    rescore(db, priors, { categoryId: 'cafe', cityId: 1 }, 1 + 8 * 86_400_000)
    const rows = db.prepare('SELECT score, score_reason FROM places ORDER BY id').all() as { score: number }[]
    expect(rows[0].score).toBeGreaterThan(0)
    expect(rows[0].score).toBe(rows[1].score)
  })
})

describe('доработки прохода', () => {
  it('удалённое навсегда место не возвращается при повторном проходе', async () => {
    const osm = many('osm', 0, 0, 2)
    const s = setup(osm, async () => ({ places: [] }))
    await runPass(s.deps, params, ctl())
    const id = (db.prepare("SELECT id FROM places WHERE osm_id=?").get(osm[0].sourceId) as { id: number }).id
    deletePlaceForever(db, id)
    const r = await runPass(s.deps, params, ctl()) // OSM из кэша вернёт то же место
    expect(count()).toBe(1)
    expect(r.newCount).toBe(0)
    expect(r.dupCount).toBe(1)
  })

  it('смена размера квадрата перестраивает сетку и переносит места', async () => {
    const s = setup([...many('osm', 0, 0, 2), ...many('osm', 2, 1, 1)], async () => ({ places: [] }))
    await runPass(s.deps, params, ctl())
    const cells1 = (db.prepare('SELECT COUNT(*) n FROM cells').get() as { n: number }).n
    expect(cells1).toBe(6)
    ensureCells(db, 1, 0.5)
    const cells2 = (db.prepare('SELECT COUNT(*) n FROM cells').get() as { n: number }).n
    expect(cells2).toBeGreaterThan(cells1)
    expect(db.prepare('SELECT size_km s FROM cities WHERE id=1').get()).toEqual({ s: 0.5 })
    const orphans = db.prepare('SELECT COUNT(*) n FROM places WHERE cell_id IS NULL OR cell_id NOT IN (SELECT id FROM cells)').get()
    expect(orphans).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) n FROM pass_cells WHERE cell_id NOT IN (SELECT id FROM cells)').get()).toEqual({ n: 0 })
    // место в своей новой клетке
    const p = db.prepare('SELECT p.lat, p.lon, c.bbox FROM places p JOIN cells c ON c.id=p.cell_id').all() as { lat: number; lon: number; bbox: string }[]
    for (const x of p) {
      const b = JSON.parse(x.bbox) as { south: number; north: number; west: number; east: number }
      expect(x.lat >= b.south && x.lat <= b.north && x.lon >= b.west && x.lon <= b.east).toBe(true)
    }
    // тот же размер — сетка не трогается
    const ids = db.prepare('SELECT id FROM cells ORDER BY id').all()
    ensureCells(db, 1, 0.5)
    expect(db.prepare('SELECT id FROM cells ORDER BY id').all()).toEqual(ids)
    // проход на новом размере работает
    const r = await runPass(s.deps, { ...params, sizeKm: 0.5 }, ctl())
    expect(r.cellsDone).toBe(cells2)
  })

  it('B2B не ходит в Google', async () => {
    const b2b: Category = { id: 'b2b', title: 'B2B', osm: [{ office: 'company' }], query: { ru: 'компания', uk: 'компанія' } }
    const s = setup(many('osm', 0, 0, 5), async () => ({ places: [] }))
    s.deps.categories = [cat, b2b]
    const r = await runPass(s.deps, { ...params, categoryId: 'b2b', randomEvery: 1 }, ctl())
    expect(s.c.google).toBe(0)
    expect(r.googleUsed).toBe(0)
    expect(r.newCount).toBe(5)
  })
})
