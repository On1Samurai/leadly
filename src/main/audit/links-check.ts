import type { FetchFn } from '../sources/http'

const MAX_LINKS = 20
const TIMEOUT_MS = 5000

const bare = (h: string): string => h.toLowerCase().replace(/^www\./, '')

/** Returns same-origin links that answered 4xx/5xx. Network errors and timeouts are "unknown", not broken. */
export async function checkLinks(pageUrl: string, hrefs: string[], fetchFn: FetchFn = fetch): Promise<string[]> {
  let base: URL
  try { base = new URL(pageUrl) } catch { return [] }
  const seen = new Set<string>()
  const urls: string[] = []
  for (const raw of hrefs) {
    const h = raw.trim()
    if (!h || h.startsWith('#') || /^(mailto|tel|javascript):/i.test(h)) continue
    let u: URL
    try { u = new URL(h, base) } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (bare(u.hostname) !== bare(base.hostname)) continue
    u.hash = ''
    const s = u.toString()
    if (seen.has(s)) continue
    seen.add(s)
    urls.push(s)
    if (urls.length >= MAX_LINKS) break
  }
  const results = await Promise.all(urls.map(async (u) => ((await status(u, fetchFn)) >= 400 ? u : null)))
  return results.filter((x): x is string => x !== null)
}

async function status(url: string, fetchFn: FetchFn): Promise<number> {
  const req = async (method: string): Promise<number> => {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try { return (await fetchFn(url, { method, signal: ac.signal, redirect: 'follow' })).status }
    catch { return 0 }
    finally { clearTimeout(t) }
  }
  const s = await req('HEAD')
  return s === 405 || s === 501 ? req('GET') : s
}
