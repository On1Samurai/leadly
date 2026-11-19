/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/main/db/db'
import { checkDemoCopy, fallbackCopy, generateDemoCopy, type CopyInput } from '../src/main/demo/copy'

const input: CopyInput = {
  name: 'Кофейня Уют', category: 'cafe', demoKind: 'food', lang: 'ru',
  rating: 4.6, reviewsCount: 212, reviews: ['Вкусный кофе'], summary: null
}
const good = { headline: 'Кофейня Уют', subhead: 'Кофе и десерты рядом', about: 'Рейтинг 4.6 по 212 отзывам.' }
const j = (o: object): string => JSON.stringify(o)
const ok = (o: object = good) => ({ text: j(o), truncated: false })

describe('checkDemoCopy', () => {
  it('valid', () => expect(checkDemoCopy(j(good), input)).toEqual({ ok: true, copy: good }))
  it('strips code fence', () => expect(checkDemoCopy('```json\n' + j(good) + '\n```', input).ok).toBe(true))
  it('too long headline', () =>
    expect(checkDemoCopy(j({ ...good, headline: 'а'.repeat(61) }), input)).toEqual({ ok: false, reason: 'too_long' }))
  it('60 chars ok', () => expect(checkDemoCopy(j({ ...good, headline: 'а'.repeat(60) }), input).ok).toBe(true))
  it('unknown number', () =>
    expect(checkDemoCopy(j({ ...good, about: 'Работаем 15 лет' }), input)).toEqual({ ok: false, reason: 'unknown_number' }))
  it.each(['кофе от 65 ₴', 'от 5 ₽', '$', '10 Br', 'Br', '50 руб', '50 грн.', 'Руб'])('price %s', (s) =>
    expect(checkDemoCopy(j({ ...good, subhead: s }), input)).toEqual({ ok: false, reason: expect.stringMatching(/price|unknown_number/) }))
  it('price wins over number', () =>
    expect(checkDemoCopy(j({ ...good, subhead: 'кофе от 65 ₴' }), input)).toEqual({ ok: false, reason: 'price' }))
  it('Br inside a word is not price', () => expect(checkDemoCopy(j({ ...good, about: 'Brunch и кофе' }), input).ok).toBe(true))
  it('link', () => expect(checkDemoCopy(j({ ...good, about: 'см. http://x.by' }), input)).toEqual({ ok: false, reason: 'link' }))
  it('bad json', () => expect(checkDemoCopy('не json', input)).toEqual({ ok: false, reason: 'bad_json' }))
  it('missing field', () => expect(checkDemoCopy(j({ headline: 'a' }), input)).toEqual({ ok: false, reason: 'bad_json' }))
  it('empty field', () => expect(checkDemoCopy(j({ ...good, about: ' ' }), input)).toEqual({ ok: false, reason: 'empty' }))
})

describe('fallbackCopy', () => {
  it('limits hold for long names, no digits', () => {
    for (const lang of ['ru', 'uk'] as const) for (const demoKind of ['food', 'beauty', 'auto', 'default'] as const) {
      const c = fallbackCopy({ ...input, lang, demoKind, name: 'Очень длинное название '.repeat(10) })
      expect([...c.headline].length).toBeLessThanOrEqual(60)
      expect([...c.subhead].length).toBeLessThanOrEqual(120)
      expect([...c.about].length).toBeLessThanOrEqual(400)
      expect(checkDemoCopy(JSON.stringify(c), { ...input, name: 'x' }).ok).toBe(true)
    }
  })
})

describe('generateDemoCopy', () => {
  const db = () => openDb(':memory:')
  it('retries with reason, then ai', async () => {
    const ask = vi.fn().mockResolvedValueOnce(ok({ ...good, about: 'цена 5 $' })).mockResolvedValueOnce(ok())
    const r = await generateDemoCopy(input, { ask, db: db(), placeId: 1 })
    expect(r).toEqual({ copy: good, ai: true })
    expect(ask.mock.calls[1][1]).toContain('Предыдущий вариант отклонён: есть цена')
  })
  it('both bad -> fallback', async () => {
    const ask = vi.fn().mockResolvedValue({ text: 'мусор', truncated: false })
    const r = await generateDemoCopy(input, { ask, db: db(), placeId: 1 })
    expect(r).toEqual({ copy: fallbackCopy(input), ai: false })
    expect(ask).toHaveBeenCalledTimes(2)
  })
  it('ask null -> fallback', async () => {
    expect(await generateDemoCopy(input, { ask: null, db: db(), placeId: 1 })).toEqual({ copy: fallbackCopy(input), ai: false })
  })
  it('asker error propagates', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('net'))
    await expect(generateDemoCopy(input, { ask, db: db(), placeId: 1 })).rejects.toThrow('net')
  })
  it('cache hit', async () => {
    const d = db()
    const ask = vi.fn().mockResolvedValue(ok())
    await generateDemoCopy(input, { ask, db: d, placeId: 1 })
    const r = await generateDemoCopy(input, { ask, db: d, placeId: 1 })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ copy: good, ai: true })
  })
})
