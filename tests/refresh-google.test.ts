import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { getPlace, insertPlace } from '../src/main/db/repo'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { AuditQueue } from '../src/main/audit/queue'
import { setSecret, type SecretEnv } from '../src/main/secrets'
import type { Place } from '../src/shared/types'

const ev = {} as never
const secretEnv: SecretEnv = {
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  isDev: false, env: {}
}

describe('places.refreshGoogle', () => {
  let dir: string, db: Db, calls: number, release: () => void, gate: Promise<void>, pushed: number[]
  const now = new Date(2026, 10, 15, 12, 0).getTime()
  let clock = now
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-refresh-')); db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','BY','{}',0)").run()
    setSecret(db, 'google', 'KEY', secretEnv)
    calls = 0; pushed = []; clock = now
    gate = Promise.resolve(); release = () => undefined
    vi.stubGlobal('fetch', async () => {
      calls++
      await gate
      return new Response(JSON.stringify({
        id: 'g1', displayName: { text: 'P' }, location: { latitude: 0, longitude: 0 }, websiteUri: 'https://p-cafe-site.by', rating: 4.2
      }), { status: 200 })
    })
  })
  afterEach(() => { vi.unstubAllGlobals(); db.close(); rmSync(dir, { recursive: true, force: true }) })

  const deps = (): IpcDeps => ({
    db, secretEnv, userDataDir: dir, auditQueue: { push: (id: number) => { pushed.push(id) } } as unknown as AuditQueue,
    now: () => clock, rng: Math.random, osm: async () => [], saveDialog: async () => null,
    anthropicFactory: () => { throw new Error('unused') }, openExternal: async () => undefined, writeClipboard: () => undefined
  })
  const mk = (over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
    name: 'P', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null, phoneE164: null,
    phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null, googlePlaceId: 'g1', osmId: null,
    googleFetchedAt: null, status: 'new', inBase: false, remindAt: null, score: 0, scoreReason: '', createdAt: 0, dealAmount: null, ...over
  })

  it('20 платных запросов в день, потом refresh_limit; на следующий день снова можно', async () => {
    const id = mk(); const h = buildHandlers(deps())
    for (let i = 0; i < 20; i++) await h['places.refreshGoogle'](ev, id)
    await expect(h['places.refreshGoogle'](ev, id)).rejects.toThrow('refresh_limit')
    expect(calls).toBe(20)
    clock = now + 86_400_000
    await h['places.refreshGoogle'](ev, id)
    expect(calls).toBe(21)
  })

  it('второй запрос по тому же месту, пока идёт первый, — refresh_running', async () => {
    gate = new Promise((r) => { release = r })
    const id = mk(); const h = buildHandlers(deps())
    const first = h['places.refreshGoogle'](ev, id)
    await expect(h['places.refreshGoogle'](ev, id)).rejects.toThrow('refresh_running')
    release()
    await first
    expect(calls).toBe(1)
    await h['places.refreshGoogle'](ev, id) // после окончания снова можно
    expect(calls).toBe(2)
  })

  it('появился свой сайт и аудита нет — место уходит в очередь аудита', async () => {
    const id = mk(); const h = buildHandlers(deps())
    await h['places.refreshGoogle'](ev, id)
    expect(getPlace(db, id)!.webClass).toBe('own')
    expect(pushed).toEqual([id])
  })
})
