import { createHash } from 'node:crypto'
import type { Db } from '../db/db'
import type { DemoKind } from '../../shared/demo/types'
import type { Asker } from '../llm/message'
import { numbers } from '../llm/check'
import promptFile from '../llm/prompts/demo-copy.md?raw'

export interface CopyInput {
  name: string; category: string; demoKind: DemoKind; lang: 'ru' | 'uk'
  rating: number | null; reviewsCount: number | null; reviews: string[]; summary: string | null
}
export interface DemoCopy { headline: string; subhead: string; about: string }
export type CopyReason = 'bad_json' | 'too_long' | 'unknown_number' | 'price' | 'link' | 'empty'

const LIMITS = { headline: 60, subhead: 120, about: 400 } as const
const nl = promptFile.indexOf('\n')
const VERSION = /^version:\s*(\S+)/.exec(promptFile.slice(0, nl))?.[1] ?? '0'
const SYSTEM_PROMPT = promptFile.slice(nl + 1).trim()

const REASONS: Record<CopyReason, string> = {
  bad_json: 'ответ не является корректным JSON с полями headline, subhead, about',
  too_long: 'превышена допустимая длина (headline 60, subhead 120, about 400 символов)',
  unknown_number: 'упомянуто число, которого нет во входных данных',
  price: 'есть цена или валюта',
  link: 'есть ссылка',
  empty: 'пустое поле или обрезанный ответ'
}

const PRICE = /[₽₴$]|(?<![\p{L}\d])Br(?![\p{L}\d])|(?<!\p{L})(?:руб|грн)/iu

export function checkDemoCopy(raw: string, input: CopyInput): { ok: true; copy: DemoCopy } | { ok: false; reason: CopyReason } {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let j: unknown
  try { j = JSON.parse(body) } catch { return { ok: false, reason: 'bad_json' } }
  const o = j as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || (['headline', 'subhead', 'about'] as const).some((k) => typeof o[k] !== 'string')) {
    return { ok: false, reason: 'bad_json' }
  }
  const copy: DemoCopy = { headline: (o.headline as string).trim(), subhead: (o.subhead as string).trim(), about: (o.about as string).trim() }
  const keys = Object.keys(LIMITS) as (keyof DemoCopy)[]
  if (keys.some((k) => copy[k] === '')) return { ok: false, reason: 'empty' }
  if (keys.some((k) => [...copy[k]].length > LIMITS[k])) return { ok: false, reason: 'too_long' }
  const all = keys.map((k) => copy[k]).join('\n')
  if (/https?:|www\./i.test(all)) return { ok: false, reason: 'link' }
  if (PRICE.test(all)) return { ok: false, reason: 'price' }
  const known = new Set(numbers(JSON.stringify(input)))
  for (const n of numbers(all)) if (!known.has(n)) return { ok: false, reason: 'unknown_number' }
  return { ok: true, copy }
}

const clip = (s: string, n: number): string => {
  const a = [...s.trim()]
  return a.length <= n ? a.join('') : a.slice(0, n - 1).join('') + '…'
}

const TEXTS: Record<'ru' | 'uk', Record<DemoKind, { sub: string; about: (n: string) => string }>> = {
  ru: {
    food: { sub: 'Уютное место, где всегда рады гостям', about: (n) => `${n} — место, куда приятно зайти. Загляните, чтобы попробовать блюда и почувствовать атмосферу.` },
    beauty: { sub: 'Забота о вас и вашем настроении', about: (n) => `${n} — студия, где о вас позаботятся. Запишитесь, чтобы познакомиться с мастерами.` },
    auto: { sub: 'Внимательный подход к вашему автомобилю', about: (n) => `${n} — автосервис, где к вашей машине относятся внимательно. Обратитесь, чтобы обсудить задачу.` },
    default: { sub: 'Рады видеть вас', about: (n) => `${n} — местное заведение, где вам всегда рады. Загляните или свяжитесь с нами.` }
  },
  uk: {
    food: { sub: 'Затишне місце, де завжди раді гостям', about: (n) => `${n} — місце, куди приємно зайти. Завітайте, щоб скуштувати страви та відчути атмосферу.` },
    beauty: { sub: 'Турбота про вас і ваш настрій', about: (n) => `${n} — студія, де про вас подбають. Запишіться, щоб познайомитися з майстрами.` },
    auto: { sub: 'Уважний підхід до вашого автомобіля', about: (n) => `${n} — автосервіс, де до вашої машини ставляться уважно. Зверніться, щоб обговорити завдання.` },
    default: { sub: 'Раді вас бачити', about: (n) => `${n} — місцевий заклад, де вам завжди раді. Завітайте або зв'яжіться з нами.` }
  }
}

export function fallbackCopy(input: CopyInput): DemoCopy {
  const t = TEXTS[input.lang][input.demoKind]
  const name = clip(input.name, 50)
  return { headline: name, subhead: t.sub, about: t.about(name) }
}

export async function generateDemoCopy(
  input: CopyInput, deps: { ask: Asker | null; db: Db; placeId: number }
): Promise<{ copy: DemoCopy; ai: boolean }> {
  if (!deps.ask) return { copy: fallbackCopy(input), ai: false }
  const ask = deps.ask
  const key = createHash('sha256').update('demo-copy:' + VERSION + JSON.stringify(input)).digest('hex')
  const hit = deps.db.prepare('SELECT response FROM llm_cache WHERE key = ?').get(key) as { response: string } | undefined
  if (hit) {
    const c = checkDemoCopy(hit.response, input)
    if (c.ok) return { copy: c.copy, ai: true }
  }
  const base = JSON.stringify(input)
  const attempt = async (content: string): Promise<ReturnType<typeof checkDemoCopy>> => {
    const r = await ask(SYSTEM_PROMPT, content)
    return r.truncated ? { ok: false, reason: 'empty' } : checkDemoCopy(r.text, input)
  }
  let c = await attempt(base)
  if (!c.ok) c = await attempt(`${base}\n\nПредыдущий вариант отклонён: ${REASONS[c.reason]}. Исправь.`)
  if (!c.ok) return { copy: fallbackCopy(input), ai: false }
  deps.db.prepare('INSERT OR REPLACE INTO llm_cache(key, response, created_at, place_id) VALUES (?, ?, ?, ?)')
    .run(key, JSON.stringify(c.copy), Date.now(), deps.placeId)
  return { copy: c.copy, ai: true }
}
