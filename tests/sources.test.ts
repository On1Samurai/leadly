import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildOverpassQuery, fetchOverpass, OverpassUnavailable, parseOverpass } from '../src/main/sources/osm'
import { searchCity } from '../src/main/sources/nominatim'
import {
  Budget, BudgetExhausted, buildTextSearch, GoogleAuthError, GoogleClient, GoogleTransientError, parseTextSearch
} from '../src/main/sources/google'
import type { Category } from '../src/shared/types'

const fx = (n: string): unknown => JSON.parse(readFileSync(`tests/fixtures/json/${n}`, 'utf8'))
const cafe: Category = {
  id: 'cafe', title: 'Кафе', osm: [{ amenity: 'cafe' }], googleType: 'cafe',
  query: { ru: 'кафе', uk: 'кафе' }
}
const bbox = { south: 53.85, west: 27.4, north: 53.97, east: 27.7 }
const res = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status })

describe('overpass', () => {
  it('query contains bbox and tags', () => {
    const q = buildOverpassQuery(bbox, cafe)
    expect(q).toContain('nwr["amenity"="cafe"](53.85,27.4,53.97,27.7)')
    expect(q).toContain('out center tags')
    expect(q).toContain('[out:json][timeout:60]')
  })
  it('star means key exists, quotes escaped, b2b has name', () => {
    const q = buildOverpassQuery(bbox, { ...cafe, osm: [{ name: '*', shop: '*' }, { x: 'a"b\\c' }] })
    expect(q).toContain('nwr["name"]["shop"](')
    expect(q).toContain('["x"="a\\"b\\\\c"]')
  })
  it('parseOverpass', () => {
    const p = parseOverpass(fx('overpass.json'))
    expect(p).toHaveLength(2)
    expect(p[0].sourceId).toBe('node/1')
    expect(p[0].phones).toHaveLength(2)
    expect(p[0].website).toBe('https://cafe1.by')
    expect(p[0].hours).toBe('Mo-Fr 09:00-21:00')
    expect(p[1].hours).toBeUndefined()
    expect(p[0].contacts).toContainEqual({ kind: 'instagram', value: 'cafe_one' })
    expect(p[0].contacts).toContainEqual({ kind: 'telegram', value: 'cafe1' })
    expect(p[0].contacts).toContainEqual({ kind: 'whatsapp', value: '+375291234567' })
    expect(p[0].contacts).toContainEqual({ kind: 'email', value: 'a@b.by' })
    expect(p[1]).toMatchObject({ sourceId: 'way/2', lat: 53.91, lon: 27.51, website: 'https://instagram.com/cafe2' })
    expect(p[1].contacts).toContainEqual({ kind: 'instagram', value: 'cafe2' })
  })
  it('retries once then throws', async () => {
    const f = vi.fn(async () => res(504))
    const sleep = vi.fn(async () => {})
    await expect(fetchOverpass('q', f as unknown as typeof fetch, sleep)).rejects.toBeInstanceOf(OverpassUnavailable)
    expect(f).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10000)
  })
  it('503 twice, fetch rejects twice, bad json, 400', async () => {
    const sleep = vi.fn(async () => {})
    const f1 = vi.fn(async () => res(503))
    await expect(fetchOverpass('q', f1 as unknown as typeof fetch, sleep)).rejects.toBeInstanceOf(OverpassUnavailable)
    expect(f1).toHaveBeenCalledTimes(2)
    const f2 = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(fetchOverpass('q', f2 as unknown as typeof fetch, sleep)).rejects.toMatchObject({ cause: expect.any(TypeError) })
    expect(f2).toHaveBeenCalledTimes(2)
    const f3 = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(fetchOverpass('q', f3 as unknown as typeof fetch, sleep)).rejects.toBeInstanceOf(OverpassUnavailable)
    expect(f3).toHaveBeenCalledTimes(1)
    const f4 = vi.fn(async () => res(400))
    await expect(fetchOverpass('q', f4 as unknown as typeof fetch, sleep)).rejects.toThrow(/400/)
    expect(f4).toHaveBeenCalledTimes(1)
  })
  it('retry success', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200, { elements: [] }))
    const r = await fetchOverpass('q', f as unknown as typeof fetch, async () => {})
    expect(r).toEqual({ elements: [] })
    const init = f.mock.calls[1][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('data=q')
  })
})

