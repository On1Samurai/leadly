process.env.TZ = 'Europe/Minsk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { insertPlace, setStatus } from '../src/main/db/repo'
import { Scheduler, makeHandlers, type Handlers } from '../src/main/scheduler'
import { todayView } from '../src/main/today'
import type { Place } from '../src/shared/types'

let dir: string, db: Db
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-sch-')); db = openDb(join(dir, 't.db')); db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','RU','{}',0)").run() })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

const at = (h: number, m = 0, d = 15): number => new Date(2026, 10, d, h, m).getTime()
const S = { digestTime: '09:00', latestCatchUp: '12:00' }
const calls: string[] = []
const fake = (over: Partial<Handlers> = {}): Handlers => ({
  reminder: async (p) => { calls.push(`reminder:${p.placeId}`) },
  digest: async () => { calls.push('digest') },
  backup: async () => { calls.push('backup') },
  noreply: async () => { calls.push('noreply') }, ...over
})
beforeEach(() => { calls.length = 0 })
const pending = (kind: string): { run_at: number }[] => db.prepare('SELECT run_at FROM jobs WHERE kind=? AND done=0').all(kind) as never
const mkPlace = (over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
  name: 'Кафе', category: 'cafe', lat: 50, lon: 30, address: null, cityId: 1, cellId: null,
  phoneE164: null, phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null,
  googlePlaceId: null, osmId: null, googleFetchedAt: null, status: 'new', inBase: false,
  remindAt: null, score: 0, scoreReason: '', createdAt: 1, dealAmount: null, ...over })

describe('Scheduler', () => {
  it('due job runs once', async () => {
    let now = at(10)
    const s = new Scheduler(db, fake(), () => now)
    s.add('reminder', at(9), { placeId: 7 })
    expect(await s.tick()).toBe(1)
    expect(await s.tick()).toBe(0)
    expect(calls).toEqual(['reminder:7'])
    now = at(11)
  })
  it('future job waits', async () => {
    const s = new Scheduler(db, fake(), () => at(10))
    s.add('reminder', at(11), { placeId: 1 })
    expect(await s.tick()).toBe(0)
    expect(calls).toEqual([])
  })
  it('failing job retried, then dropped after 30 min', async () => {
    let now = at(10, 5)
    let n = 0
    const s = new Scheduler(db, fake({ backup: async () => { n++; throw new Error('x') } }), () => now, undefined, () => undefined)
    s.add('backup', at(10))
    await s.tick(); now = at(10, 20); await s.tick()
    expect(n).toBe(2)
    expect(pending('backup')).toHaveLength(1)
    now = at(10, 31); await s.tick()
    expect(n).toBe(3)
    expect(pending('backup')).toHaveLength(0)
  })
  it('one tick at a time', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const s = new Scheduler(db, fake({ backup: () => gate }), () => at(10))
    s.add('backup', at(9))
    const first = s.tick()
    expect(await s.tick()).toBe(0)
    release()
    expect(await first).toBe(1)
  })
  it('digest catch-up before noon runs now', async () => {
    const s = new Scheduler(db, fake(), () => at(10, 15), () => S)
    await s.tick()
    expect(calls).toContain('digest')
    await s.tick()
    expect(calls.filter((c) => c === 'digest')).toHaveLength(1)
    expect(pending('digest')[0].run_at).toBe(at(9, 0, 16))
  })
  it('digest after noon is moved to tomorrow 09:00', () => {
    const s = new Scheduler(db, fake(), () => at(12, 30))
    s.ensureDaily(at(12, 30), S)
    expect(pending('digest').map((j) => j.run_at)).toEqual([at(9, 0, 16)])
  })
  it('digest before digestTime waits for it', () => {
    new Scheduler(db, fake(), () => at(8)).ensureDaily(at(8), S)
    expect(pending('digest')[0].run_at).toBe(at(9))
  })
  it('backup: after 04:00 runs now once, before 04:00 waits, noreply hourly', () => {
    const s = new Scheduler(db, fake(), () => at(10, 15))
    s.ensureDaily(at(10, 15), S)
    expect(pending('backup')[0].run_at).toBe(at(10, 15))
    expect(pending('noreply')[0].run_at).toBe(at(11))
    const db2 = openDb(join(dir, 'b.db'))
    new Scheduler(db2, fake(), () => at(3)).ensureDaily(at(3), S)
    expect((db2.prepare("SELECT run_at FROM jobs WHERE kind='backup'").get() as { run_at: number }).run_at).toBe(at(4))
    db2.close()
  })
  it('ensureDaily is idempotent; backup not repeated same day', async () => {
    const s = new Scheduler(db, fake(), () => at(10, 15), () => S)
    s.ensureDaily(at(10, 15), S); s.ensureDaily(at(10, 15), S)
    expect((db.prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n).toBe(3)
    await s.tick(); await s.tick()
    expect(calls.filter((c) => c === 'backup')).toHaveLength(1)
    expect(pending('backup')[0].run_at).toBe(at(4, 0, 16))
  })
})

describe('reminder handler', () => {
  const sent: string[] = []
  const mk = (): Handlers => makeHandlers(db, {
    notify: { digest: async () => { sent.push('digest') }, reminder: async (p) => { sent.push(p.name) } },
    backup: async () => undefined, noreply: async () => undefined
  })
  beforeEach(() => { sent.length = 0 })
  it('notifies for a place in later', async () => {
    const id = mkPlace({ name: 'А', status: 'later' })
    await mk().reminder({ placeId: id }, at(10))
    expect(sent).toEqual(['А'])
  })
  it('skips silently if deleted or status no longer later', async () => {
    const id = mkPlace({ status: 'written' })
    await mk().reminder({ placeId: id }, at(10))
    await mk().reminder({ placeId: 9999 }, at(10))
    expect(sent).toEqual([])
  })
})

describe('todayView', () => {
  it('counts written by local date', () => {
    const now = at(10)
    const a = mkPlace({ name: 'A' }), b = mkPlace({ name: 'B' }), c = mkPlace({ name: 'C' })
    setStatus(db, a, 'written', at(0, 5)); setStatus(db, b, 'written', at(9))
    setStatus(db, c, 'written', at(23, 50, 14)) // вчера по местному времени
    const v = todayView(db, now, 6)
    expect(v.written).toBe(2)
    expect(v.leftToday).toBe(4)
    expect(v.goal).toBe(6)
  })
})

describe('noreplyRescore', () => {
  it('rescores only pairs with written places', async () => {
    const { noreplyRescore } = await import('../src/main/scheduler')
    const { PRIORS } = await import('../src/main/ipc/data')
    const w = mkPlace({ status: 'written', score: 0 }), n = mkPlace({ category: 'bar', status: 'new', score: 0 })
    noreplyRescore(db, PRIORS, at(10))
    const sc = (id: number): number => (db.prepare('SELECT score FROM places WHERE id=?').get(id) as { score: number }).score
    expect(sc(w)).toBeGreaterThan(0)
    expect(sc(n)).toBe(0)
  })
})
