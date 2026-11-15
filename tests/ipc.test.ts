import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { getSetting } from '../src/main/db/repo'
import { getSecret, hasSecret, setSecret, type SecretEnv } from '../src/main/secrets'
import { loadSettings } from '../src/main/settings'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { SettingsPatchSchema } from '../src/main/ipc/schemas'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { AuditQueue } from '../src/main/audit/queue'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { inputFor } from '../src/main/ipc/places'
import { ensureCells } from '../src/main/search/pass'
import { searchCity } from '../src/main/sources/nominatim'
import { getPlace, insertPlace } from '../src/main/db/repo'
import type { Place } from '../src/shared/types'

const fakeSafe = (available = true): SecretEnv['safeStorage'] => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
})

describe('ipc', () => {
  let dir: string, db: Db
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-ipc-')); db = openDb(join(dir, 't.db')) })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  let events: unknown[], release: () => void, gate: Promise<never[]>
  beforeEach(() => { events = []; gate = new Promise((r) => { release = () => r([]) }) })
  const mkDeps = (secretEnv: SecretEnv): IpcDeps => ({
    db, secretEnv, userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined),
    now: () => 1000, rng: Math.random, osm: () => gate,
    saveDialog: async () => null, anthropicFactory: () => { throw new Error('unused') }
  })
  const env = (over: Partial<SecretEnv> = {}): SecretEnv =>
    ({ safeStorage: fakeSafe(), isDev: false, env: {}, ...over })

  it('schemas reject bad args', async () => {
    const h = buildHandlers(mkDeps(env()))
    const ev = {} as never
    await expect(h['places.setStatus'](ev, '1', 'new')).rejects.toThrow('bad_args')
    await expect(h['places.setStatus'](ev, 1, 'unknown')).rejects.toThrow('bad_args')
    // valid args pass validation (place does not exist -> a different error)
    await expect(h['places.setStatus'](ev, 1, 'written')).rejects.not.toThrow('bad_args')
  })

  it('secrets never leave main', async () => {
    const h = buildHandlers(mkDeps(env()))
    expect(Object.keys(h).filter((k) => k.startsWith('secrets.')).sort()).toEqual(['secrets.has', 'secrets.set'])
    const ev = {} as never
    await h['secrets.set'](ev, 'google', 'KEY-123')
    const has = (await h['secrets.has'](ev)) as Record<string, unknown>
    expect(has).toEqual({ anthropic: false, google: true, telegram: false })
    expect(JSON.stringify(has)).not.toContain('KEY-123')
    const raw = db.prepare("SELECT value FROM settings WHERE key='secret:google'").get() as { value: string }
    expect(raw.value).not.toContain('KEY-123')
    await expect(h['secrets.set'](ev, 'nope', 'x')).rejects.toThrow('bad_args')
  })

  it('secrets: roundtrip, delete by empty string, refuse without encryption', () => {
    const e = env()
    setSecret(db, 'anthropic', 'sk-1', e)
    expect(getSecret(db, 'anthropic', e)).toBe('sk-1')
    expect(hasSecret(db, 'anthropic', e)).toBe(true)
    setSecret(db, 'anthropic', '', e)
    expect(getSecret(db, 'anthropic', e)).toBeNull()
    expect(hasSecret(db, 'anthropic', e)).toBe(false)
    const bad = env({ safeStorage: fakeSafe(false) })
    expect(() => setSecret(db, 'google', 'k', bad)).toThrow('encryption_unavailable')
    expect(db.prepare("SELECT 1 FROM settings WHERE key='secret:google'").get()).toBeUndefined()
  })

  it('secrets: env fallback only in dev', () => {
    const vars = { ANTHROPIC_API_KEY: 'dev-a', GOOGLE_API_KEY: 'dev-g', TELEGRAM_BOT_TOKEN: 'dev-t' }
    expect(getSecret(db, 'anthropic', env({ isDev: true, env: vars }))).toBe('dev-a')
    expect(getSecret(db, 'google', env({ isDev: true, env: vars }))).toBe('dev-g')
    expect(getSecret(db, 'telegram', env({ isDev: true, env: vars }))).toBe('dev-t')
    expect(getSecret(db, 'anthropic', env({ isDev: false, env: vars }))).toBeNull()
    setSecret(db, 'anthropic', 'stored', env())
    expect(getSecret(db, 'anthropic', env({ isDev: true, env: vars }))).toBe('stored')
  })

  it('settings: merge stored over defaults, validate patches', async () => {
    expect(loadSettings(db)).toEqual(DEFAULT_SETTINGS)
    const h = buildHandlers(mkDeps(env()))
    const ev = {} as never
    await h['settings.set'](ev, { dailyGoal: 9, sizeKm: 2 })
    const s = (await h['settings.get'](ev)) as typeof DEFAULT_SETTINGS
    expect(s).toEqual({ ...DEFAULT_SETTINGS, dailyGoal: 9, sizeKm: 2 })
    expect(getSetting<unknown>(db, 'app', null)).toMatchObject({ dailyGoal: 9 })
    for (const bad of [{ sizeKm: 0 }, { sizeKm: 3 }, { dailyGoal: -1 }, { dailyGoal: 1.5 }, { digestTime: '25:00' },
      { digestTime: '9:00' }, { tone: 'rude' }, { unknown: 1 }, { randomEvery: 0 }]) {
      await expect(h['settings.set'](ev, bad as never)).rejects.toThrow('bad_args')
    }
    expect(SettingsPatchSchema.safeParse({ sizeKm: 0.5, digestTime: '23:59' }).success).toBe(true)
  })

  it('pass.start: second start while running -> pass_running', async () => {
    const h = buildHandlers(mkDeps(env()))
    const ev = { sender: { send: (_c: string, e: unknown) => { events.push(e) } } } as never
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','UA','{\"south\":0,\"west\":0,\"north\":0.01,\"east\":0.01}',0)").run()
    await h['pass.start'](ev, { cityId: 1, categoryId: 'cafe' })
    await expect(h['pass.start'](ev, { cityId: 1, categoryId: 'cafe' })).rejects.toThrow('pass_running')
    await h['pass.pause'](ev)
    expect(await h['pass.status'](ev)).toEqual({
      running: true, cityId: 1, paused: true,
      counters: { cellsDone: 0, cellsTotal: expect.any(Number), newCount: 0, dupCount: 0, googleUsed: 0 }, warnings: []
    })
    await h['pass.resume'](ev)
    release()
    for (let i = 0; i < 100 && !events.some((e) => (e as { type?: string }).type === 'done'); i++) await new Promise((r) => setTimeout(r, 20))
    expect(events.some((e) => (e as { type?: string }).type === 'done')).toBe(true)
    for (let i = 0; i < 50 && (await h['pass.status'](ev) as { running: boolean }).running; i++) await new Promise((r) => setTimeout(r, 20))
    expect(await h['pass.status'](ev)).toMatchObject({ running: false, cityId: null, paused: false })
  })

  it('stubs throw not_implemented', async () => {
    const h = buildHandlers(mkDeps(env()))
    await expect(h['bot.status']({} as never)).rejects.toThrow('not_implemented')
    await expect(h['write.confirm']({} as never, 1, 'call', 'x')).rejects.toThrow('not_implemented')
  })

  it('app.dataDir возвращает строку', async () => {
    const h = buildHandlers(mkDeps(env()))
    expect(await h['app.dataDir']({} as never)).toBe(dir)
  })

  it('settings.set отклоняет 0 для dailyGoal и randomEvery', async () => {
    const h = buildHandlers(mkDeps(env()))
    await expect(h['settings.set']({} as never, { dailyGoal: 0 })).rejects.toThrow('bad_args')
    await expect(h['settings.set']({} as never, { dailyWriteLimit: 0 })).rejects.toThrow('bad_args')
    await expect(h['settings.set']({} as never, { dailyGoal: 5 })).resolves.not.toThrow()
  })

  it('mission.get считает шаг по БД', async () => {
    const h = buildHandlers(mkDeps(env()))
    const ev = {} as never
    expect(await h['mission.get'](ev)).toBe(1)
    db.prepare("INSERT INTO cities(name,country,bbox,polygon,created_at) VALUES ('Т','RU','[0,0,1,1]',NULL,1)").run()
    expect(await h['mission.get'](ev)).toBe(2)
    for (let i = 0; i < 20; i++) insertPlace(db, mkPlace({ name: `P${i}` }))
    expect(await h['mission.get'](ev)).toBe(3)
    db.prepare('UPDATE places SET in_base=1 WHERE id=1').run()
    expect(await h['mission.get'](ev)).toBe(4)
    db.prepare("INSERT INTO status_log(place_id,from_status,to_status,at) VALUES (1,'new','written',5)").run()
    expect(await h['mission.get'](ev)).toBe('done')
  })

  const mkPlace = (over: Partial<Omit<Place, 'id'>> = {}): Omit<Place, 'id'> => ({
    name: 'P', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null, phoneE164: null,
    phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null, googlePlaceId: null,
    osmId: null, googleFetchedAt: null, status: 'new', inBase: false, remindAt: null, score: 0, scoreReason: '',
    createdAt: 0, ...over })
  const bbox0 = '{"south":0,"west":0,"north":0.01,"east":0.01}'
  const addCity = (bbox = bbox0): void => { db.prepare('INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,?,?,?,0)').run('T', 'UA', bbox) }

  it('b2b place without site gets scenario offer, others no_site', () => {
    addCity()
    const s = loadSettings(db)
    const b2b = getPlace(db, insertPlace(db, mkPlace({ category: 'b2b' })))!
    const cafe = getPlace(db, insertPlace(db, mkPlace()))!
    expect(inputFor(db, b2b, s).scenario).toBe('offer')
    expect(inputFor(db, cafe, s).scenario).toBe('no_site')
  })

  it('city.save accepts only ids returned by search', async () => {
    const h = buildHandlers(mkDeps(env()))
    await expect(h['city.save']({} as never, { id: 'nope' })).rejects.toThrow('unknown_city')
    await expect(h['city.save']({} as never, { id: 'x', bbox: {} })).rejects.toThrow('bad_args')
  })

  it('searchCity drops degenerate bboxes', async () => {
    const fetchFn = (async () => new Response(JSON.stringify([
      { name: 'a', boundingbox: ['1', '1', '2', '3'] }, { name: 'b', boundingbox: ['1', '2', '2', '3'], x: 1 }
    ]))) as unknown as typeof fetch
    const r = await searchCity('x', 'RU', fetchFn)
    expect(r.map((x) => x.name)).toEqual(['b'])
  })

  it('ensureCells rejects country-sized city fast, accepts normal city', () => {
    addCity('{"south":40,"west":20,"north":70,"east":180}')
    const t0 = Date.now()
    expect(() => ensureCells(db, 1, 0.5)).toThrow('city_too_large')
    expect(Date.now() - t0).toBeLessThan(200)
    expect(db.prepare('SELECT COUNT(*) n FROM cells').get()).toEqual({ n: 0 })
    db.prepare('UPDATE cities SET bbox=? WHERE id=1').run(bbox0)
    ensureCells(db, 1, 1)
    expect((db.prepare('SELECT COUNT(*) n FROM cells').get() as { n: number }).n).toBeGreaterThan(0)
  })

  it('failed pass still emits warning then done(stopped)', async () => {
    addCity('{"south":40,"west":20,"north":70,"east":180}')
    let ended = 0
    const h = buildHandlers({ ...mkDeps(env()), onPassEnd: () => { ended++ } })
    const ev = { sender: { send: (_c: string, e: unknown) => { events.push(e) } } } as never
    await h['pass.start'](ev, { cityId: 1, categoryId: 'cafe' })
    for (let i = 0; i < 100 && !ended; i++) await new Promise((r) => setTimeout(r, 20))
    const types = events.map((e) => (e as { type: string }).type)
    expect(types).toEqual(['warning', 'done'])
    expect((events[1] as { summary: { stopped: boolean } }).summary.stopped).toBe(true)
  })

  it('places.remove unlinks only files inside userData/screenshots', async () => {
    addCity()
    mkdirSync(join(dir, 'screenshots'))
    const inside = join(dir, 'screenshots', '1.png'), outside = join(dir, 'precious.txt')
    writeFileSync(inside, 'x'); writeFileSync(outside, 'x')
    const id = insertPlace(db, mkPlace())
    const ins = db.prepare('INSERT INTO audits(place_id,url,ran_at,screenshot) VALUES (?,?,?,?)')
    ins.run(id, 'u', 1, inside); ins.run(id, 'u', 2, outside); ins.run(id, 'u', 3, join(dir, 'screenshots', '..', 'precious.txt'))
    const h = buildHandlers(mkDeps(env()))
    await h['places.remove']({} as never, id)
    expect(existsSync(inside)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })
  it('places.counts считает по всем подходящим, не по странице', async () => {
    addCity()
    for (let i = 0; i < 7; i++) insertPlace(db, mkPlace({ webClass: 'none', inBase: i < 5 }))
    for (let i = 0; i < 3; i++) insertPlace(db, mkPlace({ webClass: 'template', inBase: true }))
    insertPlace(db, mkPlace({ webClass: 'social', inBase: true, category: 'bar' }))
    insertPlace(db, mkPlace({ webClass: 'own', inBase: true }))
    const h = buildHandlers(mkDeps(env()))
    const ev = {} as never
    expect(await h['places.counts'](ev, {})).toEqual({ total: 12, none: 7, template: 3, social: 1, own: 1 })
    expect(await h['places.counts'](ev, { inBase: true })).toEqual({ total: 10, none: 5, template: 3, social: 1, own: 1 })
    // фильтр по типу сайта сужает total, но не разбивку
    expect(await h['places.counts'](ev, { inBase: true, webClass: ['none'] })).toEqual({ total: 5, none: 5, template: 3, social: 1, own: 1 })
    expect(await h['places.counts'](ev, { category: 'bar' })).toEqual({ total: 1, none: 0, template: 0, social: 1, own: 0 })
  })

  it('places.list: каналы в PlaceView, фильтры category/webClass/status', async () => {
    addCity()
    const a = insertPlace(db, mkPlace({ phoneE164: '+375291234567', phoneType: 'mobile', category: 'bar', status: 'written' }))
    insertPlace(db, mkPlace({ webClass: 'own' }))
    const h = buildHandlers(mkDeps(env()))
    const ev = {} as never
    const f = { sort: 'score', limit: 60, offset: 0 }
    const r = (await h['places.list'](ev, { ...f, category: 'bar', webClass: ['none'], status: ['written'] })) as { id: number; channels: string[] }[]
    expect(r.map((x) => x.id)).toEqual([a])
    expect(r[0].channels).toContain('call')
  })

  it('places.nextCandidates: просроченные, ответившие, лучшие новые; не больше 50', async () => {
    addCity()
    const old = insertPlace(db, mkPlace({ name: 'old', remindAt: 100, status: 'written' }))
    insertPlace(db, mkPlace({ name: 'future', remindAt: 5000, status: 'written' }))
    const rep = insertPlace(db, mkPlace({ name: 'rep', status: 'replied', inBase: true }))
    const ins = db.prepare('INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,?,NULL,?,?)')
    ins.run(rep, 'in', 'hi', 50); ins.run(rep, 'out', 'yo', 20); ins.run(rep, 'out', 'again', 30)
    for (let i = 0; i < 80; i++) insertPlace(db, mkPlace({ name: `n${i}`, score: i, inBase: true }))
    insertPlace(db, mkPlace({ name: 'notInBase', score: 999, inBase: false }))
    const h = buildHandlers(mkDeps(env()))
    const r = (await h['places.nextCandidates']({} as never)) as { id: number; name: string; score: number; lastIn: number | null; lastOut: number | null; textReady: boolean; remindAt: number | null }[]
    expect(r.length).toBeLessThanOrEqual(50)
    expect(r.find((x) => x.id === old)?.remindAt).toBe(100)
    expect(r.find((x) => x.name === 'future')).toBeUndefined()
    expect(r.find((x) => x.id === rep)).toMatchObject({ lastIn: 50, lastOut: 30 })
    expect(r.find((x) => x.name === 'n79')).toBeDefined()
    expect(r.find((x) => x.name === 'notInBase')).toBeUndefined()
    expect(r.find((x) => x.name === 'n0')).toBeUndefined()
    expect(r.every((x) => x.textReady === false)).toBe(true)
    // cityId: чужой город даёт пусто
    expect(await h['places.nextCandidates']({} as never, 99)).toEqual([])
  })
})
