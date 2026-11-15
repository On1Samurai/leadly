import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditQueue } from '../src/main/audit/queue'
import { openDb, type Db } from '../src/main/db/db'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { licenseState, setLicense, verifyLicense } from '../src/main/license'
import { mkKey, testKeys } from './helpers/license'

const { pub, priv } = testKeys()
const NOW = 1_000_000

describe('verifyLicense', () => {
  it('valid key', () => {
    const r = verifyLicense(mkKey(priv, { exp: NOW + 10 }), NOW, pub)
    expect(r.ok && r.payload.name).toBe('Иван')
  })
  it('no expiry is valid', () => expect(verifyLicense(mkKey(priv), NOW, pub).ok).toBe(true))
  it('tampered payload -> signature', () => {
    const k = mkKey(priv)
    const s = k.split('.')[1]
    const bad = Buffer.from(JSON.stringify({ v: 1, id: 'abcd1234', name: 'Хакер', iat: 0, exp: null })).toString('base64url')
    expect(verifyLicense(`LEADLY-${bad}.${s}`, NOW, pub)).toEqual({ ok: false, reason: 'signature' })
  })
  it('tampered signature -> signature', () => {
    const k = mkKey(priv)
    const bad = k.slice(0, -3) + (k.endsWith('AAA') ? 'BBB' : 'AAA')
    expect(verifyLicense(bad, NOW, pub)).toEqual({ ok: false, reason: 'signature' })
  })
  it('expired', () => expect(verifyLicense(mkKey(priv, { exp: NOW - 1 }), NOW, pub)).toEqual({ ok: false, reason: 'expired' }))
  it('wrong public key', () => expect(verifyLicense(mkKey(priv), NOW, testKeys().pub)).toEqual({ ok: false, reason: 'signature' }))
  it('garbage -> format', () => {
    for (const k of ['', 'abc', 'LEADLY-xx', 'LEADLY-!!.??', 'LEADLY-e30.e30']) expect(verifyLicense(k, NOW, pub)).toEqual({ ok: false, reason: 'format' })
  })
  it('tolerates whitespace and newlines', () => {
    const k = mkKey(priv)
    expect(verifyLicense(`  ${k.slice(0, 30)}\n${k.slice(30, 60)} \r\n${k.slice(60)}\n`, NOW, pub).ok).toBe(true)
  })
})

describe('script round-trip', () => {
  it('scripts/license.mjs makes a verifiable key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-lic-'))
    try {
      const k = testKeys()
      writeFileSync(join(dir, 'p.pem'), k.priv.export({ type: 'pkcs8', format: 'pem' }) as string)
      const run = (extra: string[]): string => {
        const r = spawnSync(process.execPath, ['scripts/license.mjs', '--name', 'Пётр', '--key', join(dir, 'p.pem'), ...extra], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
        expect(r.status).toBe(0)
        return r.stdout.trim()
      }
      const forever = verifyLicense(run([]), Date.now(), k.pub)
      expect(forever.ok && forever.payload).toMatchObject({ name: 'Пётр', exp: null })
      const thirty = verifyLicense(run(['--days', '30']), Date.now(), k.pub)
      expect(thirty.ok && (thirty.payload.exp as number) > Date.now() + 29 * 86_400_000).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('licenseState / gating', () => {
  let dir: string, db: Db
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-lic-')); db = openDb(join(dir, 't.db')) })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  const deps = (): IpcDeps => ({
    db, secretEnv: { safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' }, isDev: true, env: {} },
    userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined), now: () => NOW, rng: Math.random,
    osm: async () => [], saveDialog: async () => null, anthropicFactory: () => { throw new Error('unused') },
    openExternal: async () => undefined, writeClipboard: () => undefined, licensePublicKey: pub
  })
  const ev = {} as never

  it('state: none -> valid after set; bad key not stored', () => {
    expect(licenseState(db, NOW, pub)).toEqual({ valid: false })
    expect(() => setLicense(db, 'LEADLY-xx', NOW, pub)).toThrow('license_invalid:format')
    expect(licenseState(db, NOW, pub).valid).toBe(false)
    setLicense(db, mkKey(priv, { exp: NOW + 5 }), NOW, pub)
    expect(licenseState(db, NOW, pub)).toEqual({ valid: true, name: 'Иван', exp: NOW + 5 })
    expect(licenseState(db, NOW + 6, pub)).toMatchObject({ valid: false, reason: 'expired' })
  })
  it('pass.start / message.generate / refreshGoogle throw license_required without license', async () => {
    const h = buildHandlers(deps())
    await expect(h['pass.start'](ev, { cityId: 1, categoryId: 'cafe' })).rejects.toThrow('license_required')
    await expect(h['message.generate'](ev, 1, 'business')).rejects.toThrow('license_required')
    await expect(h['places.refreshGoogle'](ev, 1)).rejects.toThrow('license_required')
  })
  it('license.set via IPC activates; invalid throws', async () => {
    const h = buildHandlers(deps())
    await expect(h['license.set'](ev, 'nope')).rejects.toThrow('license_invalid:format')
    expect(await h['license.set'](ev, mkKey(priv))).toMatchObject({ valid: true, name: 'Иван' })
    expect(await h['license.get'](ev)).toMatchObject({ valid: true })
    await expect(h['pass.start'](ev, { cityId: 1, categoryId: 'cafe' })).rejects.toThrow('no_city')
  })
})
