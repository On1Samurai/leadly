import type { Channel, Contact, PhoneType } from '../../shared/types'
import { hostOf } from './webclass'

const IG_SKIP = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct'])
const VK_SKIP = new Set(['share.php', 'away.php', 'feed', 'login', 'wall'])

export function isValidHandle(h: string): boolean {
  return /^[A-Za-z0-9_.]{1,64}$/.test(h)
}

export function contactFromUrl(url: string): Contact | null {
  const host = hostOf(url)
  if (!host) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`)
  } catch {
    return null
  }
  const seg = u.pathname.split('/').filter(Boolean)
  let first = ''
  try {
    first = seg[0] ? decodeURIComponent(seg[0]).replace(/^@/, '') : ''
  } catch {
    return null
  }
  if (host === 'instagram.com' || host === 'instagr.am') {
    if (!isValidHandle(first) || IG_SKIP.has(first.toLowerCase())) return null
    return { kind: 'instagram', value: first }
  }
  if (host === 't.me' || host === 'telegram.me') {
    if (!isValidHandle(first) || ['joinchat', 'share', 'addstickers', 's'].includes(first)) return null
    return { kind: 'telegram', value: first }
  }
  if (host === 'vk.com' || host === 'vk.ru' || host === 'm.vk.com') {
    if (!isValidHandle(first) || VK_SKIP.has(first)) return null
    return { kind: 'vk', value: first }
  }
  if (host === 'wa.me') {
    const d = first.replace(/\D/g, '')
    return d ? { kind: 'whatsapp', value: `+${d}` } : null
  }
  if (host === 'api.whatsapp.com') {
    const d = (u.searchParams.get('phone') ?? '').replace(/\D/g, '')
    return d ? { kind: 'whatsapp', value: `+${d}` } : null
  }
  return null
}

const ORDER: Record<string, Channel[]> = {
  RU: ['telegram', 'vk', 'max', 'whatsapp', 'call', 'sms'],
  BY: ['telegram', 'viber', 'whatsapp', 'instagram', 'call'],
  UA: ['telegram', 'viber', 'whatsapp', 'instagram', 'call']
}

export function channelsFor(
  country: string, contacts: Contact[], phoneE164: string | null, phoneType: PhoneType
): Channel[] {
  const has = (k: Channel): boolean => contacts.some((c) => c.kind === k && c.value)
  const mobile = !!phoneE164 && phoneType === 'mobile'
  const ok = (ch: Channel): boolean => {
    switch (ch) {
      case 'telegram': return has('telegram') || mobile
      case 'whatsapp': case 'viber': case 'sms': return mobile
      case 'call': return !!phoneE164
      default: return has(ch)
    }
  }
  return (ORDER[country] ?? ORDER.BY).filter(ok)
}

export function buildLink(
  ch: Channel, to: { phoneE164?: string; handle?: string }, text: string
): { url: string; prefilled: boolean } | null {
  const phone = to.phoneE164
  const digits = phone?.replace(/\D/g, '')
  const handle = to.handle?.replace(/^@/, '')
  const badHandle = handle !== undefined && handle !== '' && !isValidHandle(handle)
  const enc = encodeURIComponent
  switch (ch) {
    case 'telegram':
      if (badHandle) return null
      if (handle) return { url: `https://t.me/${handle}`, prefilled: false }
      return digits ? { url: `https://t.me/+${digits}`, prefilled: false } : null
    case 'whatsapp':
      return digits ? { url: `https://wa.me/${digits}?text=${enc(text)}`, prefilled: true } : null
    case 'viber':
      return digits ? { url: `viber://chat?number=%2B${digits}`, prefilled: false } : null
    case 'instagram':
      return handle && !badHandle ? { url: `https://ig.me/m/${handle}`, prefilled: false } : null
    case 'vk':
      return handle && !badHandle ? { url: `https://vk.me/${handle}`, prefilled: false } : null
    case 'call':
      return digits ? { url: `tel:+${digits}`, prefilled: false } : null
    case 'sms':
      return digits ? { url: `sms:+${digits}?body=${enc(text)}`, prefilled: true } : null
    default:
      return null // max: рабочий deep link не подтверждён
  }
}
