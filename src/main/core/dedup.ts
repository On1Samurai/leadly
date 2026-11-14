import { haversineM } from './geo'
import type { Candidate } from '../db/repo'
import type { Place } from '../../shared/types'

const STOP = new Set([
  'кафе', 'ресторан', 'бар', 'кофейня', 'пиццерия', 'ооо', 'ип', 'тов', 'фоп', 'чуп', 'одо',
  'cafe', 'restaurant', 'bar', 'coffee', 'pizzeria'
])

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u'
}

const translit = (s: string): string => Array.from(s, (ch) => TR[ch] ?? ch).join('')

export function normalizeName(name: string): string {
  const base = name.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“”]/g, '')
  const words = base.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const kept = words.filter((w) => !STOP.has(w))
  return translit((kept.length ? kept : words).join(' ')).replace(/[^a-z0-9]+/g, ' ').trim()
}

function trigrams(s: string): Set<string> {
  const p = `  ${s}  `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3))
  return out
}

export function trigramSim(a: string, b: string): number {
  if (!a && !b) return 0
  const A = trigrams(a)
  const B = trigrams(b)
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

export function findDuplicate(
  c: { googlePlaceId?: string; osmId?: string; phoneE164?: string; name: string; lat: number; lon: number },
  cands: Candidate[]
): number | null {
  for (const k of cands) {
    if ((c.googlePlaceId && k.googlePlaceId === c.googlePlaceId) || (c.osmId && k.osmId === c.osmId)) return k.id
  }
  if (c.phoneE164) {
    const k = cands.find((x) => x.phoneE164 === c.phoneE164)
    if (k) return k.id
  }
  const n = normalizeName(c.name)
  let best: number | null = null
  let bestD = Infinity
  for (const k of cands) {
    const d = haversineM(c, k)
    if (d <= 50 && d < bestD && trigramSim(n, normalizeName(k.name)) >= 0.6) { best = k.id; bestD = d }
  }
  return best
}

const ALWAYS_NEW: (keyof Place)[] = ['rating', 'reviews', 'googleFetchedAt', 'googlePlaceId']
const FILL_ONLY: (keyof Place)[] = [
  'name', 'category', 'address', 'cellId', 'phoneE164', 'website', 'webClass', 'osmId'
]

export function mergePatch(old: Place, inc: Partial<Place>): Partial<Place> {
  const patch: Record<string, unknown> = {}
  for (const k of ALWAYS_NEW) if (inc[k] != null) patch[k] = inc[k]
  for (const k of FILL_ONLY) if (old[k] == null && inc[k] != null) patch[k] = inc[k]
  // тип телефона non-null, поэтому следует за номером
  if ('phoneE164' in patch && inc.phoneType != null) patch.phoneType = inc.phoneType
  return patch as Partial<Place>
}
