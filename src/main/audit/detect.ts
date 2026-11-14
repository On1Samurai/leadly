import type { Finding } from '../../shared/types'
import signatures from '../../../resources/data/cms-signatures.json'

export interface AuditInput {
  finalUrl: string; contentType: string; httpsOk: boolean;
  cert: { valid: boolean; validTo: number } | null;
  headers: Record<string, string>; html: string; text: string;
  metrics: { viewport: boolean; scrollWidth: number; innerWidth: number; smallTextShare: number; loadMs: number } | null;
  brokenLinks: string[];
  checkMenu: boolean;
}

interface Signature { name: string; html?: string[]; generator?: string[]; headers?: { name: string; re: string }[] }

const CONSTRUCTORS = new Set(['Tilda', 'Wix', 'uCoz', 'Nethouse', 'Craftum', 'uKit', 'Flexbe', 'Taplink'])
const DAY = 86400000

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

// Only resource URLs (script/link/img/iframe), meta generator and headers are evidence; never <a> or visible text.
export function detectCms(html: string, headers: Record<string, string>): string | null {
  const h: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v
  const urls: string[] = []
  for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*>/gi)) {
    for (const n of ['src', 'href']) { const v = attr(m[0], n); if (v) urls.push(v) }
  }
  const gens: string[] = []
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(m[0], 'name')?.toLowerCase() === 'generator') { const c = attr(m[0], 'content'); if (c) gens.push(c.trim()) }
  }
  const resources = urls.join('\n')
  for (const s of signatures as Signature[]) {
    if (s.html?.some((re) => new RegExp(re, 'i').test(resources))) return s.name
    if (s.generator?.some((re) => gens.some((g) => new RegExp(re, 'i').test(g)))) return s.name
    if (s.headers?.some((x) => x.name.toLowerCase() in h && new RegExp(x.re, 'i').test(h[x.name.toLowerCase()]))) return s.name
  }
  return null
}

export function footerYear(text: string, now: Date = new Date()): number | null {
  const max = now.getFullYear() + 1
  let best: number | null = null
  const marker = /(?:©|&copy;|&#169;|\(c\))/gi
  let m: RegExpExecArray | null
  while ((m = marker.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40)
    const seg = /^[\s\d\-–—−,.]*/.exec(tail)![0]
    for (const y of seg.match(/(?<!\d)\d{4}(?!\d)/g) ?? []) {
      const n = Number(y)
      if (n >= 1995 && n <= max && (best === null || n > best)) best = n
    }
  }
  return best
}

const KEYWORDS = /меню|прайс|цен(?!т)|стоимост|тариф|каталог|ассортимент|услуг|menu|price/i
const CURRENCY = /\d\s{0,3}(?:₽|руб|р(?![\p{L}\d])|BYN|бел\.\s?руб|грн|₴|UAH|RUB|\$|€|USD|EUR)/iu

export function hasMenuOrPrices(text: string): boolean {
  return KEYWORDS.test(text) || CURRENCY.test(text)
}

export function detect(input: AuditInput, now: Date): Finding[] {
  const out: Finding[] = []
  const add = (code: Finding['code'], evidence: string, confirmed = true) => out.push({ code, confirmed, evidence })

  if (!input.httpsOk) add('no_https', 'сайт открывается без HTTPS')
  if (input.cert) {
    if (!input.cert.valid) add('cert_invalid', 'сертификат недействителен')
    else {
      const left = input.cert.validTo - now.getTime()
      if (left < 14 * DAY) add('cert_expiring', `сертификат истекает через ${Math.max(0, Math.floor(left / DAY))} дн.`)
    }
  }
  const isHtml = input.contentType.toLowerCase().includes('text/html')
  if (!isHtml || input.metrics === null) return out

  const cms = detectCms(input.html, input.headers)
  if (cms) add('cms', cms, CONSTRUCTORS.has(cms))
  const m = input.metrics
  if (!m.viewport) add('no_viewport', 'нет мобильной версии (meta viewport)')
  if (m.scrollWidth > m.innerWidth + 2) add('h_scroll', 'на телефоне страница шире экрана')
  if (m.smallTextShare > 0.3) add('small_text', 'мелкий текст на телефоне')
  const year = footerYear(input.text, now)
  if (year !== null && year <= now.getFullYear() - 3) add('old_footer_year', `© ${year}`)
  if (m.loadMs > 5000) add('slow_load', `загрузка ${(m.loadMs / 1000).toFixed(1)} с`)
  if (input.brokenLinks.length > 0) add('broken_links', `битых ссылок: ${input.brokenLinks.length}`)
  if (input.checkMenu && input.text.trim().length >= 200 && !hasMenuOrPrices(input.text)) add('no_menu_prices', 'нет меню и цен')
  return out
}
