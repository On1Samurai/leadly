import type { BBox } from '../../shared/types'
import type { GeoMultiPolygon, GeoPolygon } from '../core/geo'
import type { FetchFn } from './http'
import { realSleep } from './http'

export interface CityHit {
  name: string; displayName: string; bbox: BBox; polygon: GeoPolygon | GeoMultiPolygon | null
}

const MIN_GAP_MS = 1000
let chain: Promise<unknown> = Promise.resolve()
let lastStart = 0

/** Очередь на уровне модуля: старты запросов не чаще раза в секунду. */
function throttled<T>(fn: () => Promise<T>, sleep = realSleep, now = Date.now): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStart + MIN_GAP_MS - now()
    if (wait > 0) await sleep(wait)
    lastStart = now()
    return fn()
  })
  chain = run.catch(() => undefined)
  return run
}

interface NominatimItem {
  name?: string; display_name?: string; boundingbox?: string[]
  geojson?: { type?: string }
}

export async function searchCity(q: string, country: string, fetchFn: FetchFn = fetch): Promise<CityHit[]> {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=5'
    + `&countrycodes=${encodeURIComponent(country.toLowerCase())}&q=${encodeURIComponent(q)}`
  const res = await throttled(() => fetchFn(url, { headers: { 'User-Agent': 'LocalLeads/0.1 (desktop app)' } }))
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
  const items = (await res.json()) as NominatimItem[]
  return items.filter((i) => i.boundingbox?.length === 4).map((i) => {
    const [south, north, west, east] = i.boundingbox!.map(Number)
    const t = i.geojson?.type
    const polygon = t === 'Polygon' || t === 'MultiPolygon' ? (i.geojson as GeoPolygon | GeoMultiPolygon) : null
    return { name: i.name ?? '', displayName: i.display_name ?? '', bbox: { south, west, north, east }, polygon }
  })
}
