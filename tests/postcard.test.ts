import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { stage2Deps } from './helpers/deps'
import { licensed } from './helpers/license'
import { openDb, type Db } from '../src/main/db/db'
import { insertPlace, setSetting } from '../src/main/db/repo'
import { AuditQueue } from '../src/main/audit/queue'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { postcardHtml } from '../src/main/demo/postcard'
import type { SecretEnv } from '../src/main/secrets'

const ev = {} as never
const secretEnv: SecretEnv = {
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  isDev: false, env: {}
}
const card = { name: 'Кофе', qrUrl: 'https://w.test/s-1', headline: 'Лучший кофе', cover: null }

describe('postcardHtml', () => {
  afterEach(() => vi.restoreAllMocks())

  it('four per page', async () => {
    const html = await postcardHtml([card, card, card, card])
    expect(html.match(/class="card"/g)).toHaveLength(4)
    expect(html).toContain('@page { size: A4')
    expect(html).toContain('Ваш новый сайт. Наведите камеру.')
  })

  it('qr encodes worker url', async () => {
    const spy = vi.spyOn(QRCode, 'toString')
    const html = await postcardHtml([card])
    expect(html).toContain('<svg')
    expect(spy.mock.calls[0][0]).toBe('https://w.test/s-1')
  })

  it('uk text and cover', async () => {
    const html = await postcardHtml([{ ...card, cover: 'data:image/jpeg;base64,AA==' }], 'uk')
    expect(html).toContain('Ваш новий сайт. Наведіть камеру.')
    expect(html).toContain('data:image/jpeg;base64,AA==')
  })

  it('escapes', async () => {
    const html = await postcardHtml([{ ...card, name: '<b>x</b>' }])
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('demo.postcard', () => {
  let dir: string, db: Db, saved: string | null, printed: string[], resized: number[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-pc-')); db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','BY','{}',0)").run()
    saved = join(dir, 'out.pdf'); printed = []; resized = []
    setSetting(db, 'demo:worker', { accountId: 'a', d1Id: 'd', url: 'https://w.test', version: 'x' })
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  const h = () => buildHandlers({
    db, secretEnv, userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined),
    now: () => new Date(2026, 10, 15, 12).getTime(), rng: Math.random, osm: async () => [],
    saveDialog: async (name) => { printed.push('dlg:' + name); return saved },
    anthropicFactory: () => { throw new Error('unused') }, ...stage2Deps,
    printPdf: async (html) => { printed.push(html); return Buffer.from('PDF') },
    resizeImage: (b, w) => { resized.push(w ?? 0); return Buffer.concat([Buffer.from('R'), b]) },
    openExternal: async () => undefined, writeClipboard: () => undefined, licensePublicKey: licensed(db)
  } satisfies IpcDeps)
  const demo = (name: string, status = 'published', photo = false): number => {
    const pid = insertPlace(db, {
      name, category: 'cafe', lat: 1, lon: 1, address: null, cityId: 1, cellId: null, phoneE164: null, phoneType: 'mobile',
      website: null, webClass: 'none', rating: null, reviews: null, googlePlaceId: null, osmId: null, googleFetchedAt: null,
      status: 'new', inBase: false, remindAt: null, score: 0, scoreReason: '', createdAt: 0, dealAmount: null
    })
    const slug = `s-${pid}`
    const c = { name, headline: 'H' + name, lang: 'ru', photos: photo ? [{ file: 'img/1.jpg', author: null, source: 'user' }] : [] }
    db.prepare("INSERT INTO demos(place_id,slug,kind,source,content,status,created_at,updated_at) VALUES (?,?,'template','free',?,?,0,0)")
      .run(pid, slug, JSON.stringify(c), status)
    if (photo) { mkdirSync(join(dir, 'demos', slug, 'img'), { recursive: true }); writeFileSync(join(dir, 'demos', slug, 'img', '1.jpg'), 'PIC') }
    return pid
  }

  it('more than 4 ids: bad_args', async () => {
    await expect(h()['demo.postcard'](ev, [1, 2, 3, 4, 5])).rejects.toThrow('bad_args')
  })

  it('unpublished: demo_not_published', async () => {
    const a = demo('A'), b = demo('B', 'draft')
    await expect(h()['demo.postcard'](ev, [a, b])).rejects.toThrow('demo_not_published')
    expect(printed).toEqual([])
  })

  it('no worker: demo_not_setup', async () => {
    const a = demo('A')
    db.prepare("DELETE FROM settings WHERE key='demo:worker'").run()
    await expect(h()['demo.postcard'](ev, [a])).rejects.toThrow('demo_not_setup')
  })

  it('one id: four copies, pdf written, cover downscaled to 600', async () => {
    const a = demo('A', 'published', true)
    expect(await h()['demo.postcard'](ev, [a])).toBe(saved)
    expect(printed[0]).toBe('dlg:leadly-postcards-2026-11-15.pdf')
    expect(printed[1].match(/class="card"/g)).toHaveLength(4)
    expect(printed[1].match(/<svg/g)).toHaveLength(4)
    expect(printed[1]).toContain(Buffer.from('RPIC').toString('base64'))
    expect(resized).toEqual([600])
    expect(readFileSync(saved!, 'utf8')).toBe('PDF')
  })

  it('several ids: one each; cancelled dialog: null, no print', async () => {
    const ids = [demo('A'), demo('B'), demo('C')]
    await h()['demo.postcard'](ev, ids)
    expect(printed[1].match(/class="card"/g)).toHaveLength(3)
    printed.length = 0; saved = null
    expect(await h()['demo.postcard'](ev, ids)).toBeNull()
    expect(printed).toEqual(['dlg:leadly-postcards-2026-11-15.pdf'])
  })
})
