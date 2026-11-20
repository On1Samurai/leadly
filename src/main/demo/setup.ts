import { randomBytes } from 'node:crypto'
import type { SetupState } from '../../shared/demo/types'
import { getSetting, setSetting } from '../db/repo'
import type { IpcDeps } from '../ipc/define'
import { getSecret, getWorkerSecret, setWorkerSecret } from '../secrets'
import { WORKER_VERSION } from '../../worker/worker.js'
import { CfError, deployWorker, type WorkerConfig } from './cloudflare'
import { GitHubError, GitHubPages, type GhRepo } from './github'
import { WorkerApi } from './worker-api'

type Deps = Pick<IpcDeps, 'db' | 'secretEnv' | 'fetch'>

/** GitHub с токеном и репозиторием; null — не настроен. */
export function ghClient(d: Deps): GitHubPages | null {
  const token = getSecret(d.db, 'github', d.secretEnv)
  const repo = getSetting<GhRepo | null>(d.db, 'demo:github', null)
  return token && repo ? new GitHubPages(d.fetch, token, repo) : null
}

/** Worker с адресом и секретом; null — не настроен. */
export function workerClient(d: Deps): { api: WorkerApi; url: string } | null {
  const cfg = getSetting<WorkerConfig | null>(d.db, 'demo:worker', null)
  const secret = getWorkerSecret(d.db, d.secretEnv)
  return cfg && secret ? { api: new WorkerApi(d.fetch, cfg.url, secret), url: cfg.url } : null
}

export async function githubState(d: Deps): Promise<SetupState['github']> {
  const token = getSecret(d.db, 'github', d.secretEnv)
  const repo = getSetting<GhRepo | null>(d.db, 'demo:github', null)
  if (!token) return { ok: false, error: 'no_github_token', ...repo }
  if (!repo) return { ok: false }
  return { ...repo, ...(await new GitHubPages(d.fetch, token, repo).check()) }
}

export async function setupGithub(d: Deps, repo: string): Promise<SetupState['github']> {
  const token = getSecret(d.db, 'github', d.secretEnv)
  if (!token) return { ok: false, error: 'no_github_token', repo }
  try {
    const cfg: GhRepo = { owner: await new GitHubPages(d.fetch, token, null).login(), repo }
    const old = getSetting<GhRepo | null>(d.db, 'demo:github', null)
    const same = !!old && old.owner.toLowerCase() === cfg.owner.toLowerCase() && old.repo.toLowerCase() === repo.toLowerCase()
    // демо в старом репозитории остались бы без снятия: unpublish ищет папку уже в новом
    if (old && !same && d.db.prepare("SELECT 1 FROM demos WHERE status IN ('published','publishing','error') LIMIT 1").get()) {
      return { ok: false, error: 'gh_repo_locked', repo }
    }
    const gh = new GitHubPages(d.fetch, token, cfg)
    await gh.ensureInit()
    setSetting(d.db, 'demo:github', cfg)
    const manual = (await gh.enablePages()) === 'manual'
    return { ...cfg, ...(await gh.check()), ...(manual ? { manualPages: true } : {}) }
  } catch (e) {
    if (e instanceof GitHubError) return { ok: false, error: e.code, repo }
    throw e
  }
}

/** Выкладывает Worker; секрет создаётся один раз и дальше переиспользуется. */
export async function deployWorkerState(d: Deps): Promise<SetupState['worker']> {
  const token = getSecret(d.db, 'cloudflare', d.secretEnv)
  if (!token) return { ok: false, error: 'no_cloudflare_token' }
  let secret = getWorkerSecret(d.db, d.secretEnv)
  if (!secret) {
    secret = randomBytes(32).toString('base64url')
    setWorkerSecret(d.db, secret, d.secretEnv)
  }
  try {
    const cfg = await deployWorker(d.fetch, token, secret)
    setSetting(d.db, 'demo:worker', cfg)
    return { ok: true, url: cfg.url, version: cfg.version }
  } catch (e) {
    if (!(e instanceof CfError)) throw e
    return { ok: false, error: e.code, ...(e.code === 'cf_no_subdomain' ? { needSubdomain: true } : {}) }
  }
}

/** Состояние Worker по /health; другая версия — перевыкладка. */
export async function workerState(d: Deps): Promise<SetupState['worker']> {
  const w = workerClient(d)
  if (!w) return { ok: false }
  const h = await w.api.health()
  if (!h || !/^ok\b/.test(h)) return { ok: false, url: w.url, error: 'worker_offline' }
  const version = h.slice(3)
  return version === WORKER_VERSION ? { ok: true, url: w.url, version } : deployWorkerState(d)
}
