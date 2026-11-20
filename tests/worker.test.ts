import { beforeEach, describe, expect, it } from 'vitest'
import worker, { SCHEMA_SQL, WORKER_VERSION } from '../src/worker/worker.js'
import { fakeD1, type D1Like } from './helpers/d1'

let DB: D1Like
let env: { DB: D1Like; SECRET: string }
const get = (path: string, init?: RequestInit) => worker.fetch(new Request('https://w.test' + path, init), env)
const auth = { Authorization: 'Bearer s' }
const put = (slug: string, body: unknown, headers: Record<string, string> = auth) =>
  get('/api/targets/' + slug, { method: 'PUT', headers, body: JSON.stringify(body) })
const events = async () => (await DB.prepare('SELECT * FROM events ORDER BY id').all()).results as any[]

beforeEach(async () => {
  DB = fakeD1()
  await DB.exec(SCHEMA_SQL)
  env = { DB, SECRET: 's' }
})

describe('worker', () => {
  it('qr redirects and counts', async () => {
    await put('s-1', { url: 'https://u.github.io/r/s-1/', tg: 'nick' })
    const r = await get('/s-1/')
    expect(r.status).toBe(302)
    expect(r.headers.get('Location')).toBe('https://u.github.io/r/s-1/')
    const ev = await events()
    expect(ev.map((e) => e.kind)).toEqual(['qr'])
  })
  it('unknown slug 410', async () => {
    const r = await get('/s-1')
    expect(r.status).toBe(410)
    expect(await r.text()).toContain('Демо снято с публикации')
    expect(r.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await events()).toEqual([])
  })
  it('bad slug 404', async () => {
    for (const p of ['/A_B', '/x', '/o/', '/s-1/extra']) {
      const r = await get(p)
      expect(r.status).toBe(404)
    }
    expect(await (await get('/A_B')).text()).toContain('Не найдено')
    expect((await get('/s-1', { method: 'POST' })).status).toBe(404)
  })
  it('pixel', async () => {
    await put('s-1', { url: 'https://x.y/', tg: 'nick' })
    let r = await get('/o/s-1')
    expect(r.headers.get('Content-Type')).toBe('image/gif')
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect((await r.arrayBuffer()).byteLength).toBe(43)
    expect((await events()).map((e) => e.kind)).toEqual(['open'])
    await get('/o/s-1', { headers: { Referer: 'https://u.github.io/r/s-1/?me=1' } })
    await get('/o/s-1', { headers: { Referer: 'garbage' } })
    expect((await events()).length).toBe(2)
    r = await get('/o/nope-1')
    expect(r.headers.get('Content-Type')).toBe('image/gif')
    expect((await events()).length).toBe(2)
  })
  it('want', async () => {
    await put('s-1', { url: 'https://x.y/', tg: 'nick' })
    const r = await get('/w/s-1')
    expect(r.status).toBe(302)
    expect(r.headers.get('Location')).toBe('https://t.me/nick')
    expect((await events()).map((e) => e.kind)).toEqual(['want'])
    await put('s-2', { url: 'https://x.y/', tg: '' })
    expect((await get('/w/s-2')).status).toBe(410)
    expect((await get('/w/zzz-9')).status).toBe(410)
    expect((await events()).length).toBe(1)
  })
  it('api needs secret', async () => {
    expect((await get('/api/events?since=0')).status).toBe(401)
    expect((await get('/api/events?since=0', { headers: { Authorization: 'Bearer x' } })).status).toBe(401)
    expect((await put('s-1', { url: 'https://x.y/', tg: 'n' }, {})).status).toBe(401)
    expect((await get('/api/targets/s-1', { method: 'DELETE' })).status).toBe(401)
  })
  it('targets validation, upsert, delete', async () => {
    expect((await put('s-1', { url: 'http://x.y/', tg: 'n' })).status).toBe(400)
    expect((await put('s-1', { url: 'https://x.y/', tg: 'bad nick' })).status).toBe(400)
    expect((await put('s-1', 'oops')).status).toBe(400)
    expect((await put('S_1', { url: 'https://x.y/', tg: 'n' })).status).toBe(404)
    expect((await put('s-1', { url: 'https://a/', tg: 'n' })).status).toBe(204)
    expect((await put('s-1', { url: 'https://b/', tg: 'n' })).status).toBe(204)
    expect((await get('/s-1')).headers.get('Location')).toBe('https://b/')
    const del = () => get('/api/targets/s-1', { method: 'DELETE', headers: auth })
    expect((await del()).status).toBe(204)
    expect((await del()).status).toBe(204)
    expect((await get('/s-1')).status).toBe(410)
  })
  it('events since', async () => {
    for (const k of ['qr', 'open', 'want'])
      await DB.prepare('INSERT INTO events (slug, kind, ts) VALUES (?, ?, ?)').bind('s-1', k, Date.now()).run()
    const r = await get('/api/events?since=1', { headers: auth })
    const j = (await r.json()) as { events: { id: number; slug: string; kind: string; ts: number }[] }
    expect(j.events.map((e) => e.id)).toEqual([2, 3])
    expect(Object.keys(j.events[0]).sort()).toEqual(['id', 'kind', 'slug', 'ts'])
    for (const bad of ['', '?since=-1', '?since=x', '?since=1.5'])
      expect((await get('/api/events' + bad, { headers: auth })).status).toBe(400)
  })
  it('events limit 500', async () => {
    await DB.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<600)
      INSERT INTO events (slug, kind, ts) SELECT 's-1','qr',${Date.now()} FROM n`)
    const j = (await (await get('/api/events?since=0', { headers: auth })).json()) as { events: unknown[] }
    expect(j.events.length).toBe(500)
  })
  it('cleanup', async () => {
    const old = Date.now() - 91 * 86_400_000
    await DB.prepare('INSERT INTO events (slug, kind, ts) VALUES (?, ?, ?)').bind('s-1', 'qr', old).run()
    await DB.prepare('INSERT INTO events (slug, kind, ts) VALUES (?, ?, ?)').bind('s-1', 'qr', Date.now()).run()
    await get('/api/events?since=0', { headers: auth })
    expect((await events()).length).toBe(1)
  })
  it('stores no ip', async () => {
    await put('s-1', { url: 'https://x.y/', tg: 'n' })
    await get('/s-1', { headers: { 'CF-Connecting-IP': '1.2.3.4', 'User-Agent': 'x' } })
    const cols = (await DB.prepare('PRAGMA table_info(events)').all()).results.map((c: any) => c.name)
    expect(cols).toEqual(['id', 'slug', 'kind', 'ts'])
  })
  it('qr, want and pixel still answer when event insert fails', async () => {
    await put('s-1', { url: 'https://x.y/', tg: 'nick' })
    const real = DB
    env.DB = {
      exec: real.exec,
      prepare: (sql: string) => {
        if (!sql.startsWith('INSERT INTO events')) return real.prepare(sql)
        const s: any = { bind: () => s, run: async () => { throw new Error('D1 quota') } }
        return s
      }
    } as D1Like
    let r = await get('/s-1')
    expect(r.status).toBe(302)
    expect(r.headers.get('Location')).toBe('https://x.y/')
    r = await get('/w/s-1')
    expect(r.status).toBe(302)
    r = await get('/o/s-1')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('image/gif')
    // with ctx: the write goes to waitUntil, failure swallowed
    const waits: Promise<unknown>[] = []
    r = await worker.fetch(new Request('https://w.test/s-1'), env, { waitUntil: (p: Promise<unknown>) => waits.push(p) })
    expect(r.status).toBe(302)
    expect(waits.length).toBe(1)
    await expect(waits[0]).resolves.toBeUndefined()
  })
  it('version 2', () => {
    expect(WORKER_VERSION).toBe('2')
  })
  it('health', async () => {
    expect(await (await get('/health')).text()).toBe(`ok ${WORKER_VERSION}`)
  })
})
