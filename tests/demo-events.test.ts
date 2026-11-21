process.env.TZ = 'Europe/Minsk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { getSetting } from '../src/main/db/repo'
import { syncDemoEvents } from '../src/main/demo/events'
import { todayView } from '../src/main/today'
import type { WorkerEvent } from '../src/main/demo/worker-api'

let dir: string, db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'll-ev-')); db = openDb(join(dir, 't.db'))
  db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','RU','{}',0)").run()
})
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

const mkDemo = (slug: string, status = 'written', name = 'Кафе'): number => {
  const pid = Number(db.prepare(
    "INSERT INTO places(name,category,lat,lon,city_id,status,created_at) VALUES (?,?,?,?,1,?,0)"
  ).run(name, 'cafe', 50, 30, status).lastInsertRowid)
  db.prepare("INSERT INTO demos(place_id,slug,kind,source,content,created_at,updated_at) VALUES (?,?,?,?,?,0,0)")
    .run(pid, slug, 'site', 'x', '{}')
  return pid
}
const ev = (id: number, slug: string, kind: WorkerEvent['kind'] = 'open', ts = id): WorkerEvent => ({ id, slug, kind, ts })
const api = (...pages: WorkerEvent[][]) => {
  const since: number[] = []
  return { since, events: async (s: number) => { since.push(s); return pages.shift() ?? [] } }
}
const run = (a: ReturnType<typeof api>, now = 1000) => {
  const sent: string[] = []
  return { sent, p: syncDemoEvents(db, a, now, async (e) => { sent.push(`${e.placeName}:${e.kind}`) }) }
}
const count = (): number => (db.prepare('SELECT COUNT(*) AS n FROM demo_events').get() as { n: number }).n

