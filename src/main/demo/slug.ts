import { translit } from '../core/dedup'

export const SLUG_RE = /^[a-z0-9-]{3,64}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function makeSlug(name: string, rng: () => number, taken: (s: string) => boolean): string {
  const base =
    translit(name.toLowerCase().replace(/ё/g, 'е')).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') ||
    'demo'
  for (let i = 0; i < 10; i++) {
    const suffix = Array.from({ length: 4 }, () => ALPHABET[Math.floor(rng() * 36)]).join('')
    const s = `${base}-${suffix}`
    if (!taken(s)) return s
  }
  throw new Error('slug_exhausted')
}
