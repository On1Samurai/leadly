import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GitHubError, GitHubPages } from '../src/main/demo/github'

const TOKEN = 'ghp_SECRETTOKEN123'
type Call = { method: string; path: string; body?: any; headers: Record<string, string> }
type Entry = { path: string; type: string; sha: string }

function fakeGh(init: { tree?: Entry[]; fail422?: number; empty?: boolean; status?: Record<string, number>; json?: Record<string, unknown> } = {}) {
  const calls: Call[] = []
  const trees: Record<string, Entry[]> = { t1: init.tree ?? [] }
  const commits: Record<string, { tree: { sha: string } }> = { c1: { tree: { sha: 't1' } }, other: { tree: { sha: 't1' } } }
  let head = 'c1'
  let n = 0
  let fail = init.fail422 ?? 0
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
  const fetch = (async (url: string, o: RequestInit = {}) => {
    const u = new URL(url)
    const method = o.method ?? 'GET'
    const body = o.body ? JSON.parse(o.body as string) : undefined
    const path = u.pathname.replace('/repos/o/r', '') + u.search
    calls.push({ method, path, body, headers: o.headers as Record<string, string> })
    const key = `${method} ${u.pathname.replace('/repos/o/r', '')}`
    if (init.status?.[key]) return reply(init.status[key], init.json?.[key])
    if (init.json?.[key]) return reply(200, init.json[key])
    if (key === 'GET /user') return reply(200, { login: 'MyUser' })
    if (key === 'GET /git/ref/heads/main') return init.empty ? reply(409) : reply(200, { object: { sha: head } })
    if (key.startsWith('GET /git/commits/')) return reply(200, commits[key.split('/').pop()!])
    if (key.startsWith('GET /git/trees/')) return reply(200, { tree: trees[key.split('/').pop()!] })
    if (key === 'POST /git/blobs') return reply(201, { sha: `b${++n}` })
    if (key === 'POST /git/trees') {
      const sha = `t${++n + 1}`
      trees[sha] = body.tree
      return reply(201, { sha })
    }
    if (key === 'POST /git/commits') {
      const sha = `c${++n + 1}`
      commits[sha] = { tree: { sha: body.tree } }
      return reply(201, { sha })
    }
    if (key === 'PATCH /git/refs/heads/main') {
      if (fail-- > 0) {
        head = 'other'
        return reply(422)
      }
      head = body.sha
      return reply(200, {})
    }
    if (method === 'PUT') return reply(201, {})
    return reply(404)
  }) as unknown as typeof fetch
  return { fetch, calls, get head() { return head } }
}

const gh = (f: typeof fetch) => new GitHubPages(f, TOKEN, { owner: 'o', repo: 'r' })
const files = [{ path: 'index.html', content: Buffer.from('hi') }, { path: 'img/1.jpg', content: Buffer.from([1, 2]) }]
const seq = (c: Call[]) => c.map((x) => `${x.method} ${x.path.split('?')[0]}`)

