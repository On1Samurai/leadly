import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { getSetting, insertPlace } from '../src/main/db/repo'
import { fitWeights, modelWeights, rescoreAll, trainModel, type Sample } from '../src/main/core/logreg'
import { logit, type WeightKey } from '../src/main/core/scoring'
import { Scheduler, type Handlers } from '../src/main/scheduler'
import { buildHandlers } from '../src/main/ipc/handlers'
import { AuditQueue } from '../src/main/audit/queue'
import { PRIORS } from '../src/main/ipc/data'
import { stage2Deps } from './helpers/deps'
import { licensed } from './helpers/license'
import type { PlaceDetails } from '../src/shared/ipc'
import type { Place } from '../src/shared/types'

let dir: string, db: Db
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-lr-')); db = openDb(join(dir, 't.db')); db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','RU','{}',0)").run() })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

const W0 = PRIORS.weights
const mk = (status: Place['status'], over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
  name: 'Кафе', category: 'cafe', lat: 50, lon: 30, address: null, cityId: 1, cellId: null,
  phoneE164: null, phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null,
  googlePlaceId: null, osmId: null, googleFetchedAt: null, status, inBase: false,
  remindAt: null, score: 0, scoreReason: '', createdAt: 1, dealAmount: null, ...over })
// replied = положительная метка, refused без ответа = отрицательная
const fill = (pos: number, neg: number): void => {
  for (let i = 0; i < pos; i++) mk('replied', { phoneType: 'mobile' })
  for (let i = 0; i < neg; i++) mk('refused')
}

describe('fitWeights', () => {
  it('fits signal', () => {
    let s = 12345
    const rnd = (): number => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
    const samples: Sample[] = []
    for (let i = 0; i < 400; i++) {
      const mobile = i % 2 === 0
      samples.push({ keys: mobile ? ['phone_mobile'] : [], offset: logit(0.1), y: rnd() < (mobile ? 0.4 : 0.1) ? 1 : 0 })
    }
    const w = fitWeights(samples, W0)
    expect(w.phone_mobile).toBeGreaterThan(1.0)
    for (const k of Object.keys(W0) as WeightKey[]) if (k !== 'phone_mobile') expect(Math.abs(w[k] - W0[k])).toBeLessThan(0.3)
  })
  it('no data keeps prior', () => expect(fitWeights([], W0)).toEqual(W0))
})

describe('trainModel', () => {
  it('threshold', () => {
    fill(5, 24)
    expect(trainModel(db, PRIORS, 1000)).toBeNull()
    fill(0, 1) // 30 меток, 5 положительных
    expect(trainModel(db, PRIORS, 1000)?.n).toBe(30)
    expect(getSetting<unknown>(db, 'model', null)).not.toBeNull()
  })
  it('4 positives -> null and model key removed', () => {
    fill(5, 25); trainModel(db, PRIORS, 1)
    db.prepare("UPDATE places SET status='refused' WHERE id=1").run()
    expect(trainModel(db, PRIORS, 2)).toBeNull()
    expect(getSetting<unknown>(db, 'model', null)).toBeNull()
  })
  it('rescoreAll uses model; places.get reports modelTrainedOn', async () => {
    fill(5, 25)
    const id = mk('new', { phoneType: 'mobile' })
    const h = buildHandlers({
      db, secretEnv: { safeStorage: { isEncryptionAvailable: () => true, encryptString: (x: string) => Buffer.from(x), decryptString: (b: Buffer) => b.toString() }, isDev: false, env: {} },
      userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined), now: () => 1000, rng: Math.random,
      osm: async () => [], saveDialog: async () => null, anthropicFactory: () => { throw new Error('unused') }, ...stage2Deps,
      openExternal: async () => undefined, writeClipboard: () => undefined, licensePublicKey: licensed(db)
    })
    const ev = {} as never
    const get = (i: number): Promise<PlaceDetails> => h['places.get'](ev, i) as Promise<PlaceDetails>
    expect((await get(id)).modelTrainedOn).toBeNull()
    const before = (await get(id)).score.p
    rescoreAll(db, PRIORS, 1000)
    const stored = (db.prepare('SELECT score FROM places WHERE id=?').get(id) as { score: number }).score
    expect(stored).toBeGreaterThan(0)
    const d = await get(id)
    expect(d.modelTrainedOn).toBe(30)
    expect(d.score.p).not.toBeCloseTo(before, 3)
    expect(modelWeights(db, PRIORS).trainedOn).toBe(30)
  })
})

describe('scheduler', () => {
  it('ensureDaily adds hourly rescore', () => {
    const t = new Date(2026, 10, 15, 10, 15).getTime()
    const h = new Proxy({}, { get: () => async () => undefined }) as Handlers
    new Scheduler(db, h, () => t).ensureDaily(t, { digestTime: '09:00', latestCatchUp: '12:00' })
    const r = db.prepare("SELECT run_at FROM jobs WHERE kind='rescore' AND done=0").all() as { run_at: number }[]
    expect(r).toEqual([{ run_at: new Date(2026, 10, 15, 11).getTime() }])
  })
})
