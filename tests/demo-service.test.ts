import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stage2Deps } from './helpers/deps'
import { licensed } from './helpers/license'
import { openDb, type Db } from '../src/main/db/db'
import { deletePlaceForever, getPlace, getSetting, insertPlace, setSetting } from '../src/main/db/repo'
import { buildHandlers, type IpcDeps } from '../src/main/ipc/handlers'
import { AuditQueue } from '../src/main/audit/queue'
import { getWorkerSecret, setSecret, setWorkerSecret, type SecretEnv } from '../src/main/secrets'
import { saveSettings } from '../src/main/settings'
import { formatOsmHours } from '../src/main/core/osm-hours'
import { SLUG_RE } from '../src/main/demo/slug'
import { WORKER_VERSION } from '../src/worker/worker.js'
import type { DemoContent, DemoView, SetupState } from '../src/shared/demo/types'

const ev = {} as never
const secretEnv: SecretEnv = {
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  isDev: false, env: {}
}
const WORKER = 'https://leadly-demos.me.workers.dev'
const reply = (status: number, body: unknown = {}): Response => new Response(JSON.stringify(body), { status })

type Call = { method: string; url: string; body?: any }

/** Маршрутизирует GitHub, Cloudflare, Google и Worker; GitHub хранит дерево main как path -> sha. */
function fakeNet() {
  const calls: Call[] = []
  const tree = new Map<string, string>([['robots.txt', 'r0']])
  const trees: Record<string, Map<string, string>> = { t0: new Map(tree) }
  const commits: Record<string, string> = { c0: 't0' }
  let head = 'c0'
  let n = 0
  const st = { offline: false, ghStatus: 0, health: `ok ${WORKER_VERSION}`, cfSub: 'me' as string | null, mediaFail: false, gate: null as Promise<void> | null }
  const fetch = (async (url: string, o: RequestInit = {}) => {
    const method = o.method ?? 'GET'
    const isForm = o.body instanceof FormData
    const body = o.body && !isForm ? JSON.parse(o.body as string) : undefined
    calls.push({ method, url, body })
    if (st.offline) throw new Error('offline')
    const u = new URL(url)
    if (u.host === 'api.github.com') {
      if (st.ghStatus) return reply(st.ghStatus)
      const p = u.pathname.replace(/^\/repos\/u\/leadly-demos/i, '')
      const key = `${method} ${p}`
      if (key === 'GET /user') return reply(200, { login: 'U' })
      if (key === 'GET ') return reply(200, { permissions: { push: true } })
      if (key === 'GET /pages') return reply(200, { html_url: 'https://u.github.io/leadly-demos/' })
      if (key === 'POST /pages') return reply(201, {})
      if (key === 'GET /git/ref/heads/main') return reply(200, { object: { sha: head } })
      if (p.startsWith('/git/commits/')) return reply(200, { tree: { sha: commits[p.split('/').pop()!] } })
      if (p.startsWith('/git/trees/') && method === 'GET') {
        const t = trees[p.split('/').pop()!]
        return reply(200, { tree: [...t.keys()].map((path) => ({ path, type: 'blob', sha: t.get(path) })) })
      }
      if (key === 'POST /git/blobs') return reply(201, { sha: `b${++n}` })
      if (key === 'POST /git/trees') {
        const t = new Map(trees[body.base_tree])
        for (const e of body.tree) e.sha === null ? t.delete(e.path) : t.set(e.path, e.sha)
        const sha = `t${++n}`
        trees[sha] = t
        return reply(201, { sha })
      }
      if (key === 'POST /git/commits') { const sha = `c${++n}`; commits[sha] = body.tree; return reply(201, { sha }) }
      if (key === 'PATCH /git/refs/heads/main') { head = body.sha; return reply(200, {}) }
      if (key === 'GET /pages/builds/latest') return reply(200, { commit: head, status: 'built' })
      if (method === 'PUT') return reply(201, {})
      return reply(404)
    }
    if (u.host === 'places.googleapis.com') {
      if (st.gate) await st.gate
      if (u.pathname.endsWith('/media')) return st.mediaFail ? reply(500) :  new Response(Buffer.from([0xff, 0xd8, 1]))
      return reply(200, {
        regularOpeningHours: { weekdayDescriptions: ['Пн: 09:00–21:00'] },
        reviews: [{ text: { text: 'Вкусно' }, rating: 5, authorAttribution: { displayName: 'Аня' } }],
        photos: [{ name: 'places/g1/photos/p1' }, { name: 'places/g1/photos/p2' }],
        editorialSummary: { text: 'Кофейня' }, googleMapsUri: 'https://maps.google/x'
      })
    }
    if (u.host === 'api.cloudflare.com') {
      const ok = (result: unknown) => reply(200, { success: true, errors: [], result })
      const p = u.pathname.replace('/client/v4', '').replace('/accounts/acc1', '')
      if (p === '/accounts') return ok([{ id: 'acc1' }])
      if (p === '/workers/subdomain') return ok(st.cfSub ? { subdomain: st.cfSub } : null)
      if (p === '/d1/database' && method === 'GET') return ok([{ name: 'leadly-demos', uuid: 'db1' }])
      return ok({})
    }
    if (url.startsWith(WORKER)) {
      if (u.pathname === '/health') return new Response(st.health)
      return new Response(null, { status: 200 })
    }
    return reply(404)
  }) as unknown as typeof fetch
  const ghPaths = () => [...trees[commits[head]].keys()]
  return { fetch, calls, st, ghPaths }
}

