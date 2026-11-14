import { describe, expect, it } from 'vitest'
import { classifyWeb } from '../src/main/core/webclass'
import { contactFromUrl } from '../src/main/core/links'
import { parsePhone, splitPhones } from '../src/main/core/phones'

describe('parsePhone', () => {
  it('BY mobile', () => {
    expect(parsePhone('8 (029) 123-45-67', 'BY')).toEqual({ e164: '+375291234567', type: 'mobile' })
  })
  it('BY fixed', () => {
    expect(parsePhone('+375 17 222-33-44', 'BY')?.type).toBe('fixed')
  })
  it('RU', () => {
    expect(parsePhone('8 (495) 123-45-67', 'RU')).toEqual({ e164: '+74951234567', type: 'fixed' })
    expect(parsePhone('+7 916 123-45-67', 'RU')?.type).toBe('mobile')
  })
  it('UA', () => {
    expect(parsePhone('067 123 4567', 'UA')).toEqual({ e164: '+380671234567', type: 'mobile' })
    expect(parsePhone('044 123 4567', 'UA')?.type).toBe('fixed')
  })
  it('garbage', () => {
    expect(parsePhone('abc', 'BY')).toBeNull()
  })
})

describe('splitPhones', () => {
  it('splits by ; and ,', () => {
    expect(splitPhones('+375 29 1234567; +375 17 2223344')).toHaveLength(2)
    expect(splitPhones('1,2;3')).toEqual(['1', '2', '3'])
  })
})

describe('classifyWeb', () => {
  it('classes', () => {
    expect(classifyWeb(undefined)).toBe('none')
    expect(classifyWeb('https://instagram.com/x')).toBe('social')
    expect(classifyWeb('taplink.cc/x')).toBe('social')
    expect(classifyWeb('https://the-doors.choiceqr.com')).toBe('template')
    expect(classifyWeb('https://romashka.by')).toBe('own')
    expect(classifyWeb('www.vk.com/club1')).toBe('social')
    expect(classifyWeb('https://my-qr-menu.site')).toBe('template')
    expect(classifyWeb('https://notinstagram.com')).toBe('own')
    expect(classifyWeb('')).toBe('none')
  })
})

describe('contactFromUrl', () => {
  it('profiles', () => {
    expect(contactFromUrl('https://www.instagram.com/romashka/')).toEqual({ kind: 'instagram', value: 'romashka' })
    expect(contactFromUrl('https://t.me/romashka_bot')).toEqual({ kind: 'telegram', value: 'romashka_bot' })
    expect(contactFromUrl('https://vk.com/club1?x=1')).toEqual({ kind: 'vk', value: 'club1' })
    expect(contactFromUrl('https://wa.me/375291234567')).toEqual({ kind: 'whatsapp', value: '+375291234567' })
  })
  it('ignores non-profiles', () => {
    expect(contactFromUrl('https://instagram.com/p/abc')).toBeNull()
    expect(contactFromUrl('https://instagram.com/explore')).toBeNull()
    expect(contactFromUrl('https://t.me/joinchat/AAA')).toBeNull()
    expect(contactFromUrl('https://t.me/+AbCdEf')).toBeNull()
    expect(contactFromUrl('https://example.com/x')).toBeNull()
  })
})

describe('contactFromUrl handle safety', () => {
  it('rejects invalid handles and malformed encoding', () => {
    for (const bad of ['foo%3Fx', 'a%2Fb', 'a%23b', 'a%20b', '%20']) {
      expect(contactFromUrl(`https://instagram.com/${bad}`)).toBeNull()
      expect(contactFromUrl(`https://t.me/${bad}`)).toBeNull()
      expect(contactFromUrl(`https://vk.com/${bad}`)).toBeNull()
    }
    expect(() => contactFromUrl('https://instagram.com/%zz')).not.toThrow()
    expect(contactFromUrl('https://instagram.com/%zz')).toBeNull()
    expect(contactFromUrl('https://instagram.com/a.b_c')).toEqual({ kind: 'instagram', value: 'a.b_c' })
  })
})
