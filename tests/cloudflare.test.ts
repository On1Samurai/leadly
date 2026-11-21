import { describe, expect, it } from 'vitest'
import { CfError, deployWorker } from '../src/main/demo/cloudflare'
import { WorkerApi } from '../src/main/demo/worker-api'
import { SCHEMA_SQL, WORKER_VERSION } from '../src/worker/worker.js'

const TOKEN = 'cf_SECRETTOKEN123'
type Call = { method: string; path: string; body?: any; form?: FormData; headers: Record<string, string> }

function fakeCf(o: { create?: unknown; d1?: any; sub?: string | null; accounts?: any[]; status?: Record<string, number>; offline?: boolean } = {}) {
  const calls: Call[] = []
  const ok = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, errors: [], result }), { status })
  const fetch = (async (url: string, init: RequestInit = {}) => {
    if (o.offline) throw new Error(`boom ${TOKEN}`)
    const u = new URL(url)
    const method = init.method ?? 'GET'
    const path = u.pathname.replace('/client/v4', '') + u.search
    const isForm = init.body instanceof FormData
    calls.push({
      method, path, headers: init.headers as Record<string, string>,
      body: init.body && !isForm ? JSON.parse(init.body as string) : undefined,
      form: isForm ? (init.body as FormData) : undefined
    })
    const key = `${method} ${u.pathname.replace('/client/v4', '').replace(/\/accounts\/acc1/, '')}`
    const st = o.status?.[method + ' ' + u.pathname.replace('/client/v4', '')]
    if (st) return new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: 'nope' }], result: null }), { status: st })
    if (key === 'GET /accounts') return ok(o.accounts ?? [{ id: 'acc1' }, { id: 'acc2' }])
    if (key === 'GET /workers/subdomain') return o.sub === null ? ok(null) : ok({ subdomain: o.sub ?? 'me' })
    if (key === 'GET /d1/database') return ok(o.d1 ?? [])
    if (key === 'POST /d1/database') return ok('create' in o ? o.create : { uuid: 'new-db' })
    if (key.startsWith('POST /d1/database/') && key.endsWith('/query')) return ok([])
    if (key === 'PUT /workers/scripts/leadly-demos') return ok({})
    if (key === 'POST /workers/scripts/leadly-demos/subdomain') return ok({ enabled: true })
    return new Response('?', { status: 500 })
  }) as unknown as typeof fetch
  return { fetch, calls }
}

describe('deployWorker', () => {
  it('deploy sequence', async () => {
    const { fetch, calls } = fakeCf()
    const cfg = await deployWorker(fetch, TOKEN, 'sec')
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /accounts',
      'GET /accounts/acc1/workers/subdomain',
      'GET /accounts/acc1/d1/database',
      'POST /accounts/acc1/d1/database',
      'POST /accounts/acc1/d1/database/new-db/query',
      'PUT /accounts/acc1/workers/scripts/leadly-demos',
      'POST /accounts/acc1/workers/scripts/leadly-demos/subdomain'
    ])
    expect(calls[2].path).toContain('name=leadly-demos')
    expect(calls[3].body).toEqual({ name: 'leadly-demos' })
    expect(calls[4].body).toEqual({ sql: SCHEMA_SQL })
    expect(calls[6].body).toEqual({ enabled: true })
    const meta = JSON.parse(await (calls[5].form!.get('metadata') as Blob).text())
    expect(meta.main_module).toBe('worker.js')
    expect(meta.bindings).toEqual([
      { type: 'd1', name: 'DB', id: 'new-db' },
      { type: 'secret_text', name: 'SECRET', text: 'sec' }
    ])
    const file = calls[5].form!.get('worker.js') as File
    expect(file.type).toBe('application/javascript+module')
    expect(await file.text()).toContain('WORKER_VERSION')
    for (const c of calls) expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(cfg).toEqual({ accountId: 'acc1', d1Id: 'new-db', url: 'https://leadly-demos.me.workers.dev', version: WORKER_VERSION })
  })

  it('reuses existing d1', async () => {
    const { fetch, calls } = fakeCf({ d1: [{ name: 'leadly-demos-old', uuid: 'x' }, { name: 'leadly-demos', uuid: 'old-db' }] })
    const cfg = await deployWorker(fetch, TOKEN, 's')
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/d1/database'))).toBe(false)
    expect(cfg.d1Id).toBe('old-db')
    expect(calls.some((c) => c.path.endsWith('/d1/database/old-db/query'))).toBe(true)
  })

  it('no subdomain', async () => {
    for (const o of [{ sub: null }, { sub: '' }, { status: { 'GET /accounts/acc1/workers/subdomain': 404 } }]) {
      await expect(deployWorker(fakeCf(o).fetch, TOKEN, 's')).rejects.toMatchObject({ code: 'cf_no_subdomain' })
    }
  })

  it('no accounts', async () => {
    await expect(deployWorker(fakeCf({ accounts: [] }).fetch, TOKEN, 's')).rejects.toMatchObject({ code: 'cf_no_access' })
  })

  it('errors', async () => {
    const run = (o: Parameters<typeof fakeCf>[0]) => deployWorker(fakeCf(o).fetch, TOKEN, 's').catch((e) => e)
    const e401 = await run({ status: { 'GET /accounts': 401 } })
    expect(e401).toBeInstanceOf(CfError)
    expect(e401.code).toBe('cf_bad_token')
    expect((await run({ status: { 'GET /accounts': 403 } })).code).toBe('cf_no_access')
    expect((await run({ status: { 'GET /accounts': 500 } })).code).toBe('cf_http_500')
    const off = await run({ offline: true })
    expect(off.code).toBe('cf_offline')
    for (const e of [e401, off]) expect(e.message).not.toContain(TOKEN)
  })

  it('D1 list not an array or create without uuid -> cf_bad_response', async () => {
    for (const o of [{ d1: {} }, { d1: 'x' }, { d1: [null], create: null }, { create: null }, { create: {} }, { create: { uuid: 5 } }]) {
      const e = await deployWorker(fakeCf(o).fetch, TOKEN, 's').catch((x) => x)
      expect(e, JSON.stringify(o)).toBeInstanceOf(CfError)
      expect(e.code).toBe('cf_bad_response')
    }
  })

  it('2xx with non-JSON body or without result -> cf_bad_response', async () => {
    for (const body of ['<html>oops</html>', JSON.stringify({ success: true, errors: [] }), 'null']) {
      const fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch
      const e = await deployWorker(fetch, TOKEN, 's').catch((x) => x)
      expect(e).toBeInstanceOf(CfError)
      expect(e.code).toBe('cf_bad_response')
    }
  })

  it('success:false with auth error code', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null }), { status: 200 })) as unknown as typeof globalThis.fetch
    await expect(deployWorker(fetch, TOKEN, 's')).rejects.toMatchObject({ code: 'cf_no_access' })
  })
})

