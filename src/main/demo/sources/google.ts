import type { Place } from '../../../shared/types'
import type { DemoReview } from '../../../shared/demo/types'
import type { Db } from '../../db/db'
import { haversineM } from '../../core/geo'
import type { FetchFn } from '../../sources/http'

const BASE = 'https://places.googleapis.com/v1'
export const GOOGLE_DEMO_COST_USD = 0.04
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

export async function matchGoogle(place: Place, key: string, fetch: FetchFn, lang: 'ru' | 'uk'):
  Promise<{ googleId: string; name: string; address: string | null; distanceM: number } | null> {
  const res = await call(fetch, `${BASE}/places:searchText`, key,
    'places.id,places.displayName,places.formattedAddress,places.location', {
      textQuery: place.name, languageCode: lang, pageSize: 5,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lon }, radius: 100 } }
    })
  const j = (await res.json()) as { places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[] }
  let best: { googleId: string; name: string; address: string | null; distanceM: number } | null = null
  for (const p of j.places ?? []) {
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
  const j = (await res.json()) as GDetails
  let requests = 1
  const photos: SourceData['photos'] = []
  for (const ph of (j.photos ?? []).slice(0, maxPhotos)) {
    if (!ph.name) continue
    requests++
    const m = await call(fetch, `${BASE}/${ph.name}/media?maxWidthPx=1200`, key, null)
    photos.push({ bytes: Buffer.from(await m.arrayBuffer()), author: ph.authorAttributions?.[0]?.displayName ?? null })
  }
  const reviews = (j.reviews ?? []).slice(0, 5).map((r, i): DemoReview => ({
    author: r.authorAttribution?.displayName ?? '', text: r.text?.text ?? r.originalText?.text ?? '', rating: r.rating ?? null, on: i < 3
  }))
  return {
    hours: j.regularOpeningHours?.weekdayDescriptions ?? [], reviews, photos,
    summary: j.editorialSummary?.text ?? null, rating: j.rating ?? null, reviewsCount: j.userRatingCount ?? null,
    mapsUrl: j.googleMapsUri ?? null, fromGoogle: true, requests
  }
}

/** Фото из кэша лежат файлами, поэтому photos пуст, а список файлов отдельно. */
export function cachedDetails(db: Db, placeId: number, now: number):
  (SourceData & { photoFiles: { file: string; author: string | null }[] }) | null {
  const r = db.prepare('SELECT hours, reviews, photos, summary, fetched_at FROM place_details WHERE place_id=?').get(placeId) as
    { hours: string | null; reviews: string | null; photos: string | null; summary: string | null; fetched_at: number } | undefined
  if (!r || now - r.fetched_at > FRESH_MS) return null
  return {
    hours: JSON.parse(r.hours ?? '[]'), reviews: JSON.parse(r.reviews ?? '[]'), photos: [],
    photoFiles: JSON.parse(r.photos ?? '[]'), summary: r.summary,
    rating: null, reviewsCount: null, mapsUrl: null, fromGoogle: true
  }
}
