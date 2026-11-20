import type { FetchFn } from '../sources/http'
import workerSource from '../../worker/worker.js?raw'
import { SCHEMA_SQL, WORKER_VERSION } from '../../worker/worker.js'

type CfCode = 'cf_bad_token' | 'cf_no_access' | 'cf_no_subdomain' | 'cf_offline' | 'cf_bad_response' | `cf_http_${number}`

// message is the bare code: the token never reaches error text
export class CfError extends Error {
  constructor(public code: CfCode) {
    super(code)
  }
}

export interface WorkerConfig { accountId: string; d1Id: string; url: string; version: string }

const API = 'https://api.cloudflare.com/client/v4'
const NAME = 'leadly-demos'

async function call(fetchFn: FetchFn, token: string, method: string, path: string, body?: unknown, notFoundOk = false): Promise<any> {
  let res: Response
  try {
    res = await fetchFn(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    })
  } catch {
    throw new CfError('cf_offline')
  }
  if (notFoundOk && res.status === 404) return null
  const json: any = (await res.json().catch(() => null)) ?? {}
  if (res.ok && json.success !== false) {
    // 2xx without the envelope (proxy page, truncated body): an error code, not a TypeError further on
    if (json.result === undefined) throw new CfError('cf_bad_response')
    return json.result
  }
  const authCode = Array.isArray(json.errors) && json.errors.some((e: any) => e?.code === 10000)
  throw new CfError(
    res.status === 401 ? 'cf_bad_token' : res.status === 403 || authCode ? 'cf_no_access' : `cf_http_${res.status}`
  )
}

export async function deployWorker(fetchFn: FetchFn, token: string, secret: string): Promise<WorkerConfig> {
  const c = (method: string, path: string, body?: unknown, nf = false) => call(fetchFn, token, method, path, body, nf)

  const accounts = await c('GET', '/accounts')
  const accountId: string | undefined = accounts?.[0]?.id
  if (!accountId) throw new CfError('cf_no_access')
  const a = `/accounts/${accountId}`

  const sub = (await c('GET', `${a}/workers/subdomain`, undefined, true))?.subdomain
  if (!sub) throw new CfError('cf_no_subdomain')

  const found = ((await c('GET', `${a}/d1/database?name=${NAME}`)) ?? []).find((d: any) => d.name === NAME)
  const d1Id: string = found?.uuid ?? (await c('POST', `${a}/d1/database`, { name: NAME })).uuid
  await c('POST', `${a}/d1/database/${d1Id}/query`, { sql: SCHEMA_SQL })

  const form = new FormData()
  form.set('metadata', new Blob([JSON.stringify({
    main_module: 'worker.js',
    compatibility_date: '2026-11-01',
    bindings: [{ type: 'd1', name: 'DB', id: d1Id }, { type: 'secret_text', name: 'SECRET', text: secret }]
  })], { type: 'application/json' }))
  form.set('worker.js', new Blob([workerSource], { type: 'application/javascript+module' }), 'worker.js')
  await c('PUT', `${a}/workers/scripts/${NAME}`, form)
  await c('POST', `${a}/workers/scripts/${NAME}/subdomain`, { enabled: true })

  return { accountId, d1Id, url: `https://${NAME}.${sub}.workers.dev`, version: WORKER_VERSION }
}