describe('WorkerApi', () => {
  function fakeW(status = 200, body: unknown = { events: [] }, text = ' ok 1\n') {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: any }[] = []
    const fetch = (async (url: string, o: RequestInit = {}) => {
      calls.push({ method: o.method ?? 'GET', url, headers: o.headers as Record<string, string>, body: o.body ? JSON.parse(o.body as string) : undefined })
      return new Response(status === 204 ? null : url.endsWith('/health') ? text : JSON.stringify(body), { status })
    }) as unknown as typeof globalThis.fetch
    return { fetch, calls }
  }
  const down = (async () => { throw new Error('net s3cret') }) as unknown as typeof globalThis.fetch

  it('events sends since and bearer', async () => {
    const { fetch, calls } = fakeW(200, { events: [{ id: 6, slug: 'a', kind: 'open', ts: 1 }] })
    const ev = await new WorkerApi(fetch, 'https://w.example', 's').events(5)
    expect(calls[0].url).toBe('https://w.example/api/events?since=5')
    expect(calls[0].headers.Authorization).toBe('Bearer s')
    expect(ev).toEqual([{ id: 6, slug: 'a', kind: 'open', ts: 1 }])
  })

  it('events bad response', async () => {
    await expect(new WorkerApi(fakeW(200, { nope: 1 }).fetch, 'https://w.example', 's').events(0)).rejects.toThrow('worker_bad_response')
  })

  it('health', async () => {
    expect(await new WorkerApi(fakeW().fetch, 'https://w.example', 's').health()).toBe('ok 1')
    expect(await new WorkerApi(down, 'https://w.example', 's').health()).toBeNull()
    expect(await new WorkerApi(fakeW(500).fetch, 'https://w.example', 's').health()).toBeNull()
  })

  it('putTarget / deleteTarget', async () => {
    const { fetch, calls } = fakeW(204)
    const api = new WorkerApi(fetch, 'https://w.example', 's')
    await api.putTarget('slug1', 'https://x.y/z', 'tg_1')
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://w.example/api/targets/slug1', body: { url: 'https://x.y/z', tg: 'tg_1' } })
    await api.deleteTarget('slug1')
    expect(calls[1].method).toBe('DELETE')
    await expect(new WorkerApi(fakeW(500).fetch, 'https://w.example', 's').putTarget('a', 'https://x', 't')).rejects.toThrow('worker_http_500')
    await expect(new WorkerApi(fakeW(404).fetch, 'https://w.example', 's').deleteTarget('a')).resolves.toBeUndefined()
    await expect(new WorkerApi(down, 'https://w.example', 's').putTarget('a', 'https://x', 't')).rejects.toThrow(/^worker_offline$/)
  })
})