describe('publish', () => {
  it('sequence, headers, base64, base_tree, parents', async () => {
    const g = fakeGh()
    const sha = await gh(g.fetch).publish('s-1', files, 'demo: s-1')
    expect(seq(g.calls)).toEqual([
      'GET /git/ref/heads/main', 'GET /git/commits/c1', 'GET /git/trees/t1',
      'POST /git/blobs', 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main',
    ])
    expect(g.calls[0].headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' })
    expect(g.calls[3].body).toEqual({ content: Buffer.from('hi').toString('base64'), encoding: 'base64' })
    const t = g.calls[5].body
    expect(t.base_tree).toBe('t1')
    expect(t.tree.map((e: any) => e.path)).toEqual(['s-1/index.html', 's-1/img/1.jpg'])
    expect(g.calls[6].body).toMatchObject({ message: 'demo: s-1', parents: ['c1'] })
    expect(g.calls[7].body).toMatchObject({ sha, force: false })
    expect(g.head).toBe(sha)
  })

  it('overwrites the folder wholesale: old blobs not in new set are deleted', async () => {
    const g = fakeGh({ tree: [
      { path: 's-1/index.html', type: 'blob', sha: 'x' }, { path: 's-1/img/2.jpg', type: 'blob', sha: 'y' },
      { path: 's-10/a.html', type: 'blob', sha: 'z' }, { path: 's-1', type: 'tree', sha: 'q' }, { path: 'robots.txt', type: 'blob', sha: 'w' },
    ] })
    await gh(g.fetch).publish('s-1', files, 'm')
    const tree = g.calls.find((c) => c.path === '/git/trees')!.body.tree
    expect(tree).toContainEqual({ path: 's-1/img/2.jpg', mode: '100644', type: 'blob', sha: null })
    expect(tree.filter((e: any) => e.sha === null)).toHaveLength(1)
  })

  it('422 on ref: re-reads head, rebuilds tree+commit on the new head, once', async () => {
    const g = fakeGh({ fail422: 1 })
    await gh(g.fetch).publish('s-1', files, 'm')
    const commits = g.calls.filter((c) => c.path === '/git/commits')
    expect(commits.map((c) => c.body.parents)).toEqual([['c1'], ['other']])
    expect(g.calls.filter((c) => c.path === '/git/trees').map((c) => c.body.base_tree)).toEqual(['t1', 't1'])
    expect(g.calls.filter((c) => c.method === 'GET' && c.path === '/git/ref/heads/main')).toHaveLength(2)
  })

  it('republish of unchanged files: no blob uploads, existing sha reused; changed file uploaded', async () => {
    const gitSha = (b: Buffer) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')
    const g = fakeGh({ tree: [
      { path: 's-1/index.html', type: 'blob', sha: gitSha(Buffer.from('hi')) },
      { path: 's-1/img/1.jpg', type: 'blob', sha: gitSha(Buffer.from([1, 2])) },
    ] })
    await gh(g.fetch).publish('s-1', files, 'm')
    expect(g.calls.filter((c) => c.path === '/git/blobs')).toHaveLength(0)
    const tree = g.calls.find((c) => c.path === '/git/trees')!.body.tree
    expect(tree).toEqual([
      { path: 's-1/index.html', mode: '100644', type: 'blob', sha: gitSha(Buffer.from('hi')) },
      { path: 's-1/img/1.jpg', mode: '100644', type: 'blob', sha: gitSha(Buffer.from([1, 2])) },
    ])
    const g2 = fakeGh({ tree: [{ path: 's-1/index.html', type: 'blob', sha: gitSha(Buffer.from('old')) }] })
    await gh(g2.fetch).publish('s-1', files, 'm')
    expect(g2.calls.filter((c) => c.path === '/git/blobs')).toHaveLength(2)
  })

  it('two 422 in a row: gh_conflict', async () => {
    const g = fakeGh({ fail422: 2 })
    await expect(gh(g.fetch).publish('s-1', files, 'm')).rejects.toMatchObject({ code: 'gh_conflict' })
  })
})

describe('unpublish', () => {
  it('deletes every blob under slug/ in a new tree', async () => {
    const g = fakeGh({ tree: [
      { path: 's-1/index.html', type: 'blob', sha: 'a' }, { path: 's-1/img/1.jpg', type: 'blob', sha: 'b' }, { path: 'other/x', type: 'blob', sha: 'c' },
    ] })
    const sha = await gh(g.fetch).unpublish('s-1')
    expect(sha).toBeTruthy()
    const t = g.calls.find((c) => c.path === '/git/trees')!.body
    expect(t.tree).toEqual([
      { path: 's-1/index.html', mode: '100644', type: 'blob', sha: null },
      { path: 's-1/img/1.jpg', mode: '100644', type: 'blob', sha: null },
    ])
    expect(g.calls.find((c) => c.path === '/git/commits')!.body.message).toBe('remove: s-1')
  })
  it('no folder: null and no commit', async () => {
    const g = fakeGh({ tree: [{ path: 'other/x', type: 'blob', sha: 'c' }] })
    expect(await gh(g.fetch).unpublish('s-1')).toBeNull()
    expect(g.calls.some((c) => c.method !== 'GET')).toBe(false)
  })
})

describe('ensureInit', () => {
  it('empty repo (409): PUT robots.txt and index.html on main', async () => {
    const g = fakeGh({ empty: true })
    await gh(g.fetch).ensureInit()
    const puts = g.calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.path)).toEqual(['/contents/robots.txt', '/contents/.nojekyll', '/contents/index.html'])
    expect(puts[1].body.content).toBe('')
    expect(puts[0].body).toEqual({ message: 'init', branch: 'main', content: Buffer.from('User-agent: *\nDisallow: /\n').toString('base64') })
    expect(Buffer.from(puts[2].body.content, 'base64').toString()).toContain('<meta name="robots" content="noindex,nofollow">')
  })
  it('404 ref is treated as empty too', async () => {
    const g = fakeGh({ status: { 'GET /git/ref/heads/main': 404 } })
    await gh(g.fetch).ensureInit()
    expect(g.calls.filter((c) => c.method === 'PUT')).toHaveLength(3)
  })
  it('commits but no robots.txt / .nojekyll: PUT only the missing ones', async () => {
    const g = fakeGh({ tree: [{ path: 'index.html', type: 'blob', sha: 'a' }] })
    await gh(g.fetch).ensureInit()
    expect(g.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/contents/robots.txt', '/contents/.nojekyll'])
    const g2 = fakeGh({ tree: [{ path: 'robots.txt', type: 'blob', sha: 'a' }] })
    await gh(g2.fetch).ensureInit()
    expect(g2.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/contents/.nojekyll'])
  })
  it('robots.txt and .nojekyll present: nothing written', async () => {
    const g = fakeGh({ tree: [{ path: 'robots.txt', type: 'blob', sha: 'a' }, { path: '.nojekyll', type: 'blob', sha: 'b' }] })
    await gh(g.fetch).ensureInit()
    expect(g.calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

describe('enablePages', () => {
  const run = async (status: number) => {
    const g = fakeGh({ status: { 'POST /pages': status } })
    return { r: await gh(g.fetch).enablePages(), g }
  }
  it('201 and 409 -> ok, body source main /', async () => {
    const a = await run(201)
    expect(a.r).toBe('ok')
    expect(a.g.calls[0].body).toEqual({ source: { branch: 'main', path: '/' } })
    expect((await run(409)).r).toBe('ok')
  })
  it('403 -> manual', async () => expect((await run(403)).r).toBe('manual'))
  it('404 -> manual', async () => expect((await run(404)).r).toBe('manual'))
})

describe('exists', () => {
  it('200 -> true, 404 -> false, other errors propagate', async () => {
    expect(await gh(fakeGh({ json: { 'GET ': { permissions: { push: true } } } }).fetch).exists()).toBe(true)
    expect(await gh(fakeGh().fetch).exists()).toBe(false)
    await expect(gh(fakeGh({ status: { 'GET ': 500 } }).fetch).exists()).rejects.toMatchObject({ code: 'gh_http_500' })
  })
})

describe('bad 2xx bodies', () => {
  const nullAt = (suffix: string) => {
    const g = fakeGh({ tree: [{ path: 's-1/index.html', type: 'blob', sha: 'a' }] })
    return (async (url: string, o?: RequestInit) =>
      new URL(url).pathname.endsWith(suffix) ? new Response('null', { status: 200 }) : g.fetch(url, o)) as unknown as typeof fetch
  }
  it('null body or missing tree/sha -> gh_http_200, never TypeError', async () => {
    const fetches = [
      nullAt('/git/commits/c1'), nullAt('/git/trees/t1'), nullAt('/git/ref/heads/main'),
      fakeGh({ status: { 'GET /git/commits/c1': 200 } }).fetch, // empty body: no tree.sha
      fakeGh({ json: { 'GET /git/trees/t1': { sha: 't1' } } }).fetch // no tree array
    ]
    for (const f of fetches) {
      const e = await gh(f).unpublish('s-1').catch((x) => x)
      expect(e).toBeInstanceOf(GitHubError)
      expect(e.code).toBe('gh_http_200')
    }
  })
})

describe('missing main branch', () => {
  it('ref 404 + repo 200 -> gh_no_branch; ref 404 + repo 404 -> gh_not_found', async () => {
    const branchless = fakeGh({ status: { 'GET /git/ref/heads/main': 404 }, json: { 'GET ': { permissions: { push: true } } } })
    await expect(gh(branchless.fetch).unpublish('s-1')).rejects.toMatchObject({ code: 'gh_no_branch' })
    await expect(gh(branchless.fetch).publish('s-1', files, 'm')).rejects.toMatchObject({ code: 'gh_no_branch' })
    const gone = fakeGh({ status: { 'GET /git/ref/heads/main': 404 } })
    await expect(gh(gone.fetch).unpublish('s-1')).rejects.toMatchObject({ code: 'gh_not_found' })
  })
})

describe('truncated tree', () => {
  const big = (truncated: boolean) => fakeGh({ json: { 'GET /git/trees/t1': { tree: [{ path: 's-1/index.html', type: 'blob', sha: 'a' }], truncated } } })
  it('publish and unpublish refuse a partial view: gh_tree_truncated, nothing written', async () => {
    for (const op of [(p: GitHubPages) => p.publish('s-1', files, 'm'), (p: GitHubPages) => p.unpublish('s-1')]) {
      const g = big(true)
      await expect(op(gh(g.fetch))).rejects.toMatchObject({ code: 'gh_tree_truncated' })
      expect(g.calls.some((c) => c.method !== 'GET')).toBe(false)
    }
  })
  it('truncated: false is fine', async () => {
    expect(await gh(big(false).fetch).unpublish('s-1')).toBeTruthy()
  })
})

describe('check / login', () => {
  it('ok with pagesUrl', async () => {
    const g = fakeGh({ json: { 'GET ': { permissions: { push: true } }, 'GET /pages': { html_url: 'https://myuser.github.io/r/' } } })
    expect(await gh(g.fetch).check()).toEqual({ ok: true, pagesUrl: 'https://myuser.github.io/r/' })
  })
  it('pages 404 -> gh_pages_off', async () => {
    const g = fakeGh({ json: { 'GET ': { permissions: { push: true } } } })
    expect(await gh(g.fetch).check()).toEqual({ ok: false, error: 'gh_pages_off' })
  })
  it('GitHubError -> code', async () => {
    const g = fakeGh({ status: { 'GET ': 401 } })
    expect(await gh(g.fetch).check()).toEqual({ ok: false, error: 'gh_bad_token' })
  })
  it('login returns login', async () => expect(await gh(fakeGh().fetch).login()).toBe('MyUser'))
  it('no repo -> gh_no_repo', async () => {
    const p = new GitHubPages(fakeGh().fetch, TOKEN, null)
    await expect(p.publish('s', files, 'm')).rejects.toThrow('gh_no_repo')
    expect(() => p.pagesUrl('s')).toThrow('gh_no_repo')
    expect(await p.login()).toBe('MyUser')
  })
})

describe('errors', () => {
  it.each([[401, 'gh_bad_token'], [403, 'gh_no_access'], [404, 'gh_not_found'], [500, 'gh_http_500']])('%i -> %s', async (st, code) => {
    const g = fakeGh({ status: { 'GET /user': st } })
    const e = await gh(g.fetch).login().catch((x) => x)
    expect(e).toBeInstanceOf(GitHubError)
    expect(e.code).toBe(code)
  })
  it('429 and 403 rate limit -> gh_rate_limited; plain 403 stays gh_no_access', async () => {
    const run = async (st: number, message?: string) =>
      (await gh(fakeGh({ status: { 'GET /user': st }, json: { 'GET /user': message ? { message } : undefined } }).fetch).login().catch((x) => x)).code
    expect(await run(429)).toBe('gh_rate_limited')
    expect(await run(403, 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.')).toBe('gh_rate_limited')
    expect(await run(403, 'API rate limit exceeded for user ID 1.')).toBe('gh_rate_limited')
    expect(await run(403, 'Resource not accessible by personal access token')).toBe('gh_no_access')
  })
  it('fetch throws -> gh_offline, no token in message', async () => {
    const f = (async () => { throw new Error(`boom ${TOKEN}`) }) as unknown as typeof fetch
    const e = await gh(f).login().catch((x) => x)
    expect(e.code).toBe('gh_offline')
    expect(String(e.message) + String(e.stack?.split('\n')[0])).not.toContain(TOKEN)
  })
})

describe('waitBuild', () => {
  const builds = (seqs: unknown[]) => {
    let i = 0
    const f = (async () => new Response(JSON.stringify(seqs[Math.min(i++, seqs.length - 1)]), { status: 200 })) as unknown as typeof fetch
    return { f, polls: () => i }
  }
  it('building then built in 2 polls', async () => {
    const b = builds([{ status: 'building', commit: 'x' }, { status: 'built', commit: 'x' }])
    const sleeps: number[] = []
    expect(await gh(b.f).waitBuild('x', async (ms) => { sleeps.push(ms) })).toBe('built')
    expect(b.polls()).toBe(2)
    expect(sleeps).toEqual([10_000])
  })
  it('built for another commit keeps waiting; errored for ours -> errored', async () => {
    const b = builds([{ status: 'built', commit: 'old' }, { status: 'errored', commit: 'x' }])
    expect(await gh(b.f).waitBuild('x', async () => {})).toBe('errored')
  })
  it('timeout', async () => {
    const b = builds([{ status: 'building', commit: 'x' }])
    let clock = 0
    expect(await gh(b.f).waitBuild('x', async (ms) => { clock += ms }, 30_000)).toBe('timeout')
    expect(clock).toBe(30_000)
  })
  const flaky = (seq: (number | string | object)[]) => {
    let i = 0
    const f = (async () => {
      const s = seq[Math.min(i++, seq.length - 1)]
      if (s === 'offline') throw new Error('net')
      if (typeof s === 'string') return new Response(s, { status: 200 })
      return typeof s === 'number' ? new Response('{}', { status: s }) : new Response(JSON.stringify(s), { status: 200 })
    }) as unknown as typeof fetch
    return f
  }
  it('tolerates up to 3 consecutive transient errors (5xx / offline)', async () => {
    const f = flaky([502, 'offline', 500, { status: 'building', commit: 'x' }, 503, 503, 'offline', { status: 'built', commit: 'x' }])
    expect(await gh(f).waitBuild('x', async () => {})).toBe('built')
  })
  it('4th consecutive transient error throws', async () => {
    await expect(gh(flaky([500, 500, 'offline', 502])).waitBuild('x', async () => {})).rejects.toMatchObject({ code: 'gh_http_502' })
  })
  it('2xx with null / non-object body counts as transient, never a TypeError', async () => {
    const f = flaky(['null', '"str"', '5', { status: 'built', commit: 'x' }])
    expect(await gh(f).waitBuild('x', async () => {})).toBe('built')
    const e = await gh(flaky(['null', 'null', '7', 'null'])).waitBuild('x', async () => {}).catch((x) => x)
    expect(e).toBeInstanceOf(GitHubError)
    expect(e.code).toBe('gh_http_200')
  })
  it('non-transient error throws at once', async () => {
    await expect(gh(flaky([401])).waitBuild('x', async () => {})).rejects.toMatchObject({ code: 'gh_bad_token' })
  })
})

describe('pagesUrl', () => {
  it('lowercases owner', () => {
    expect(new GitHubPages(fakeGh().fetch, TOKEN, { owner: 'MyUser', repo: 'leadly-demos' }).pagesUrl('s-1')).toBe('https://myuser.github.io/leadly-demos/s-1/')
  })
})
