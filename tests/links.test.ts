import { describe, expect, it } from 'vitest'
import { buildLink, channelsFor } from '../src/main/core/links'

const P = '+375291234567'

describe('buildLink', () => {
  it('whatsapp encodes text', () => {
    const text = 'Привет & 100% 🙂'
    const r = buildLink('whatsapp', { phoneE164: P }, text)!
    expect(r.prefilled).toBe(true)
    const prefix = 'https://wa.me/375291234567?text='
    expect(r.url.startsWith(prefix)).toBe(true)
    expect(decodeURIComponent(r.url.slice(prefix.length))).toBe(text)
  })
  it('telegram', () => {
    expect(buildLink('telegram', { handle: 'romashka' }, 'x')).toEqual({ url: 'https://t.me/romashka', prefilled: false })
    expect(buildLink('telegram', { phoneE164: P }, 'x')).toEqual({ url: 'https://t.me/+375291234567', prefilled: false })
  })
  it('others', () => {
    expect(buildLink('viber', { phoneE164: P }, 'x')).toEqual({ url: 'viber://chat?number=%2B375291234567', prefilled: false })
    expect(buildLink('instagram', { handle: 'r' }, 'x')).toEqual({ url: 'https://ig.me/m/r', prefilled: false })
    expect(buildLink('vk', { handle: 'r' }, 'x')).toEqual({ url: 'https://vk.me/r', prefilled: false })
    expect(buildLink('call', { phoneE164: P }, 'x')).toEqual({ url: 'tel:+375291234567', prefilled: false })
    expect(buildLink('sms', { phoneE164: P }, 'a b')).toEqual({ url: 'sms:+375291234567?body=a%20b', prefilled: true })
    expect(buildLink('max', { handle: 'r' }, 'x')).toBeNull()
  })
  it('null when contact missing', () => {
    expect(buildLink('whatsapp', {}, 'x')).toBeNull()
    expect(buildLink('instagram', { phoneE164: P }, 'x')).toBeNull()
    expect(buildLink('telegram', {}, 'x')).toBeNull()
  })
})

describe('channelsFor', () => {
  const all = [
    { kind: 'instagram' as const, value: 'a' }, { kind: 'vk' as const, value: 'a' },
    { kind: 'max' as const, value: 'a' }, { kind: 'telegram' as const, value: 'a' }
  ]
  it('RU order', () => {
    expect(channelsFor('RU', all, '+79161234567', 'mobile')).toEqual(['telegram', 'vk', 'max', 'whatsapp', 'call', 'sms'])
  })
  it('BY order', () => {
    expect(channelsFor('BY', all, P, 'mobile')).toEqual(['telegram', 'viber', 'whatsapp', 'instagram', 'call'])
  })
  it('UA order, no sms', () => {
    expect(channelsFor('UA', [], '+380671234567', 'mobile')).toEqual(['telegram', 'viber', 'whatsapp', 'call'])
  })
  it('no mobile: no whatsapp/viber', () => {
    expect(channelsFor('BY', [], '+375172223344', 'fixed')).toEqual(['call'])
    expect(channelsFor('BY', [{ kind: 'telegram', value: 'a' }], null, 'unknown')).toEqual(['telegram'])
  })
})
