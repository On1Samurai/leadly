import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { deletePlaceForever, insertPlace } from '../src/main/db/repo'
import { probeOnline, softenNoHttps, unreachableResult } from '../src/main/audit/reach'
import { saveAudit } from '../src/main/audit/save'
import { makeAuditWorker } from '../src/main/ipc/audit-worker'
import type { Finding, Place } from '../src/shared/types'

describe('reach: решения без сети', () => {
  it('нет интернета — offline без находок, есть — site_down', () => {
    expect(unreachableResult(false)).toEqual({ findings: [], screenshot: null, contacts: [], error: 'offline' })
    expect(unreachableResult(true)).toEqual({
      findings: [{ code: 'site_down', confirmed: true, evidence: 'сайт не открывается' }], screenshot: null, contacts: []
    })
  })

  it('no_https не подтверждён, если https упал только по таймауту', () => {
    const f: Finding[] = [{ code: 'no_https', confirmed: true, evidence: 'сайт открывается без HTTPS' }, { code: 'cms', confirmed: true, evidence: 'Tilda' }]
    expect(softenNoHttps(f, 'timeout')).toEqual([{ ...f[0], confirmed: false }, f[1]])
    expect(softenNoHttps(f, 'error')).toEqual(f)
    expect(softenNoHttps(f, null)).toEqual(f)
  })

  it('probeOnline: isOnline=false без запроса; 204 — онлайн; ошибка или не 204 — нет', async () => {
    let calls = 0
    const ok = (async () => { calls++; return new Response(null, { status: 204 }) }) as typeof fetch
    expect(await probeOnline(() => false, ok)).toBe(false)
    expect(calls).toBe(0)
    expect(await probeOnline(() => true, ok)).toBe(true)
    expect(await probeOnline(() => true, (async () => { throw new Error('ENOTFOUND') }) as typeof fetch)).toBe(false)
    expect(await probeOnline(() => true, (async () => new Response('portal', { status: 200 })) as typeof fetch)).toBe(false)
  })
})

describe('аудит: сохранение', () => {
  let dir: string, db: Db
  const mk = (over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
    name: 'P', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null, phoneE164: null,
    phoneType: 'unknown', website: 'https://p.example', webClass: 'own', rating: null, reviews: null, googlePlaceId: null, osmId: null,
    googleFetchedAt: null, status: 'new', inBase: false, remindAt: null, score: 0, scoreReason: '', createdAt: 0, dealAmount: null, ...over
  })
  const audits = (): number => (db.prepare('SELECT COUNT(*) n FROM audits').get() as { n: number }).n
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-save-')); db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','BY','{}',0)").run()
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  it('offline: строка audits не пишется, место остаётся в очереди на аудит', async () => {
    const id = mk()
    const w = makeAuditWorker(db, dir, async () => unreachableResult(false))
    await w(id)
    expect(audits()).toBe(0)
  })

  it('место удалено, пока шёл аудит: ни PNG, ни строки', () => {
    const id = mk()
    deletePlaceForever(db, id)
    saveAudit(db, dir, id, 'https://p.example', 1, { findings: [], screenshot: Buffer.from('png'), contacts: [] })
    expect(existsSync(join(dir, 'screenshots', `${id}.png`))).toBe(false)
    expect(audits()).toBe(0)
  })

  it('INSERT упал — PNG удалён', () => {
    const id = mk()
    db.exec("CREATE TEMP TRIGGER no_audits BEFORE INSERT ON audits BEGIN SELECT RAISE(ABORT, 'boom'); END")
    expect(() => saveAudit(db, dir, id, 'https://p.example', 1, { findings: [], screenshot: Buffer.from('png'), contacts: [] })).toThrow('boom')
    expect(existsSync(join(dir, 'screenshots', `${id}.png`))).toBe(false)
  })

  it('обычный случай: PNG и строка есть', () => {
    const id = mk()
    saveAudit(db, dir, id, 'https://p.example', 1, { findings: [], screenshot: Buffer.from('png'), contacts: [] })
    expect(existsSync(join(dir, 'screenshots', `${id}.png`))).toBe(true)
    expect(audits()).toBe(1)
  })
})
