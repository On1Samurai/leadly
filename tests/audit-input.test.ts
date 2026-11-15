import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { buildInput } from '../src/main/audit/build-input'
import { saveAudit } from '../src/main/audit/save'

describe('buildInput', () => {
  const page = { viewport: true, scrollWidth: 400, innerWidth: 390, smallTextShare: 0.1, loadMs: 1200, html: '<p>x</p>', text: 'x', hrefs: ['/a'] }
  it('passes metrics for html', () => {
    const i = buildInput({ finalUrl: 'https://a.ru/', contentType: 'text/html; charset=utf-8', headers: {}, cert: null, page, brokenLinks: [], checkMenu: true })
    expect(i.httpsOk).toBe(true)
    expect(i.metrics).toEqual({ viewport: true, scrollWidth: 400, innerWidth: 390, smallTextShare: 0.1, loadMs: 1200 })
  })
  it('null metrics for non-html and http url', () => {
    const i = buildInput({ finalUrl: 'http://a.ru/f.pdf', contentType: 'application/pdf', headers: {}, cert: null, page, brokenLinks: [], checkMenu: false })
    expect(i.metrics).toBeNull()
    expect(i.httpsOk).toBe(false)
    expect(i.html).toBe('')
  })
})

describe('saveAudit', () => {
  let dir: string, db: Db
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-s-'))
    db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','UA','{}',0)").run()
    db.prepare("INSERT INTO places(id,name,category,lat,lon,city_id,website,web_class,created_at) VALUES (7,'a','c',0,0,1,'http://a.ru','own',0)").run()
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  it('stores row, png and contacts', () => {
    saveAudit(db, dir, 7, 'http://a.ru', 123, {
      findings: [{ code: 'cms', confirmed: true, evidence: 'Tilda' }], screenshot: Buffer.from([1, 2, 3]),
      contacts: [{ kind: 'telegram', value: 'abc' }]
    })
    const r = db.prepare('SELECT * FROM audits WHERE place_id=7').get() as { url: string; ran_at: number; findings: string; screenshot: string; error: string | null }
    expect(r.ran_at).toBe(123)
    expect(JSON.parse(r.findings)[0].code).toBe('cms')
    expect(r.screenshot).toBe(join(dir, 'screenshots', '7.png'))
    expect([...readFileSync(r.screenshot)]).toEqual([1, 2, 3])
    expect((db.prepare('SELECT count(*) c FROM contacts WHERE place_id=7').get() as { c: number }).c).toBe(1)
  })
  it('no screenshot -> null path', () => {
    saveAudit(db, dir, 7, 'http://a.ru', 1, { findings: [], screenshot: null, contacts: [], error: 'x' })
    const r = db.prepare('SELECT screenshot, error FROM audits').get() as { screenshot: string | null; error: string }
    expect(r.screenshot).toBeNull(); expect(r.error).toBe('x')
  })
})
