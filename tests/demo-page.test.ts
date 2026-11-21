import { describe, expect, it } from 'vitest'
import { renderDemoHtml, defaultCta, demoFiles } from '../src/main/demo/build'
import { labels } from '../src/shared/demo/labels'
import type { DemoContent, DemoLinks } from '../src/shared/demo/types'

const links: DemoLinks = { pixel: 'https://w.example/o/s-1', want: 'https://w.example/w/s-1', tg: 'my_nick' }
const content = (o: Partial<DemoContent> = {}): DemoContent => ({
  name: 'Кафе Ромашка', demoKind: 'food', lang: 'ru', headline: 'Уютное кафе', subhead: 'Рядом с вами', about: 'Мы любим гостей',
  rating: 4.7, reviewsCount: 120, hours: ['Пн-Вс 9:00-21:00'],
  items: [{ name: 'Капучино', price: '200' }],
  reviews: [
    { author: 'Аня', text: 'Отличный кофе', rating: 5, on: true },
    { author: 'Боб', text: 'СЕКРЕТНЫЙ выключенный', rating: 3, on: false }
  ],
  photos: [{ file: 'img/1.jpg', author: 'Иван Фотограф', source: 'google' }],
  address: 'ул. Ленина 1', mapsUrl: 'https://maps.example/x', phone: '+79990000000',
  cta: { kind: 'call', target: 'tel:+79990000000' }, showBadge: true, fromGoogle: true, ...o
})

describe('renderDemoHtml', () => {
  it('has noindex and pixel', () => {
    const h = renderDemoHtml(content(), links)
    expect(h.startsWith('<!doctype html>')).toBe(true)
    expect(h).toContain('noindex,nofollow')
    expect(h).toContain('src="https://w.example/o/s-1"')
    expect(h).toContain('referrerpolicy="unsafe-url"')
  })
  it('no script', () => expect(renderDemoHtml(content(), links)).not.toContain('<script'))
  it('pixel loaded once (no preload hoist)', () => {
    const h = renderDemoHtml(content(), links)
    expect(h).not.toContain('preload')
    expect(h.split('w.example/o/s-1').length - 1).toBe(1)
    expect(h.match(/<img[^>]*w\.example\/o\/s-1[^>]*>/)![0]).not.toContain('lazy')
  })
  it('escapes name', () => {
    const h = renderDemoHtml(content({ name: 'Кафе "Ромашка" <b>' }), links)
    expect(h).toContain('&lt;b&gt;')
    expect(h).not.toContain('<b>')
  })
  it('hides empty blocks', () => {
    expect(renderDemoHtml(content({ items: [] }), links)).not.toContain(labels.ru.menu)
    expect(renderDemoHtml(content(), links)).toContain(labels.ru.menu)
  })
  it('only enabled reviews', () => {
    const h = renderDemoHtml(content(), links)
    expect(h).toContain('Отличный кофе')
    expect(h).not.toContain('СЕКРЕТНЫЙ')
  })
  it('google attribution', () => {
    const h = renderDemoHtml(content(), links)
    expect(h).toContain(labels.ru.fromGoogle)
    expect(h).toContain('Иван Фотограф')
    expect(renderDemoHtml(content({ fromGoogle: false }), links)).not.toContain(labels.ru.fromGoogle)
  })
  it('badge', () => {
    const h = renderDemoHtml(content(), links)
    expect(h).toContain('@my_nick')
    expect(h).toContain('href="https://w.example/w/s-1"')
    expect(renderDemoHtml(content({ showBadge: false }), links)).not.toContain('@my_nick')
  })
  it('want button stays without badge', () => {
    const h = renderDemoHtml(content({ showBadge: false }), links)
    expect(h).toContain(labels.ru.want)
    expect(h).not.toContain('@my_nick')
  })
  it('preview', () => {
    const h = renderDemoHtml(content(), null)
    expect(h).not.toContain('w.example')
    expect(h).not.toContain('<img src="https')
    expect(h).toContain('@ваш_ник')
  })
  it('uk labels', () => expect(renderDemoHtml(content({ lang: 'uk' }), links)).toContain(labels.uk.hours))
})

describe('defaultCta / demoFiles', () => {
  it('cta by kind', () => {
    const p = { phone: '+7999', mapsUrl: 'https://m' }
    expect(defaultCta('food', p)).toEqual({ kind: 'route', target: 'https://m' })
    expect(defaultCta('beauty', p)).toEqual({ kind: 'book', target: 'tel:+7999' })
    expect(defaultCta('auto', p).kind).toBe('call')
    expect(defaultCta('default', { phone: null, mapsUrl: null })).toEqual({ kind: 'call', target: '' })
  })
  it('files', () => {
    const f = demoFiles(content(), links, () => Buffer.from('x'))
    expect(f.map((x) => x.path)).toEqual(['index.html', 'img/1.jpg'])
  })
})
