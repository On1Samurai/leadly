import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, detectCms, footerYear, hasMenuOrPrices, type AuditInput } from '../src/main/audit/detect'

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures/html', `${n}.html`), 'utf8')
const now = new Date('2026-11-14T12:00:00Z')
const base = (over: Partial<AuditInput> = {}): AuditInput => ({
  finalUrl: 'https://a.by/', contentType: 'text/html', httpsOk: true, cert: { valid: true, validTo: now.getTime() + 200 * 86400000 },
  headers: {}, html: fx('clean'), text: 'Добро пожаловать',
  metrics: { viewport: true, scrollWidth: 390, innerWidth: 390, smallTextShare: 0, loadMs: 1000 },
  brokenLinks: [], checkMenu: false, ...over,
})

describe('detectCms', () => {
  it.each([['tilda', 'Tilda'], ['wix', 'Wix'], ['wordpress', 'WordPress'], ['ucoz', 'uCoz'], ['bitrix', '1С-Битрикс']])('%s', (f, n) => {
    expect(detectCms(fx(f), {})).toBe(n)
  })
  it('clean is null', () => expect(detectCms(fx('clean'), {})).toBeNull())
  it('wix by header', () => expect(detectCms('<html></html>', { 'X-Wix-Request-Id': '1' })).toBe('Wix'))
})

describe('detectCms false positives', () => {
  it('a href alone', () => expect(detectCms('<a href="https://taplink.cc/x">x</a>', {})).toBeNull())
  it('text alone', () => expect(detectCms('<p>Сделано на uKit и Flexbe</p>', {})).toBeNull())
  it('img src', () => expect(detectCms('<img src="https://static.tildacdn.com/x.jpg">', {})).toBe('Tilda'))
  it('generator', () => expect(detectCms('<meta content="WordPress 6" name="generator">', {})).toBe('WordPress'))
})

describe('footerYear', () => {
  it('range', () => expect(footerYear('© 2015–2019 Ромашка')).toBe(2019))
  it('copy entity', () => expect(footerYear('&copy; 2017')).toBe(2017))
  it('no marker', () => expect(footerYear('Основано в 2010')).toBeNull())
})

describe('hasMenuOrPrices', () => {
  it.each(['Стоимость услуг', '500 р', '500 р.', '12 $'])('%s', (s) => expect(hasMenuOrPrices(s)).toBe(true))
  it('menu fixture', () => expect(hasMenuOrPrices(fx('menu'))).toBe(true))
  it('BYN', () => expect(hasMenuOrPrices('Цены: 12 BYN')).toBe(true))
  it('none', () => expect(hasMenuOrPrices('Добро пожаловать')).toBe(false))
})

describe('detect', () => {
  const codes = (i: AuditInput) => detect(i, now).map((f) => f.code)
  it('old footer', () => {
    const f = detect(base({ text: fx('old-footer') }), now).find((x) => x.code === 'old_footer_year')
    expect(f?.evidence).toBe('© 2017')
    expect(codes(base({ text: '© 2024' }))).not.toContain('old_footer_year')
  })
  it('constructor cms confirmed, wordpress not', () => {
    expect(detect(base({ html: fx('tilda') }), now).find((x) => x.code === 'cms')).toMatchObject({ confirmed: true, evidence: 'Tilda' })
    expect(detect(base({ html: fx('wordpress') }), now).find((x) => x.code === 'cms')).toMatchObject({ confirmed: false, evidence: 'WordPress' })
  })
  it('metrics thresholds', () => {
    const m = { viewport: false, scrollWidth: 420, innerWidth: 390, smallTextShare: 0.31, loadMs: 6200 }
    const r = detect(base({ metrics: m, brokenLinks: ['x', 'y'] }), now)
    const ev = (c: string) => r.find((f) => f.code === c)?.evidence
    expect(ev('h_scroll')).toBe('на телефоне страница шире экрана')
    expect(ev('slow_load')).toBe('загрузка 6.2 с')
    expect(ev('small_text')).toBe('мелкий текст на телефоне')
    expect(ev('no_viewport')).toBe('нет мобильной версии (meta viewport)')
    expect(ev('broken_links')).toBe('битых ссылок: 2')
  })
  it('no_menu_prices', () => {
    expect(detect(base({ checkMenu: true, text: 'а'.repeat(250) }), now).find((f) => f.code === 'no_menu_prices')?.evidence).toBe('нет меню и цен')
  })
  it('no_menu_prices needs enough text', () => {
    expect(codes(base({ checkMenu: true, text: '' }))).not.toContain('no_menu_prices')
    expect(codes(base({ checkMenu: true, text: 'а'.repeat(199) }))).not.toContain('no_menu_prices')
    expect(codes(base({ checkMenu: true, text: 'а'.repeat(200) }))).toContain('no_menu_prices')
  })
  it('cert days floor', () => {
    const r = detect(base({ cert: { valid: true, validTo: now.getTime() + 13.9 * 86400000 } }), now)
    expect(r.find((f) => f.code === 'cert_expiring')?.evidence).toBe('сертификат истекает через 13 дн.')
  })
  it('pdf gives only site-level', () => {
    expect(codes(base({ contentType: 'application/pdf', httpsOk: false }))).toEqual(['no_https'])
  })
  it('cert expiring in 10 days', () => {
    const r = detect(base({ cert: { valid: true, validTo: now.getTime() + 10 * 86400000 } }), now)
    expect(r.find((f) => f.code === 'cert_expiring')?.evidence).toBe('сертификат истекает через 10 дн.')
  })
  it('cert invalid', () => {
    expect(detect(base({ cert: { valid: false, validTo: 0 } }), now).map((f) => f.code)).toEqual(['cert_invalid'])
  })
  it('clean has no findings', () => expect(codes(base())).toEqual([]))
})
