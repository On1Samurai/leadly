import { describe, expect, it } from 'vitest'
import { addItem, canPublish, ctaValid, movePhoto, removeItem, removePhoto, setItem, toggleReview } from '../src/shared/demo/edit'
import type { DemoContent, DemoView, SetupState } from '../src/shared/demo/types'

const content = (): DemoContent => ({
  name: 'Кофейня', demoKind: 'food', lang: 'ru', headline: 'h', subhead: 's', about: 'a', rating: 4.5, reviewsCount: 10,
  hours: ['Пн 9–18'], items: [{ name: 'Латте', price: '200' }, { name: 'Капучино', price: '180' }],
  reviews: [{ author: 'Аня', text: 'Вкусно', rating: 5, on: true }, { author: 'Боря', text: 'Ок', rating: 4, on: false }],
  photos: [
    { file: 'img/1.jpg', author: 'A', source: 'google' },
    { file: 'img/2.jpg', author: 'B', source: 'google' },
    { file: 'img/3.jpg', author: null, source: 'user' }
  ],
  address: null, mapsUrl: null, phone: null, cta: { kind: 'call', target: '+7' }, showBadge: true, fromGoogle: true
})

/** Вызывает f на глубоко замороженной копии: мутация входа бросит TypeError. */
const frozen = (f: (c: DemoContent) => DemoContent): { before: DemoContent; after: DemoContent } => {
  const c = content()
  const deep = <T>(o: T): T => { Object.values(o as object).forEach((v) => { if (v && typeof v === 'object') deep(v) }); return Object.freeze(o) }
  return { before: content(), after: f(deep(c)) }
}

describe('edit.ts: не мутирует вход', () => {
  it('setItem', () => {
    const { after } = frozen((c) => setItem(c, 1, { price: '190' }))
    expect(after.items).toEqual([{ name: 'Латте', price: '200' }, { name: 'Капучино', price: '190' }])
  })
  it('addItem', () => {
    const { before, after } = frozen(addItem)
    expect(after.items).toEqual([...before.items, { name: '', price: '' }])
  })
  it('removeItem', () => {
    const { after } = frozen((c) => removeItem(c, 0))
    expect(after.items).toEqual([{ name: 'Капучино', price: '180' }])
  })
  it('toggleReview', () => {
    const { after } = frozen((c) => toggleReview(c, 1))
    expect(after.reviews.map((r) => r.on)).toEqual([true, true])
  })
  it('movePhoto(c, 2, 0) ставит третье фото первым', () => {
    const { after } = frozen((c) => movePhoto(c, 2, 0))
    expect(after.photos.map((p) => p.file)).toEqual(['img/3.jpg', 'img/1.jpg', 'img/2.jpg'])
  })
  it('movePhoto вниз и за границы', () => {
    expect(movePhoto(content(), 0, 1).photos.map((p) => p.file)).toEqual(['img/2.jpg', 'img/1.jpg', 'img/3.jpg'])
    expect(movePhoto(content(), 0, -1).photos.map((p) => p.file)).toEqual(['img/1.jpg', 'img/2.jpg', 'img/3.jpg'])
    expect(movePhoto(content(), 2, 3).photos.map((p) => p.file)).toEqual(['img/1.jpg', 'img/2.jpg', 'img/3.jpg'])
  })
  it('removePhoto', () => {
    const { after } = frozen((c) => removePhoto(c, 1))
    expect(after.photos.map((p) => p.file)).toEqual(['img/1.jpg', 'img/3.jpg'])
  })
})

describe('canPublish', () => {
  const view = (o: Partial<DemoView> = {}): DemoView => ({
    placeId: 1, slug: 'kofeynya', kind: 'template', source: 'free', content: content(), status: 'draft', url: null,
    publishedAt: null, error: null, counts: { open: 0, qr: 0, want: 0 }, importBadge: false, ...o
  })
  const ready: SetupState = { github: { ok: true }, worker: { ok: true } }

  it('не настроены GitHub или Worker', () => {
    expect(canPublish(view(), { github: { ok: false }, worker: { ok: true } }, 'nick')).toEqual({ ok: false, why: 'Настройте GitHub и Worker в настройках' })
    expect(canPublish(view(), { github: { ok: true }, worker: { ok: false } }, 'nick')).toEqual({ ok: false, why: 'Настройте GitHub и Worker в настройках' })
  })
  it('нет ника Telegram', () => {
    expect(canPublish(view(), ready, '  ')).toEqual({ ok: false, why: 'Укажите ник Telegram' })
  })
  it('шаблон без содержимого', () => {
    expect(canPublish(view({ content: null }), ready, 'nick')).toEqual({ ok: false, why: 'Сначала соберите демо' })
  })
  it('ok; импорт без content тоже ok', () => {
    expect(canPublish(view(), ready, 'nick')).toEqual({ ok: true })
    expect(canPublish(view({ kind: 'import', content: null }), ready, 'nick')).toEqual({ ok: true })
  })
})

describe('ctaValid', () => {
  const withTarget = (target: string): DemoContent => ({ ...content(), cta: { kind: 'call', target } })
  it('пусто, https:// и tel: — верно', () => {
    expect(ctaValid(withTarget(''))).toBe(true)
    expect(ctaValid(withTarget('https://maps.example/x'))).toBe(true)
    expect(ctaValid(withTarget('tel:+79990000000'))).toBe(true)
  })
  it('http://, номер без tel: и прочее — неверно', () => {
    expect(ctaValid(withTarget('http://x.ru'))).toBe(false)
    expect(ctaValid(withTarget('+79990000000'))).toBe(false)
    expect(ctaValid(withTarget('javascript:alert(1)'))).toBe(false)
  })
})
