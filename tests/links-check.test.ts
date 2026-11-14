import { describe, expect, it } from 'vitest'
import { checkLinks } from '../src/main/audit/links-check'

type Call = { url: string; method: string }
function mk(handler: (url: string, method: string) => number | 'throw') {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: String(url), method })
    const r = handler(String(url), method)
    if (r === 'throw') throw new Error('net')
    return { status: r } as Response
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('checkLinks', () => {
  it('401/403/429 are unknown, not broken', async () => {
    const { fn } = mk((u) => (u.endsWith('/a') ? 403 : u.endsWith('/b') ? 429 : u.endsWith('/c') ? 401 : 404))
    expect(await checkLinks('https://s.ru/', ['/a', '/b', '/c', '/d'], fn)).toEqual(['https://s.ru/d'])
  })
  it('same-origin only and max 20', async () => {
    const own = Array.from({ length: 25 }, (_, i) => `/p${i}`)
    const foreign = ['https://other.com/a', 'https://other.com/b', 'https://evil.org/']
    const { fn, calls } = mk(() => 200)
    const r = await checkLinks('https://www.site.ru/', [...own, ...foreign], fn)
    expect(r).toEqual([])
    expect(calls.length).toBe(20)
    expect(calls.every((c) => new URL(c.url).hostname === 'www.site.ru')).toBe(true)
  })
  it('treats www and bare host as same origin; skips mailto/tel/js/anchors; dedupes', async () => {
    const { fn, calls } = mk(() => 200)
    await checkLinks('https://site.ru/', ['https://www.site.ru/a', '/a#x', 'mailto:a@b.c', 'tel:+1', 'javascript:void(0)', '#top', '/a'], fn)
    expect(calls.length).toBe(2)
  })
  it('405 falls back to GET', async () => {
    const ok = mk((_u, m) => (m === 'HEAD' ? 405 : 200))
    expect(await checkLinks('https://s.ru/', ['/a'], ok.fn)).toEqual([])
    expect(ok.calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
    const bad = mk((_u, m) => (m === 'HEAD' ? 405 : 404))
    expect(await checkLinks('https://s.ru/', ['/a'], bad.fn)).toEqual(['https://s.ru/a'])
  })
  it('4xx/5xx broken, network errors are not', async () => {
    const { fn } = mk((u) => (u.endsWith('/n') ? 'throw' : u.endsWith('/x') ? 500 : u.endsWith('/y') ? 404 : 200))
    expect(await checkLinks('https://s.ru/', ['/n', '/x', '/y', '/z'], fn)).toEqual(['https://s.ru/x', 'https://s.ru/y'])
  })
})
