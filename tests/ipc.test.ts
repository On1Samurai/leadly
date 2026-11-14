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
    release()
    for (let i = 0; i < 100 && !events.some((e) => (e as { type?: string }).type === 'done'); i++) await new Promise((r) => setTimeout(r, 20))
    expect(events.some((e) => (e as { type?: string }).type === 'done')).toBe(true)
  })

  it('stubs throw not_implemented', async () => {
    const h = buildHandlers(mkDeps(env()))
    await expect(h['bot.status']({} as never)).rejects.toThrow('not_implemented')
    await expect(h['write.confirm']({} as never, 1, 'call', 'x')).rejects.toThrow('not_implemented')
  })
})