describe('nominatim', () => {
  it('searchCity maps fields', async () => {
    const f = vi.fn(async () => res(200, [{
      name: 'Минск', display_name: 'Минск, Беларусь', boundingbox: ['53.8', '54.0', '27.3', '27.8'],
      geojson: { type: 'Polygon', coordinates: [] }
    }, { name: 'X', display_name: 'X', boundingbox: ['1', '2', '3', '4'], geojson: { type: 'Point', coordinates: [] } }]))
    const r = await searchCity('Минск', 'BY', f as unknown as typeof fetch)
    expect(r[0]).toMatchObject({ name: 'Минск', bbox: { south: 53.8, north: 54, west: 27.3, east: 27.8 } })
    expect(r[0].polygon).not.toBeNull()
    expect(r[1].polygon).toBeNull()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('countrycodes=by')
    expect(url).toContain('q=%D0%9C')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Leadly/0.1 (desktop app)')
  })
})

describe('google', () => {
  const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus,places.primaryType,places.googleMapsUri,nextPageToken'
  it('buildTextSearch body', () => {
    const r = buildTextSearch(bbox, cafe, 'ru', 'pt')
    expect(r.headers['X-Goog-FieldMask']).toBe(FIELDS)
    expect(r.body).toMatchObject({
      textQuery: 'кафе', includedType: 'cafe', languageCode: 'ru', pageSize: 20, pageToken: 'pt',
      locationRestriction: { rectangle: { low: { latitude: 53.85, longitude: 27.4 }, high: { latitude: 53.97, longitude: 27.7 } } }
    })
  })
  it('parseTextSearch skips closed', () => {
    const r = parseTextSearch(fx('google-text-search.json'))
    expect(r.places.map((p) => p.sourceId)).toEqual(['g1', 'g3'])
    expect(r.places[0]).toMatchObject({ source: 'google', name: 'Кофейня А', phones: ['+375 29 111 22 33'], reviews: 12, rating: 4.5 })
    expect(r.nextPageToken).toBe('tok')
    expect(parseTextSearch({}).places).toEqual([])
  })
  it('budget stops before network', async () => {
    const f = vi.fn(async () => res(200, {}))
    const g = new GoogleClient('K', new Budget(2), f as unknown as typeof fetch)
    await g.search(bbox, cafe, 'ru')
    await g.search(bbox, cafe, 'ru')
    await expect(g.search(bbox, cafe, 'ru')).rejects.toBeInstanceOf(BudgetExhausted)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('error mapping, no key leak', async () => {
    const mk = (s: number): GoogleClient => new GoogleClient('SECRETKEY', new Budget(9), (async () => res(s)) as unknown as typeof fetch)
    await expect(mk(403).search(bbox, cafe, 'ru')).rejects.toBeInstanceOf(GoogleAuthError)
    await expect(mk(429).search(bbox, cafe, 'ru')).rejects.toBeInstanceOf(GoogleTransientError)
    await expect(mk(503).details('x')).rejects.toBeInstanceOf(GoogleTransientError)
    const net = new GoogleClient('SECRETKEY', new Budget(9), (async () => { throw new Error('boom SECRETKEY') }) as unknown as typeof fetch)
    await expect(net.search(bbox, cafe, 'ru')).rejects.toSatisfy((e: Error) => e instanceof GoogleTransientError && !e.message.includes('SECRETKEY'))
  })
  it('google 200 invalid json -> transient', async () => {
    const f = (async () => new Response('nope', { status: 200 })) as unknown as typeof fetch
    const g = new GoogleClient('K', new Budget(9), f)
    await expect(g.search(bbox, cafe, 'ru')).rejects.toBeInstanceOf(GoogleTransientError)
    await expect(g.details('x')).rejects.toBeInstanceOf(GoogleTransientError)
  })
  it('details', async () => {
    const f = vi.fn(async () => res(200, fx('google-text-search.json') && { id: 'g1', displayName: { text: 'A' }, location: { latitude: 1, longitude: 2 } }))
    const g = new GoogleClient('K', new Budget(0), f as unknown as typeof fetch)
    expect((await g.details('g1')).sourceId).toBe('g1')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://places.googleapis.com/v1/places/g1')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(FIELDS.replaceAll('places.', '').replace(',nextPageToken', ''))
  })
})
