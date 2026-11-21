import type { Place } from '../../../shared/types'
import type { DemoReview } from '../../../shared/demo/types'
import type { Db } from '../../db/db'
import { haversineM } from '../../core/geo'
import type { FetchFn } from '../../sources/http'

const BASE = 'https://places.googleapis.com/v1'
// shortcut: list prices as of 2026-11, re-check https://developers.google.com/maps/billing-and-pricing/pricing before release
export const GOOGLE_DEMO_COST_USD = 0.05 // Details Enterprise+Atmosphere ≈0.025 + 3 фото ≈0.021
export const GOOGLE_MATCH_COST_USD = 0.035 // Text Search для подтверждения совпадения
export const DEMO_GOOGLE_NEED = 4 // Details + 3 фото
const DETAILS_MASK = 'id,displayName,regularOpeningHours,reviews,photos,editorialSummary,rating,userRatingCount,googleMapsUri'
const FRESH_MS = 30 * 86_400_000

export interface SourceData {
  hours: string[]; reviews: DemoReview[]; photos: { bytes: Buffer; author: string | null }[]
  summary: string | null; rating: number | null; reviewsCount: number | null; mapsUrl: string | null; fromGoogle: boolean
}

/** Ключ идёт только в заголовке; сообщения ошибок его не содержат. */
async function call(fetch: FetchFn, url: string, key: string, mask: string | null, body?: object): Promise<Response> {
  const headers: Record<string, string> = { 'X-Goog-Api-Key': key }
  if (mask) headers['X-Goog-FieldMask'] = mask
  if (body) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error('google_unavailable')
  }
  if (res.status === 401 || res.status === 403) throw new Error('google_auth')
  if (!res.ok) throw new Error('google_unavailable')
  return res
}

/** Ответ Google — объект JSON; иначе google_unavailable, а не TypeError/SyntaxError. */
async function body<T>(res: Response): Promise<T> {
  const j: unknown = await res.json().catch(() => null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('google_unavailable')
  return j as T
}
/** Элементы-объекты массива; null и мусор пропускаются. */
const objs = <T>(a: T[] | undefined): T[] => (Array.isArray(a) ? a.filter((x) => !!x && typeof x === 'object') : [])
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)

export async function matchGoogle(place: Place, key: string, fetch: FetchFn, lang: 'ru' | 'uk'):
  Promise<{ googleId: string; name: string; address: string | null; distanceM: number } | null> {
  const res = await call(fetch, `${BASE}/places:searchText`, key,
    'places.id,places.displayName,places.formattedAddress,places.location', {
      textQuery: place.name, languageCode: lang, pageSize: 5,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lon }, radius: 100 } }
    })
  const j = await body<{ places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[] }>(res)
  let best: { googleId: string; name: string; address: string | null; distanceM: number } | null = null
  for (const p of objs(j.places)) {
    if (!p.id || p.location?.latitude === undefined || p.location.longitude === undefined) continue
    const d = Math.round(haversineM(place, { lat: p.location.latitude, lon: p.location.longitude }))
    if (d <= 100 && (!best || d < best.distanceM)) {
      best = { googleId: p.id, name: p.displayName?.text ?? '', address: p.formattedAddress ?? null, distanceM: d }
    }
  }
  return best
}

interface GDetails {
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  reviews?: { text?: { text?: string }; originalText?: { text?: string }; rating?: number; authorAttribution?: { displayName?: string } }[]
  photos?: { name?: string; authorAttributions?: { displayName?: string }[] }[]
  editorialSummary?: { text?: string }
  rating?: number; userRatingCount?: number; googleMapsUri?: string
}

export async function fetchGoogleDemo(googleId: string, key: string, fetch: FetchFn, lang: 'ru' | 'uk', maxPhotos = 3):
  Promise<SourceData & { requests: number }> {
  const res = await call(fetch, `${BASE}/places/${encodeURIComponent(googleId)}?languageCode=${lang}`, key, DETAILS_MASK)
  const j = await body<GDetails>(res)
  let requests = 1
  const photos: SourceData['photos'] = []
  for (const ph of objs(j.photos).slice(0, maxPhotos)) {
    if (typeof ph.name !== 'string' || !ph.name) continue
    requests++ // оплачен и упавший запрос
    try {
      const m = await call(fetch, `${BASE}/${ph.name}/media?maxWidthPx=1200`, key, null)
      photos.push({ bytes: Buffer.from(await m.arrayBuffer()), author: str(objs(ph.authorAttributions)[0]?.displayName) })
    } catch { /* одно фото не должно ронять всю сборку */ }
  }
  const reviews = objs(j.reviews)
    .map((r) => ({ author: str(r.authorAttribution?.displayName) ?? '', text: str(r.text?.text) ?? str(r.originalText?.text) ?? '', rating: typeof r.rating === 'number' ? r.rating : null }))
    .filter((r) => r.text.trim())
    .slice(0, 5)
    .map((r, i): DemoReview => ({ ...r, on: i < 3 }))
  const hours = j.regularOpeningHours?.weekdayDescriptions
  return {
    hours: Array.isArray(hours) ? hours.filter((h) => typeof h === 'string') : [], reviews, photos,
    summary: str(j.editorialSummary?.text), rating: typeof j.rating === 'number' ? j.rating : null,
    reviewsCount: typeof j.userRatingCount === 'number' ? j.userRatingCount : null,
    mapsUrl: str(j.googleMapsUri), fromGoogle: true, requests
  }
}

/** Фото из кэша лежат файлами, поэтому photos пуст, а список файлов отдельно. */
export function cachedDetails(db: Db, placeId: number, now: number):
  (SourceData & { photoFiles: { file: string; author: string | null }[] }) | null {
  const r = db.prepare('SELECT hours, reviews, photos, summary, fetched_at FROM place_details WHERE place_id=?').get(placeId) as
    { hours: string | null; reviews: string | null; photos: string | null; summary: string | null; fetched_at: number } | undefined
  if (!r || now - r.fetched_at > FRESH_MS) return null
  let hours: unknown, reviews: unknown, photoFiles: unknown
  try {
    hours = JSON.parse(r.hours ?? '[]'); reviews = JSON.parse(r.reviews ?? '[]'); photoFiles = JSON.parse(r.photos ?? '[]')
  } catch { return null } // битый кэш — как его отсутствие
  if (!Array.isArray(hours) || !Array.isArray(reviews) || !Array.isArray(photoFiles)) return null
  return {
    hours, reviews, photos: [], photoFiles, summary: r.summary,
    rating: null, reviewsCount: null, mapsUrl: null, fromGoogle: true
  }
}
