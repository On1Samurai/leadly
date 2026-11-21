import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stage2Deps } from './helpers/deps'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { addContacts, getPlace, insertPlace } from '../src/main/db/repo'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { AuditQueue } from '../src/main/audit/queue'
import { setSetting } from '../src/main/db/repo'
import { localDate } from '../src/main/core/daily'
import type { Place } from '../src/shared/types'

const ev = {} as never

describe('write.* и воронка', () => {
  let dir: string, db: Db
  let opened: string[], copied: string[], now: number
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-write-')); db = openDb(join(dir, 't.db'))
    db.prepare('INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,?,?,?,0)').run('T', 'BY', '{}')
    opened = []; copied = []; now = new Date(2026, 10, 14, 12, 0).getTime()
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  const deps = (): IpcDeps => ({
    db, secretEnv: { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }, isDev: false, env: {} },
    userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined),
    now: () => now, rng: Math.random, osm: async () => [], saveDialog: async () => null,
    anthropicFactory: () => { throw new Error('unused') }, ...stage2Deps,
    openExternal: async (u) => { opened.push(u) }, writeClipboard: (t) => { copied.push(t) }
  })
  const mk = (over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
    name: 'P', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null, phoneE164: '+375291234567',
    phoneType: 'mobile', website: null, webClass: 'none', rating: null, reviews: null, googlePlaceId: null, osmId: null,
    googleFetchedAt: null, status: 'new', inBase: true, remindAt: null, score: 0, scoreReason: '', createdAt: 0, dealAmount: null, ...over
  })
  const today = (): number => (db.prepare('SELECT links_opened n FROM daily WHERE date=?').get(localDate(now)) as { n: number } | undefined)?.n ?? 0

  it('write.open: копирует, открывает https-ссылку, считает', async () => {
    const id = mk(); const h = buildHandlers(deps())
    const r = await h['write.open'](ev, id, 'whatsapp', 'Привет мир')
    expect(r).toEqual({ url: 'https://wa.me/375291234567?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%D0%BC%D0%B8%D1%80', prefilled: true, left: 29 })
    expect(copied).toEqual(['Привет мир']); expect(opened).toHaveLength(1); expect(today()).toBe(1)
  })

  it('write.open: handle из контактов, tel и viber разрешены', async () => {
    const id = mk(); addContacts(db, id, [{ kind: 'telegram', value: 'cafe_x' }])
    const h = buildHandlers(deps())
    await h['write.open'](ev, id, 'telegram', 'x')
    await h['write.open'](ev, id, 'call', 'x')
    await h['write.open'](ev, id, 'viber', 'x')
    expect(opened).toEqual(['https://t.me/cafe_x', 'tel:+375291234567', 'viber://chat?number=%2B375291234567'])
  })

  it('write.open: нет ссылки (max) — текст скопирован, url null, счёт растёт', async () => {
    const id = mk(); const h = buildHandlers(deps())
    expect(await h['write.open'](ev, id, 'max', 'x')).toEqual({ url: null, prefilled: false, left: 29 })
    expect(copied).toEqual(['x']); expect(opened).toEqual([]); expect(today()).toBe(1)
  })

  it('write.open: лимит — blocked, ничего не копируется и не открывается', async () => {
    setSetting(db, 'app', { dailyWriteLimit: 2 })
    const id = mk(); const h = buildHandlers(deps())
    await h['write.open'](ev, id, 'call', 'x'); await h['write.open'](ev, id, 'call', 'x')
    expect(await h['write.open'](ev, id, 'call', 'x')).toEqual({ blocked: true, limit: 2 })
    expect(copied).toHaveLength(2); expect(opened).toHaveLength(2)
  })

  it('write.open: ссылка с чужой схемой не открывается', async () => {
    const id = mk(); addContacts(db, id, [{ kind: 'instagram', value: 'ok_name' }])
    const h = buildHandlers({ ...deps() })
    // схемы https/tel/sms/viber проходят, остальное режется на уровне openUrl-проверки
    const { safeExternalUrl } = await import('../src/main/ipc/write')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('http://x.y')).toBeNull()
    expect(safeExternalUrl('myapp://x')).toBeNull()
    expect(safeExternalUrl('sms:+1?body=a')).toBe('sms:+1?body=a')
    await h['write.open'](ev, id, 'instagram', 'x')
    expect(opened).toEqual(['https://ig.me/m/ok_name'])
  })

  it('write.open: текст пустой или длиннее 1000 — bad_args', async () => {
    const id = mk(); const h = buildHandlers(deps())
    await expect(h['write.open'](ev, id, 'call', '')).rejects.toThrow('bad_args')
    await expect(h['write.open'](ev, id, 'call', 'x'.repeat(1001))).rejects.toThrow('bad_args')
    expect(copied).toEqual([])
  })

  it('write.confirm: статус written, сообщение out, пересчёт категории', async () => {
    const a = mk({ score: 50 }), b = mk({ score: 50 })
    const h = buildHandlers(deps())
    await h['write.confirm'](ev, a, 'whatsapp', 'Текст')
    expect(getPlace(db, a)!.status).toBe('written')
    expect(db.prepare('SELECT direction, channel, text, created_at c FROM messages WHERE place_id=?').all(a))
      .toEqual([{ direction: 'out', channel: 'whatsapp', text: 'Текст', c: now }])
    expect(db.prepare('SELECT from_status f, to_status t FROM status_log WHERE place_id=?').all(a)).toEqual([{ f: 'new', t: 'written' }])
    // rescore пересчитал соседа: score больше не заглушка 50
    expect(getPlace(db, b)!.score).not.toBe(50)
  })

  it('write.confirm: статус replied не откатывается, сообщение пишется', async () => {
    const a = mk({ status: 'replied' }); const h = buildHandlers(deps())
    await h['write.confirm'](ev, a, 'call', 'ещё')
    expect(getPlace(db, a)!.status).toBe('replied')
    expect((db.prepare('SELECT COUNT(*) n FROM messages WHERE place_id=?').get(a) as { n: number }).n).toBe(1)
    expect(db.prepare('SELECT COUNT(*) n FROM status_log WHERE place_id=?').get(a)).toEqual({ n: 0 })
    const l = mk({ status: 'later' })
    await h['write.confirm'](ev, l, 'call', 'ещё')
    expect(getPlace(db, l)!.status).toBe('written')
  })

  it('places.setStatus: replied и refused пересчитывают категорию', async () => {
    const a = mk({ status: 'written', score: 50 }), b = mk({ score: 50 })
    const h = buildHandlers(deps())
    await h['places.setStatus'](ev, a, 'replied')
    const s1 = getPlace(db, b)!.score
    expect(s1).not.toBe(50)
    const c = mk({ status: 'written' })
    await h['places.setStatus'](ev, c, 'refused') // отказ без ответа — в «не ответили»
    expect(getPlace(db, b)!.score).not.toBe(s1)
  })

  it('places.remind: later, remind_at и задача reminder', async () => {
    const a = mk({ status: 'written' }); const h = buildHandlers(deps())
    const at = now + 86_400_000
    await h['places.remind'](ev, a, at)
    const p = getPlace(db, a)!
    expect(p.status).toBe('later'); expect(p.remindAt).toBe(at)
    expect(db.prepare('SELECT kind, run_at r, payload, done FROM jobs').all())
      .toEqual([{ kind: 'reminder', r: at, payload: JSON.stringify({ placeId: a }), done: 0 }])
    // повторное напоминание заменяет прежнюю незакрытую задачу
    await h['places.remind'](ev, a, at + 1000)
    expect(db.prepare('SELECT run_at r FROM jobs WHERE done=0').all()).toEqual([{ r: at + 1000 }])
  })

  it('places.setDeal: сумма в минимальных единицах', async () => {
    const a = mk(); const h = buildHandlers(deps())
    await h['places.setDeal'](ev, a, 150000)
    expect(getPlace(db, a)!.dealAmount).toBe(150000)
    await h['places.setDeal'](ev, a, null)
    expect(getPlace(db, a)!.dealAmount).toBeNull()
  })
})