describe('demo service', () => {
  let dir: string, db: Db, net: ReturnType<typeof fakeNet>, opened: string[], pub: string | undefined, dialog: string | null
  let factory: IpcDeps['anthropicFactory']
  const now = new Date(2026, 10, 15, 12, 0).getTime()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-demo-')); db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','BY','{}',0)").run()
    net = fakeNet(); opened = []; dialog = null
    factory = () => { throw new Error('unused') }
    pub = licensed(db)
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  const h = () => buildHandlers({
    db, secretEnv, userDataDir: dir, auditQueue: new AuditQueue(1, async () => undefined),
    now: () => now, rng: Math.random, osm: async () => [], saveDialog: async () => null,
    anthropicFactory: (k) => factory(k), ...stage2Deps,
    fetch: net.fetch, resizeImage: (b) => Buffer.concat([Buffer.from('R'), b]), openDialog: async () => dialog,
    openExternal: async (u) => { opened.push(u) }, writeClipboard: () => undefined,
    licensePublicKey: pub
  } satisfies IpcDeps)
  const mk = (over: Record<string, unknown> = {}): number => insertPlace(db, {
    name: 'Кофе Поинт', category: 'cafe', lat: 53.9, lon: 27.56, address: 'ул. Ленина, 1', cityId: 1, cellId: null,
    phoneE164: '+375291112233', phoneType: 'mobile', website: null, webClass: 'none', rating: 4.5, reviews: 30,
    googlePlaceId: null, osmId: null, googleFetchedAt: null, status: 'new', inBase: false, remindAt: null, score: 0,
    scoreReason: '', createdAt: 0, dealAmount: null, ...over
  })
  const setup = () => {
    saveSettings(db, { demoTg: 'mynick' })
    setSecret(db, 'github', 'GT', secretEnv); setSecret(db, 'cloudflare', 'CT', secretEnv); setWorkerSecret(db, 'WS', secretEnv)
    setSetting(db, 'demo:github', { owner: 'u', repo: 'leadly-demos' })
    setSetting(db, 'demo:worker', { accountId: 'acc1', d1Id: 'db1', url: WORKER, version: WORKER_VERSION })
  }
  const googleCalls = () => net.calls.filter((c) => c.url.includes('googleapis')).length
  const build = async (id: number, o: { source: 'auto' | 'free'; googleId?: string } = { source: 'auto' }) =>
    (await h()['demo.build'](ev, id, o)) as DemoView

  it('build free: hours from osm_hours, slug, fallback mapsUrl', async () => {
    const id = mk()
    db.prepare('UPDATE places SET osm_hours=? WHERE id=?').run('Mo-Fr 09:00-21:00', id)
    const v = await build(id)
    expect(v.source).toBe('free')
    expect(v.kind).toBe('template')
    expect(v.status).toBe('draft')
    expect(v.slug).toMatch(SLUG_RE)
    expect(v.content!.hours).toEqual(formatOsmHours('Mo-Fr 09:00-21:00', 'ru'))
    expect(v.content!.rating).toBe(4.5)
    expect(v.content!.mapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=53.9,27.56')
    expect(v.content!.cta).toEqual({ kind: 'route', target: v.content!.mapsUrl })
    expect(v.content!.showBadge).toBe(true)
  })

  it('build google limit: no Google call', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    saveSettings(db, { demoGoogleDaily: 3 })
    const id = mk({ googlePlaceId: 'g1' })
    await expect(build(id)).rejects.toThrow('demo_google_limit')
    expect(googleCalls()).toBe(0)
  })

  it('build google: photos on disk, place_details, cache on second build', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    const v = await build(id)
    expect(v.source).toBe('google')
    expect(v.content!.photos.map((p) => p.file)).toEqual(['img/1.jpg', 'img/2.jpg'])
    expect(existsSync(join(dir, 'demos', v.slug, 'img', '1.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'demos', v.slug, 'img', '2.jpg'))).toBe(true)
    expect(v.content!.rating).toBe(4.5) // из places, Google rating не прислал
    expect(v.content!.reviews[0].text).toBe('Вкусно')
    expect(db.prepare('SELECT 1 FROM place_details WHERE place_id=?').get(id)).toBeTruthy()
    expect(googleCalls()).toBe(3)
    const budget = (await h()['demo.budget'](ev)) as { left: number; limit: number }
    expect(budget).toMatchObject({ left: 22, limit: 25, need: 4, costUsd: 0.04 })
    const v2 = await build(id)
    expect(googleCalls()).toBe(3)
    expect(v2.slug).toBe(v.slug)
    expect(v2.content!.photos.map((p) => p.file)).toEqual(['img/1.jpg', 'img/2.jpg'])
    expect(v2.content!.mapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=53.9,27.56')
  })

  it('build google without googleId needs one', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk()
    await expect(build(id)).rejects.toThrow('no_google_id')
    expect((await build(id, { source: 'auto', googleId: 'g1' })).source).toBe('google')
  })

  it('rebuild keeps slug and status', async () => {
    const id = mk()
    const a = await build(id)
    db.prepare("UPDATE demos SET status='published' WHERE place_id=?").run(id)
    const b = await build(id, { source: 'free' })
    expect(b.slug).toBe(a.slug)
    expect(b.status).toBe('published')
  })

  it('publish needs setup and tg', async () => {
    const id = mk()
    await build(id)
    saveSettings(db, { demoTg: 'mynick' })
    await expect(h()['demo.publish'](ev, id)).rejects.toThrow('demo_not_setup')
    setup()
    saveSettings(db, { demoTg: '' })
    await expect(h()['demo.publish'](ev, id)).rejects.toThrow('demo_no_tg')
  })

  it('publish: published, url, worker target', async () => {
    setup()
    const id = mk()
    const { slug } = await build(id)
    const v = (await h()['demo.publish'](ev, id)) as DemoView
    expect(v.status).toBe('published')
    expect(v.url).toBe(`https://u.github.io/leadly-demos/${slug}/`)
    expect(v.publishedAt).toBe(now)
    expect(net.ghPaths()).toContain(`${slug}/index.html`)
    const put = net.calls.find((c) => c.method === 'PUT' && c.url === `${WORKER}/api/targets/${slug}`)
    expect(put?.body).toEqual({ url: v.url, tg: 'mynick' })
    const commit = net.calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')
    expect(commit?.body.message).toBe(`demo: ${slug}`)
  })

  it('publish error: GitHub 403 -> status error gh_no_access', async () => {
    setup()
    const id = mk()
    await build(id)
    net.st.ghStatus = 403
    const v = (await h()['demo.publish'](ev, id)) as DemoView
    expect(v.status).toBe('error')
    expect(v.error).toBe('gh_no_access')
  })

  it('unpublish: folder removed, target deleted, status unpublished', async () => {
    setup()
    const id = mk()
    const { slug } = await build(id)
    const hh = h()
    await hh['demo.publish'](ev, id)
    const v = (await hh['demo.unpublish'](ev, id)) as DemoView
    expect(v.status).toBe('unpublished')
    expect(net.ghPaths().some((p) => p.startsWith(`${slug}/`))).toBe(false)
    expect(net.calls.some((c) => c.method === 'DELETE' && c.url === `${WORKER}/api/targets/${slug}`)).toBe(true)
  })

  it('remove offline: place and demo stay', async () => {
    setup()
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    const { slug } = await build(id)
    await h()['demo.publish'](ev, id)
    net.st.offline = true
    await expect(h()['places.remove'](ev, id)).rejects.toThrow('demo_offline')
    expect(getPlace(db, id)).not.toBeNull()
    expect(db.prepare('SELECT 1 FROM demos WHERE place_id=?').get(id)).toBeTruthy()
    expect(existsSync(join(dir, 'demos', slug))).toBe(true)
  })

  it('remove ok: place, folder, rows gone; site unpublished', async () => {
    setup()
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    const { slug } = await build(id)
    await h()['demo.publish'](ev, id)
    await h()['places.remove'](ev, id)
    expect(getPlace(db, id)).toBeNull()
    expect(existsSync(join(dir, 'demos', slug))).toBe(false)
    expect(db.prepare('SELECT 1 FROM demos WHERE place_id=?').get(id)).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM place_details WHERE place_id=?').get(id)).toBeUndefined()
    expect(net.ghPaths().some((p) => p.startsWith(`${slug}/`))).toBe(false)
    expect(net.calls.some((c) => c.method === 'DELETE' && c.url === `${WORKER}/api/targets/${slug}`)).toBe(true)
  })

  it('remove draft without setup: no network, files gone', async () => {
    const id = mk()
    const { slug } = await build(id)
    await h()['places.remove'](ev, id)
    expect(getPlace(db, id)).toBeNull()
    expect(existsSync(join(dir, 'demos', slug))).toBe(false)
  })

  it('preview inlines photos', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    const v = await build(id)
    const html = (await h()['demo.preview'](ev, id, v.content)) as string
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('img/1.jpg')
  })

  it('save validates content paths', async () => {
    const id = mk()
    const v = await build(id)
    const bad: DemoContent = { ...v.content!, photos: [{ file: '../../t.db', author: null, source: 'user' }] }
    await expect(h()['demo.save'](ev, id, bad)).rejects.toThrow('bad_args')
    await h()['demo.save'](ev, id, { ...v.content!, headline: 'Новый' })
    expect(((await h()['demo.get'](ev, id)) as DemoView).content!.headline).toBe('Новый')
  })

  it('photoAdd: next free number, resized', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    const { slug } = await build(id)
    dialog = join(dir, 'pic.jpg')
    writeFileSync(dialog, 'PIC')
    const c = (await h()['demo.photoAdd'](ev, id)) as DemoContent
    expect(c.photos.at(-1)).toEqual({ file: 'img/3.jpg', author: null, source: 'user' })
    expect(readFileSync(join(dir, 'demos', slug, 'img', '3.jpg'), 'utf8')).toBe('RPIC')
  })

  it('importSite then publish injects tracking; build switches back to template', async () => {
    setup()
    const id = mk()
    dialog = join(dir, 'site.html')
    writeFileSync(dialog, '<html><head></head><body>hi</body></html>')
    const v = (await h()['demo.importSite'](ev, id, 'html')) as DemoView
    expect(v).toMatchObject({ kind: 'import', source: 'import', content: null })
    expect(existsSync(join(dir, 'demos', v.slug, 'site', 'index.html'))).toBe(true)
    const p = (await h()['demo.publish'](ev, id)) as DemoView
    expect(p.status).toBe('published')
    expect(net.ghPaths()).toEqual(expect.arrayContaining([`${v.slug}/index.html`]))
    const b = await build(id)
    expect(b).toMatchObject({ kind: 'template', slug: v.slug })
  })

  it('openLive opens url with ?me=1', async () => {
    setup()
    const id = mk()
    const { slug } = await build(id)
    await h()['demo.publish'](ev, id)
    await h()['demo.openLive'](ev, id)
    expect(opened).toEqual([`https://u.github.io/leadly-demos/${slug}/?me=1`])
  })

  it('list returns place name', async () => {
    const id = mk()
    await build(id)
    const l = (await h()['demo.list'](ev)) as (DemoView & { placeName: string })[]
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ placeId: id, placeName: 'Кофе Поинт', counts: { open: 0, qr: 0, want: 0 } })
  })

  it('license: build and publish need license', async () => {
    const id = mk()
    pub = undefined
    await expect(build(id)).rejects.toThrow('license_required')
    await expect(h()['demo.publish'](ev, id)).rejects.toThrow('license_required')
  })

  it('setupWorker creates secret once; setup redeploys on version mismatch', async () => {
    setSecret(db, 'cloudflare', 'CT', secretEnv)
    const s = (await h()['demo.setupWorker'](ev)) as SetupState
    expect(s.worker).toMatchObject({ ok: true, url: WORKER, version: WORKER_VERSION })
    const secret = getWorkerSecret(db, secretEnv)
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await h()['demo.setupWorker'](ev)
    expect(getWorkerSecret(db, secretEnv)).toBe(secret)
    const puts = () => net.calls.filter((c) => c.method === 'PUT' && c.url.includes('/workers/scripts/')).length
    expect(puts()).toBe(2)
    net.st.health = 'ok 0'
    setSetting(db, 'demo:worker', { ...getSetting(db, 'demo:worker', {}), version: '0' })
    const st = (await h()['demo.setup'](ev)) as SetupState
    expect(puts()).toBe(3)
    expect(st.worker).toMatchObject({ ok: true, version: WORKER_VERSION })
    net.st.cfSub = null
    expect(((await h()['demo.setupWorker'](ev)) as SetupState).worker).toMatchObject({ ok: false, needSubdomain: true, error: 'cf_no_subdomain' })
  })

  it('setupGithub saves owner/repo and checks pages', async () => {
    setSecret(db, 'github', 'GT', secretEnv)
    const s = (await h()['demo.setupGithub'](ev)) as SetupState
    expect(getSetting(db, 'demo:github', null)).toEqual({ owner: 'U', repo: 'leadly-demos' })
    expect(s.github).toMatchObject({ ok: true, owner: 'U', repo: 'leadly-demos' })
  })

  const left = async () => ((await h()['demo.budget'](ev)) as { left: number }).left

  it('google budget: a failed photo still counts, repeated builds hit the limit', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    saveSettings(db, { demoGoogleDaily: 8 })
    const id = mk({ googlePlaceId: 'g1' })
    net.st.mediaFail = true
    await expect(build(id)).rejects.toThrow('google_unavailable')
    await expect(build(id)).rejects.toThrow('google_unavailable')
    const calls = googleCalls()
    await expect(build(id)).rejects.toThrow('demo_google_limit')
    expect(googleCalls()).toBe(calls)
    expect(await left()).toBe(0)
  })

  it('google budget: concurrent builds reserve before fetching', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    saveSettings(db, { demoGoogleDaily: 4 })
    const a = mk({ googlePlaceId: 'g1' })
    const b = mk({ googlePlaceId: 'g2', name: 'Другое' })
    const hh = h()
    const r = await Promise.allSettled([hh['demo.build'](ev, a, { source: 'auto' }), hh['demo.build'](ev, b, { source: 'auto' })])
    expect(r[0].status).toBe('fulfilled')
    expect(r[1]).toMatchObject({ status: 'rejected', reason: { message: 'demo_google_limit' } })
    expect(await left()).toBe(1) // 4 зарезервировано, 3 потрачено, 1 возвращён
  })

  it('match reserves one paid request', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    saveSettings(db, { demoGoogleDaily: 0 })
    await expect(h()['demo.match'](ev, mk())).rejects.toThrow('demo_google_limit')
    expect(googleCalls()).toBe(0)
  })

  it('rewrite asks AI again instead of the cache', async () => {
    saveSettings(db, { llmProvider: 'anthropic' })
    setSecret(db, 'anthropic', 'AK', secretEnv)
    const heads = ['Первый', 'Второй', 'Третий']
    let n = 0
    factory = () => ({ beta: { messages: { create: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ headline: heads[n++], subhead: 'Кофе рядом', about: 'Хорошее место.' }) }]
    }) } } }) as never
    const id = mk()
    expect((await build(id)).content!.headline).toBe('Первый')
    const a = (await h()['demo.rewrite'](ev, id)) as DemoContent
    const b = (await h()['demo.rewrite'](ev, id)) as DemoContent
    expect([a.headline, b.headline]).toEqual(['Второй', 'Третий'])
    expect(((await h()['demo.get'](ev, id)) as DemoView).content!.headline).toBe('Третий')
  })

  it('rebuild keeps user photos first, then Google ones', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    await build(id)
    dialog = join(dir, 'pic.jpg')
    writeFileSync(dialog, 'PIC')
    await h()['demo.photoAdd'](ev, id)
    const v = await build(id)
    expect(v.content!.photos.map((p) => `${p.file}:${p.source}`)).toEqual(['img/3.jpg:user', 'img/1.jpg:google', 'img/2.jpg:google'])
  })

  it('places.remove during the first build is refused', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    let release!: () => void
    net.st.gate = new Promise((r) => { release = r })
    const hh = h()
    const p = hh['demo.build'](ev, id, { source: 'auto' })
    await expect(hh['places.remove'](ev, id)).rejects.toThrow('demo_busy')
    release()
    await p
    expect(getPlace(db, id)).not.toBeNull()
  })

  it('place deleted while build waits: not_found, no row or folder', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const id = mk({ googlePlaceId: 'g1' })
    let release!: () => void
    net.st.gate = new Promise((r) => { release = r })
    const p = build(id)
    await new Promise((r) => setTimeout(r, 0))
    deletePlaceForever(db, id)
    release()
    await expect(p).rejects.toThrow('not_found')
    expect(db.prepare('SELECT COUNT(*) AS n FROM demos').get()).toEqual({ n: 0 })
    expect(existsSync(join(dir, 'demos')) ? readdirSync(join(dir, 'demos')) : []).toEqual([])
  })

  it('stale publishing after a crash becomes error interrupted', async () => {
    const id = mk()
    await build(id)
    db.prepare("UPDATE demos SET status='publishing'").run()
    const v = (await h()['demo.get'](ev, id)) as DemoView
    expect(v).toMatchObject({ status: 'error', error: 'interrupted' })
  })

  it('confirmed googleId is stored on the place unless another place has it', async () => {
    setSecret(db, 'google', 'GK', secretEnv)
    const a = mk()
    await build(a, { source: 'auto', googleId: 'g1' })
    expect(getPlace(db, a)!.googlePlaceId).toBe('g1')
    const b = mk({ name: 'Другое' })
    expect((await build(b, { source: 'auto', googleId: 'g1' })).source).toBe('google')
    expect(getPlace(db, b)!.googlePlaceId).toBeNull()
  })

  it('import badge toggle goes into the published html', async () => {
    setup()
    const id = mk()
    dialog = join(dir, 'site.html')
    writeFileSync(dialog, '<html><head></head><body>hi</body></html>')
    expect(((await h()['demo.importSite'](ev, id, 'html')) as DemoView).importBadge).toBe(false)
    const html = () => net.calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => Buffer.from(c.body.content, 'base64').toString()).at(-1)!
    await h()['demo.publish'](ev, id)
    expect(html()).not.toContain('@mynick')
    expect(((await h()['demo.setImportBadge'](ev, id, true)) as DemoView).importBadge).toBe(true)
    await h()['demo.publish'](ev, id)
    expect(html()).toContain('@mynick')
  })

  it('postcard is a stub for now', async () => {
    await expect(h()['demo.postcard'](ev, [1])).rejects.toThrow('not_implemented')
  })
})
