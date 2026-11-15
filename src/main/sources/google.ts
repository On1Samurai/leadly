import type { BBox, Category, RawPlace } from '../../shared/types'
import type { FetchFn } from './http'

export class GoogleAuthError extends Error {}
export class GoogleTransientError extends Error {}
export class BudgetExhausted extends Error {}

export class Budget {
  used = 0
  constructor(private limit: number) {}
  take(): boolean {
    if (this.used >= this.limit) return false
    this.used++
    return true
  }
}

const BASE = 'https://places.googleapis.com/v1'
const FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'websiteUri', 'nationalPhoneNumber',
  'internationalPhoneNumber', 'rating', 'userRatingCount', 'businessStatus', 'primaryType', 'googleMapsUri']
const SEARCH_MASK = `${FIELDS.map((f) => `places.${f}`).join(',')},nextPageToken`

export function buildTextSearch(
  cell: BBox, cat: Category, lang: 'ru' | 'uk', pageToken?: string
): { url: string; headers: Record<string, string>; body: object } {
  const body: Record<string, unknown> = {
    textQuery: cat.query[lang],
    locationRestriction: { rectangle: {
      low: { latitude: cell.south, longitude: cell.west },
      high: { latitude: cell.north, longitude: cell.east }
    } },
    languageCode: lang,
    pageSize: 20
  }
  if (cat.googleType) body.includedType = cat.googleType
  if (pageToken) body.pageToken = pageToken
  return {
    url: `${BASE}/places:searchText`,
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': SEARCH_MASK },
    body
  }
}

interface GPlace {
  id?: string; displayName?: { text?: string }; formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  websiteUri?: string; nationalPhoneNumber?: string; internationalPhoneNumber?: string
  rating?: number; userRatingCount?: number; businessStatus?: string
}

function toRaw(p: GPlace): RawPlace | null {
  const lat = p.location?.latitude
  const lon = p.location?.longitude
  if (!p.id || lat === undefined || lon === undefined) return null
  const phone = p.internationalPhoneNumber ?? p.nationalPhoneNumber
  return {
    source: 'google', sourceId: p.id, name: p.displayName?.text ?? '', lat, lon,
    address: p.formattedAddress, phones: phone ? [phone] : [], website: p.websiteUri,
    rating: p.rating, reviews: p.userRatingCount, contacts: []
  }
}

const open = (p: GPlace): boolean => !p.businessStatus || p.businessStatus === 'OPERATIONAL'

export function parseTextSearch(json: unknown): { places: RawPlace[]; nextPageToken?: string } {
  const j = (json ?? {}) as { places?: GPlace[]; nextPageToken?: string }
  const places = (j.places ?? []).filter(open).map(toRaw).filter((p): p is RawPlace => p !== null)
  return { places, nextPageToken: j.nextPageToken }
}

export class GoogleClient {
  constructor(private apiKey: string, private budget: Budget, private fetchFn: FetchFn = fetch) {}

  private async call(url: string, init: RequestInit): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchFn(url, init)
    } catch {
      throw new GoogleTransientError('Google Places: сетевая ошибка')
    }
    if (res.ok) {
      try {
        return await res.json()
      } catch (e) {
        throw new GoogleTransientError('Google Places: invalid JSON response', { cause: e })
      }
    }
    if ([400, 401, 403].includes(res.status)) throw new GoogleAuthError(`Google Places: HTTP ${res.status}, проверьте ключ`)
    throw new GoogleTransientError(`Google Places: HTTP ${res.status}`)
  }

  async search(cell: BBox, cat: Category, lang: 'ru' | 'uk', pageToken?: string):
    Promise<{ places: RawPlace[]; nextPageToken?: string }> {
    if (!this.budget.take()) throw new BudgetExhausted('Лимит запросов Google исчерпан')
    const r = buildTextSearch(cell, cat, lang, pageToken)
    const json = await this.call(r.url, {
      method: 'POST',
      headers: { ...r.headers, 'X-Goog-Api-Key': this.apiKey },
      body: JSON.stringify(r.body)
    })
    return parseTextSearch(json)
  }

  async details(placeId: string): Promise<RawPlace> {
    const json = await this.call(`${BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': FIELDS.join(',') }
    })
    const p = toRaw(json as GPlace)
    if (!p) throw new GoogleTransientError('Google Places: пустой ответ')
    return p
  }
}
