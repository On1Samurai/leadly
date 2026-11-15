import type { BBox, Category, Contact, RawPlace } from '../../shared/types'
import { contactFromUrl, isValidHandle } from '../core/links'
import { splitPhones } from '../core/phones'
import type { FetchFn, SleepFn } from './http'
import { realSleep } from './http'

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export function buildOverpassQuery(bbox: BBox, cat: Category): string {
  const area = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`
  const stmts = cat.osm.map((alt) => {
    const filters = Object.entries(alt)
      .map(([k, v]) => (v === '*' ? `["${esc(k)}"]` : `["${esc(k)}"="${esc(v)}"]`)).join('')
    return `nwr${filters}${area};`
  })
  return `[out:json][timeout:60];(${stmts.join('')});out center tags;`
}

interface OsmElement {
  type?: string; id?: number; lat?: number; lon?: number
  center?: { lat: number; lon: number }; tags?: Record<string, string>
}

function socialContact(kind: 'telegram' | 'instagram' | 'vk', raw: string): Contact | null {
  const v = raw.trim()
  if (/^https?:\/\//i.test(v) || /^(t\.me|instagram\.com|vk\.com)\//i.test(v)) return contactFromUrl(v)
  const h = v.replace(/^@/, '')
  return isValidHandle(h) ? { kind, value: h } : null
}

export function parseOverpass(json: unknown): RawPlace[] {
  const els = ((json as { elements?: OsmElement[] })?.elements ?? [])
  const out: RawPlace[] = []
  for (const el of els) {
    const t = el.tags ?? {}
    const name = t.name?.trim()
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (!name || !el.type || el.id === undefined || lat === undefined || lon === undefined) continue
    const phones = [...splitPhones(t.phone ?? ''), ...splitPhones(t['contact:phone'] ?? '')]
    const website = t.website?.trim() || t['contact:website']?.trim() || undefined
    const contacts: Contact[] = []
    const add = (c: Contact | null): void => { if (c) contacts.push(c) }
    if (website) add(contactFromUrl(website))
    for (const k of ['telegram', 'instagram', 'vk'] as const) {
      const v = t[`contact:${k}`]
      if (v) add(socialContact(k, v))
    }
    for (const k of ['whatsapp', 'viber'] as const) {
      const v = t[`contact:${k}`]?.trim()
      if (v) contacts.push({ kind: k, value: v })
    }
    const email = (t.email ?? t['contact:email'])?.trim()
    if (email) contacts.push({ kind: 'email', value: email })
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ')
    out.push({
      source: 'osm', sourceId: `${el.type}/${el.id}`, name, lat, lon,
      address: street || undefined, phones, website, contacts
    })
  }
  return out
}

export class OverpassUnavailable extends Error {}

const RETRYABLE = new Set([429, 502, 503, 504])

export async function fetchOverpass(
  query: string, fetchFn: FetchFn = fetch, sleep: SleepFn = realSleep
): Promise<unknown> {
  let last = 'unknown'
  let cause: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response | undefined
    try {
      res = await fetchFn('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Leadly/0.1 (desktop app)', Accept: '*/*' },
        body: `data=${encodeURIComponent(query)}`
      })
    } catch (e) {
      cause = e
      last = 'network error'
    }
    if (res) {
      if (res.ok) {
        try {
          return await res.json()
        } catch (e) {
          throw new OverpassUnavailable('Overpass: invalid JSON response', { cause: e })
        }
      }
      last = `HTTP ${res.status}`
      cause = undefined
      if (!RETRYABLE.has(res.status)) throw new OverpassUnavailable(`Overpass ${last}`)
    }
    if (attempt === 0) await sleep(10000)
  }
  throw new OverpassUnavailable(`Overpass unavailable (${last})`, { cause })
}
