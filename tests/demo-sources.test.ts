process.env.TZ = 'Europe/Minsk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { demoGoogleLeft, takeDemoGoogle } from '../src/main/core/daily'
import { cachedDetails, fetchGoogleDemo, matchGoogle } from '../src/main/demo/sources/google'
import { freeDemo } from '../src/main/demo/sources/free'
import type { Place } from '../src/shared/types'

const MASK = 'id,displayName,regularOpeningHours,reviews,photos,editorialSummary,rating,userRatingCount,googleMapsUri'
type Call = { url: string; headers: Record<string, string>; body?: string }
const mkFetch = (calls: Call[], route: (url: string) => Response): typeof fetch =>
  (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined })
    return route(url)
  }) as unknown as typeof fetch
const json = (o: unknown, status = 200): Response => new Response(JSON.stringify(o), { status })

let dir: string
let db: Db
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-dsrc-')); db = openDb(join(dir, 't.db')) })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

describe('fetchGoogleDemo', () => {
  const details = {
    regularOpeningHours: { weekdayDescriptions: ['Понедельник: 09:00–21:00'] },
    reviews: Array.from({ length: 7 }, (_, i) => ({ text: { text: `t${i}` }, rating: 5, authorAttribution: { displayName: `a${i}` } })),
    photos: [{ name: 'places/g1/photos/p1', authorAttributions: [{ displayName: 'Аня' }] }, { name: 'places/g1/photos/p2', authorAttributions: [{ displayName: 'Боб' }] }],
    editorialSummary: { text: 'Уютно' }, rating: 4.6, userRatingCount: 120, googleMapsUri: 'https://maps.google/x'
  }
  const route = (url: string): Response => url.includes('/media') ? new Response(Buffer.from([1, 2, 3])) : json(details)

  it('маска, часы, авторы, requests, отзывы', async () => {
    const calls: Call[] = []
    const r = await fetchGoogleDemo('g1', 'KEY', mkFetch(calls, route), 'ru')
    expect(calls[0].headers['X-Goog-FieldMask']).toBe(MASK)
    expect(r.requests).toBe(3)
    expect(r.hours).toEqual(['Понедельник: 09:00–21:00'])
    expect(r.photos.map((p) => p.author)).toEqual(['Аня', 'Боб'])
    expect(r.photos[0].bytes).toEqual(Buffer.from([1, 2, 3]))
    expect(r.reviews).toHaveLength(5)
    expect(r.reviews.map((x) => x.on)).toEqual([true, true, true, false, false])
    expect(r.mapsUrl).toBe('https://maps.google/x')
    expect(calls.every((c) => !c.url.includes('KEY'))).toBe(true)
  })
  it('403 → google_auth, 500 → google_unavailable', async () => {
    await expect(fetchGoogleDemo('g1', 'KEY', mkFetch([], () => json({}, 403)), 'ru')).rejects.toThrow('google_auth')
    await expect(fetchGoogleDemo('g1', 'KEY', mkFetch([], () => json({}, 500)), 'ru')).rejects.toThrow('google_unavailable')
  })
})

describe('matchGoogle', () => {
  const place = { name: 'Кофе', lat: 53.9, lon: 27.56 } as Place
  const at = (dLat: number): unknown => ({ places: [{ id: 'g1', displayName: { text: 'Кофе' }, location: { latitude: 53.9 + dLat, longitude: 27.56 } }] })
  it('80 м → найден', async () => {
    const r = await matchGoogle(place, 'K', mkFetch([], () => json(at(0.00072))), 'ru')
    expect(r?.googleId).toBe('g1')
    expect(Number.isInteger(r?.distanceM)).toBe(true)
  })
  it('300 м → null', async () => {
    expect(await matchGoogle(place, 'K', mkFetch([], () => json(at(0.0027))), 'ru')).toBeNull()
  })
})

describe('takeDemoGoogle', () => {
  it('лимит и сброс по дням', () => {
    const d1 = new Date(2026, 10, 14, 12).getTime()
    expect(takeDemoGoogle(db, d1, 4, 5)).toBe(true)
    expect(takeDemoGoogle(db, d1, 4, 5)).toBe(false)
    expect(demoGoogleLeft(db, d1, 5)).toBe(1)
    expect(demoGoogleLeft(db, d1 + 86_400_000, 5)).toBe(5)
    expect(takeDemoGoogle(db, d1 + 86_400_000, 4, 5)).toBe(true)
  })
})

describe('freeDemo / cachedDetails', () => {
  it('часы из osm_hours', () => {
    const p = { id: 1, osmHours: 'Mo-Fr 09:00-21:00', rating: null, reviews: null } as Place
    const r = freeDemo(db, p, 'ru')
    expect(r.hours).toEqual(['Пн–Пт 09:00–21:00'])
    expect(r.fromGoogle).toBe(false)
  })
  it('кэш: свежий да, старше 30 дней нет', () => {
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','BY','{}',0)").run()
    db.prepare("INSERT INTO places(id,city_id,name,category,lat,lon,created_at) VALUES (1,1,'P','cafe',0,0,0)").run()
    db.prepare('INSERT INTO place_details(place_id,hours,reviews,photos,summary,fetched_at) VALUES (1,?,?,?,?,?)')
      .run('["h"]', '[]', '[{"file":"img/1.jpg","author":"A"}]', 's', 1000)
    const r = cachedDetails(db, 1, 1000 + 30 * 86_400_000)
    expect(r?.photoFiles).toEqual([{ file: 'img/1.jpg', author: 'A' }])
    expect(cachedDetails(db, 1, 1001 + 30 * 86_400_000)).toBeNull()
  })
})