describe('write: доп. случаи', () => {
  let dir: string, db: Db
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-write2-')); db = openDb(join(dir, 't.db'))
    db.prepare('INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,?,?,?,0)').run('T', 'BY', '{}')
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  const now = new Date(2026, 10, 14, 12, 0).getTime()
  const deps = (over: Partial<IpcDeps> = {}): IpcDeps => ({
    db, secretEnv: { safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }, isDev: false, env: {} },
    userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined), now: () => now, rng: Math.random,
    osm: async () => [], saveDialog: async () => null, anthropicFactory: () => { throw new Error('unused') }, ...stage2Deps,
    openExternal: async () => undefined, writeClipboard: () => undefined, ...over
  })
  const mk = (over: Partial<Omit<Place, 'id'>> = {}): number => insertPlace(db, {
    name: 'P', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null, phoneE164: '+375291234567',
    phoneType: 'mobile', website: null, webClass: 'none', rating: null, reviews: null, googlePlaceId: null, osmId: null,
    googleFetchedAt: null, status: 'new', inBase: true, remindAt: null, score: 0, scoreReason: '', createdAt: 0, dealAmount: null, ...over
  })

  it('удаление места убирает его задачи', async () => {
    const a = mk(), b = mk(); const h = buildHandlers(deps())
    await h['places.remind'](ev, a, now + 1000); await h['places.remind'](ev, b, now + 1000)
    await h['places.remove'](ev, a)
    expect(db.prepare('SELECT payload FROM jobs').all()).toEqual([{ payload: JSON.stringify({ placeId: b }) }])
  })

  it('blocked несёт limit, write.status отдаёт left/limit', async () => {
    setSetting(db, 'app', { dailyWriteLimit: 1 })
    const a = mk(); const h = buildHandlers(deps())
    expect(await h['write.status'](ev)).toEqual({ left: 1, limit: 1 })
    await h['write.open'](ev, a, 'call', 'x')
    expect(await h['write.status'](ev)).toEqual({ left: 0, limit: 1 })
    expect(await h['write.open'](ev, a, 'call', 'x')).toEqual({ blocked: true, limit: 1 })
  })

  it('openExternal отклонил — url null, текст в буфере, счёт учтён', async () => {
    const copied: string[] = []
    const a = mk(); const h = buildHandlers(deps({ openExternal: async () => { throw new Error('no handler') }, writeClipboard: (t) => { copied.push(t) } }))
    expect(await h['write.open'](ev, a, 'viber', 'x')).toEqual({ url: null, prefilled: false, left: 29 })
    expect(copied).toEqual(['x'])
  })

  it('уход из later снимает remind_at и задачу', async () => {
    const a = mk({ status: 'written' }); const h = buildHandlers(deps())
    await h['places.remind'](ev, a, now + 1000)
    await h['places.setStatus'](ev, a, 'replied')
    expect(getPlace(db, a)!.remindAt).toBeNull()
    expect(db.prepare('SELECT COUNT(*) n FROM jobs WHERE done=0').get()).toEqual({ n: 0 })
  })
  it('write.confirm из later снимает remind_at и задачу', async () => {
    const a = mk({ status: 'written' }); const h = buildHandlers(deps())
    await h['places.remind'](ev, a, now + 1000)
    expect(getPlace(db, a)!.status).toBe('later')
    await h['write.confirm'](ev, a, 'call', 'x')
    expect(getPlace(db, a)!.status).toBe('written')
    expect(getPlace(db, a)!.remindAt).toBeNull()
    expect(db.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='reminder'").get()).toEqual({ n: 0 })
  })
})
