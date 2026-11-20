import type { FetchFn } from '../sources/http'

export interface WorkerEvent { id: number; slug: string; kind: 'open' | 'qr' | 'want'; ts: number }

// errors are bare codes: the secret never reaches error text
export class WorkerApi {
  constructor(private fetch: FetchFn, private url: string, private secret: string) {}

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetch(this.url + path, {
        method,
        headers: { Authorization: `Bearer ${this.secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new Error('worker_offline')
    }
  }

  async health(): Promise<string | null> {
    try {
      const res = await this.fetch(this.url + '/health', { signal: AbortSignal.timeout(15_000) })
      return res.ok ? (await res.text()).trim() : null
    } catch {
      return null
    }
  }

  async putTarget(slug: string, url: string, tg: string): Promise<void> {
    const res = await this.req('PUT', `/api/targets/${encodeURIComponent(slug)}`, { url, tg })
    if (!res.ok) throw new Error(`worker_http_${res.status}`)
  }

  async deleteTarget(slug: string): Promise<void> {
    const res = await this.req('DELETE', `/api/targets/${encodeURIComponent(slug)}`)
    if (!res.ok && res.status !== 404) throw new Error(`worker_http_${res.status}`)
  }

  async events(since: number): Promise<WorkerEvent[]> {
    const res = await this.req('GET', `/api/events?since=${since}`)
    if (!res.ok) throw new Error(`worker_http_${res.status}`)
    const json: any = await res.json().catch(() => null)
    if (!Array.isArray(json?.events)) throw new Error('worker_bad_response')
    return json.events
  }
}
