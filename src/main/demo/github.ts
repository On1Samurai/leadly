import type { FetchFn, SleepFn } from '../sources/http'

type GhCode = 'gh_bad_token' | 'gh_no_access' | 'gh_not_found' | 'gh_conflict' | 'gh_offline' | `gh_http_${number}`

// message is the bare code: the token never reaches error text
export class GitHubError extends Error {
  constructor(public code: GhCode) {
    super(code)
  }
}

export interface GhRepo { owner: string; repo: string }
type Res = { status: number; json: any }
type TreeEntry = { path: string; mode: '100644'; type: 'blob'; sha: string | null }

const API = 'https://api.github.com'
const ROBOTS = 'User-agent: *\nDisallow: /\n'
const INDEX = '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Leadly demos</title><p>Здесь демо-сайты.</p>'

export class GitHubPages {
  constructor(private fetch: FetchFn, private token: string, private repo: GhRepo | null) {}

  private r(): string {
    if (!this.repo) throw new Error('gh_no_repo')
    return `/repos/${this.repo.owner}/${this.repo.repo}`
  }

  // statuses in `ok` are returned instead of thrown
  private async req(method: string, path: string, body?: unknown, ok: number[] = []): Promise<Res> {
    let res: Response
    try {
      res = await this.fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new GitHubError('gh_offline')
    }
    const json = await res.json().catch(() => ({}))
    if (res.ok || ok.includes(res.status)) return { status: res.status, json }
    throw new GitHubError(
      res.status === 401 ? 'gh_bad_token' : res.status === 403 ? 'gh_no_access' : res.status === 404 ? 'gh_not_found' : res.status === 422 ? 'gh_conflict' : `gh_http_${res.status}`,
    )
  }

  async login(): Promise<string> {
    return (await this.req('GET', '/user')).json.login
  }

  private async treePaths(headSha: string): Promise<{ treeSha: string; paths: string[] }> {
    const r = this.r()
    const treeSha = (await this.req('GET', `${r}/git/commits/${headSha}`)).json.tree.sha
    const tree = (await this.req('GET', `${r}/git/trees/${treeSha}?recursive=1`)).json.tree as { path: string; type: string }[]
    return { treeSha, paths: tree.filter((e) => e.type === 'blob').map((e) => e.path) }
  }

  private put(path: string, content: string) {
    return this.req('PUT', `${this.r()}/contents/${path}`, { message: 'init', branch: 'main', content: Buffer.from(content).toString('base64') })
  }

  async ensureInit(): Promise<void> {
    const ref = await this.req('GET', `${this.r()}/git/ref/heads/main`, undefined, [404, 409])
    if (ref.status === 404 || ref.status === 409) {
      await this.put('robots.txt', ROBOTS)
      await this.put('index.html', INDEX)
      return
    }
    if (!(await this.treePaths(ref.json.object.sha)).paths.includes('robots.txt')) await this.put('robots.txt', ROBOTS)
  }

  async enablePages(): Promise<'ok' | 'manual'> {
    try {
      await this.req('POST', `${this.r()}/pages`, { source: { branch: 'main', path: '/' } }, [409])
      return 'ok'
    } catch (e) {
      if (e instanceof GitHubError && e.code === 'gh_no_access') return 'manual'
      throw e
    }
  }

  async check(): Promise<{ ok: boolean; pagesUrl?: string; error?: string }> {
    try {
      const repo = (await this.req('GET', this.r())).json
      if (repo.permissions && !repo.permissions.push) return { ok: false, error: 'gh_no_access' }
      const pages = await this.req('GET', `${this.r()}/pages`, undefined, [404])
      if (pages.status === 404) return { ok: false, error: 'gh_pages_off' }
      return { ok: true, pagesUrl: pages.json.html_url }
    } catch (e) {
      if (e instanceof GitHubError) return { ok: false, error: e.code }
      throw e
    }
  }

  // One commit on top of main; `build` returns tree entries (null = nothing to do). A 422 on the
  // ref means main moved: rebuild everything on the new head, once.
  private async commit(msg: string, build: (existing: string[]) => Promise<TreeEntry[] | null>): Promise<string | null> {
    const r = this.r()
    for (let attempt = 0; ; attempt++) {
      const head = (await this.req('GET', `${r}/git/ref/heads/main`)).json.object.sha as string
      const { treeSha, paths } = await this.treePaths(head)
      const entries = await build(paths)
      if (!entries) return null
      const tree = (await this.req('POST', `${r}/git/trees`, { base_tree: treeSha, tree: entries })).json.sha
      const sha = (await this.req('POST', `${r}/git/commits`, { message: msg, tree, parents: [head] })).json.sha as string
      const upd = await this.req('PATCH', `${r}/git/refs/heads/main`, { sha, force: false }, [422])
      if (upd.status !== 422) return sha
      if (attempt >= 1) throw new GitHubError('gh_conflict')
    }
  }

  private dropped(slug: string, existing: string[], keep: Set<string>): TreeEntry[] {
    return existing
      .filter((p) => p.startsWith(`${slug}/`) && !keep.has(p))
      .map((path) => ({ path, mode: '100644', type: 'blob', sha: null }))
  }

  async publish(slug: string, files: { path: string; content: Buffer }[], msg: string): Promise<string> {
    const keep = new Set(files.map((f) => `${slug}/${f.path}`))
    return (await this.commit(msg, async (existing) => {
      const added: TreeEntry[] = []
      for (const f of files) {
        const blob = await this.req('POST', `${this.r()}/git/blobs`, { content: f.content.toString('base64'), encoding: 'base64' })
        added.push({ path: `${slug}/${f.path}`, mode: '100644', type: 'blob', sha: blob.json.sha })
      }
      return [...added, ...this.dropped(slug, existing, keep)]
    }))!
  }

  unpublish(slug: string): Promise<string | null> {
    return this.commit(`remove: ${slug}`, async (existing) => {
      const del = this.dropped(slug, existing, new Set())
      return del.length ? del : null
    })
  }

  async waitBuild(sha: string, sleep: SleepFn, timeoutMs = 180_000): Promise<'built' | 'errored' | 'timeout'> {
    for (let elapsed = 0; ; elapsed += 10_000) {
      const b = await this.req('GET', `${this.r()}/pages/builds/latest`, undefined, [404])
      if (b.json.commit === sha && b.json.status === 'built') return 'built'
      if (b.json.commit === sha && b.json.status === 'errored') return 'errored'
      if (elapsed >= timeoutMs) return 'timeout'
      await sleep(10_000)
    }
  }

  pagesUrl(slug: string): string {
    this.r()
    return `https://${this.repo!.owner.toLowerCase()}.github.io/${this.repo!.repo}/${slug}/`
  }
}