describe('syncDemoEvents', () => {
  it('inserts and moves cursor', async () => {
    mkDemo('a')
    const r = run(api([ev(5, 'a'), ev(7, 'a', 'qr')]))
    expect(await r.p).toBe(2)
    expect(count()).toBe(2)
    expect(getSetting(db, 'demo:cursor', 0)).toBe(7)
  })
  it('dedupes', async () => {
    mkDemo('a')
    await run(api([ev(5, 'a')])).p
    const r = run(api([ev(5, 'a')]))
    expect(await r.p).toBe(0)
    expect(r.sent).toEqual([])
    expect(count()).toBe(1)
  })
  it('status: written -> demo_opened, deal untouched', async () => {
    const a = mkDemo('a', 'written'), b = mkDemo('b', 'deal')
    await run(api([ev(1, 'a'), ev(2, 'b')])).p
    const st = (id: number): string => (db.prepare('SELECT status FROM places WHERE id=?').get(id) as { status: string }).status
    expect(st(a)).toBe('demo_opened')
    expect(st(b)).toBe('deal')
    const log = db.prepare('SELECT from_status AS f, to_status AS t FROM status_log WHERE place_id=?').all(a)
    expect(log).toEqual([{ f: 'written', t: 'demo_opened' }])
    expect(db.prepare('SELECT 1 FROM status_log WHERE place_id=?').get(b)).toBeUndefined()
  })
  it('want also moves status', async () => {
    const a = mkDemo('a', 'new')
    await run(api([ev(1, 'a', 'want')])).p
    expect((db.prepare('SELECT status FROM places WHERE id=?').get(a) as { status: string }).status).toBe('demo_opened')
  })
  it('qr scan alone does not move status (spec §11: only open and want)', async () => {
    const a = mkDemo('a', 'written')
    await run(api([ev(1, 'a', 'qr')])).p
    expect((db.prepare('SELECT status FROM places WHERE id=?').get(a) as { status: string }).status).toBe('written')
  })
  it('open throttle: 1 per hour per slug', async () => {
    mkDemo('a')
    const t0 = 1_000_000
    const r1 = run(api([ev(1, 'a'), ev(2, 'a'), ev(3, 'a')]), t0)
    await r1.p
    expect(r1.sent).toEqual(['Кафе:open'])
    const r2 = run(api([ev(4, 'a')]), t0 + 10 * 60_000)
    await r2.p
    expect(r2.sent).toEqual([])
    const r3 = run(api([ev(5, 'a')]), t0 + 61 * 60_000)
    await r3.p
    expect(r3.sent).toEqual(['Кафе:open'])
  })
  it('open throttle: failed notify does not consume the slot', async () => {
    mkDemo('a')
    const t0 = 1_000_000
    let fail = true
    const sent: string[] = []
    const notify = async (e: { placeName: string; kind: string }) => { if (fail) throw new Error('tg down'); sent.push(`${e.placeName}:${e.kind}`) }
    await syncDemoEvents(db, api([ev(1, 'a')]), t0, notify)
    expect(getSetting<Record<string, number>>(db, 'demo:lastOpenNotify', {}).a).toBeUndefined()
    fail = false
    await syncDemoEvents(db, api([ev(2, 'a')]), t0 + 60_000, notify)
    expect(sent).toEqual(['Кафе:open'])
  })
  it('throttle state pruned after 24h', async () => {
    mkDemo('a'); mkDemo('b')
    const t0 = 1_000_000
    await run(api([ev(1, 'a')]), t0).p
    await run(api([ev(2, 'b')]), t0 + 25 * 3600_000).p
    expect(Object.keys(getSetting(db, 'demo:lastOpenNotify', {}))).toEqual(['b'])
  })
  it('want and qr always notify', async () => {
    mkDemo('a')
    const r = run(api([ev(1, 'a', 'want'), ev(2, 'a', 'want'), ev(3, 'a', 'qr')]))
    await r.p
    expect(r.sent).toEqual(['Кафе:want', 'Кафе:want', 'Кафе:qr'])
  })
  it('unknown slug skipped', async () => {
    const r = run(api([ev(1, 'zzz')]))
    expect(await r.p).toBe(0)
    expect(count()).toBe(0)
    expect(r.sent).toEqual([])
    expect(getSetting(db, 'demo:cursor', 0)).toBe(1)
  })
  it('paged: 500 + 3 -> two calls', async () => {
    mkDemo('a')
    const p1 = Array.from({ length: 500 }, (_, i) => ev(i + 1, 'a'))
    const p2 = [ev(501, 'a'), ev(502, 'a'), ev(503, 'a')]
    const a = api(p1, p2)
    expect(await run(a).p).toBe(503)
    expect(a.since).toEqual([0, 500])
    expect(getSetting(db, 'demo:cursor', 0)).toBe(503)
  })
  it('network error keeps committed pages', async () => {
    mkDemo('a')
    let n = 0
    const a = { events: async () => { if (n++ === 0) return Array.from({ length: 500 }, (_, i) => ev(i + 1, 'a')); throw new Error('worker_offline') } }
    await expect(syncDemoEvents(db, a, 1, async () => undefined)).rejects.toThrow('worker_offline')
    expect(count()).toBe(500)
    expect(getSetting(db, 'demo:cursor', 0)).toBe(500)
  })
  it('todayView.wanted: want within 7 days, not deal', async () => {
    const a = mkDemo('a'); mkDemo('b', 'deal'); mkDemo('c')
    await run(api([ev(1, 'a', 'want', 1000), ev(2, 'b', 'want', 1000), ev(3, 'c', 'open', 1000)])).p
    expect(todayView(db, 2000, 6).wanted.map((p) => p.id)).toEqual([a])
    expect(todayView(db, 8 * 86_400_000, 6).wanted).toEqual([])
  })
  it('todayView.wanted: пропадает после исходящего сообщения', async () => {
    const a = mkDemo('a')
    await run(api([ev(1, 'a', 'want', 1000)])).p
    expect(todayView(db, 2000, 6).wanted.map((p) => p.id)).toEqual([a])
    db.prepare("INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,'out',NULL,'x',1500)").run(a)
    expect(todayView(db, 2000, 6).wanted).toEqual([])
  })
})
