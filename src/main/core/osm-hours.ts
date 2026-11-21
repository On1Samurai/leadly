type Lang = 'ru' | 'uk'

const KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const DAYS: Record<Lang, string[]> = {
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  uk: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']
}
const WORDS = { ru: { all: 'Ежедневно', h24: 'Круглосуточно' }, uk: { all: 'Щодня', h24: 'Цілодобово' } }
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d'
const SPAN = new RegExp(`^${TIME}-${TIME}$`)

/** Простые правила OSM opening_hours -> строки для людей. Всё остальное: [raw]. */
export function formatOsmHours(raw: string, lang: 'ru' | 'uk'): string[] {
  const src = raw.trim()
  if (src === '24/7') return [WORDS[lang].h24]
  const names = DAYS[lang]
  const out: string[] = []
  for (const rule of src.split(';')) {
    const m = /^\s*([A-Za-z,-]+)\s+(\S+)\s*$/.exec(rule)
    if (!m) return [raw]
    const spans = m[2].split(',')
    if (!spans.every((s) => SPAN.test(s))) return [raw]
    const days: string[] = []
    for (const part of m[1].split(',')) {
      const [a, b, ...rest] = part.split('-').map((d) => KEYS.indexOf(d))
      if (rest.length || a < 0 || (b !== undefined && b <= a)) return [raw]
      days.push(b === undefined ? names[a] : a === 0 && b === 6 && m[1] === part ? WORDS[lang].all : `${names[a]}–${names[b]}`)
    }
    out.push(`${days.join(', ')} ${spans.map((s) => s.replace('-', '–')).join(', ')}`)
  }
  return out.length ? out : [raw]
}
