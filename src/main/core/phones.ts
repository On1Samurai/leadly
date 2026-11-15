import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'
import type { PhoneType } from '../../shared/types'

export function splitPhones(raw: string): string[] {
  return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
}

export function parsePhone(raw: string, country: string): { e164: string; type: PhoneType } | null {
  const p = parsePhoneNumberFromString(raw, country as CountryCode)
  if (!p || !p.isValid()) return null
  const t = p.getType()
  const type: PhoneType = t === 'MOBILE' ? 'mobile' : t === 'FIXED_LINE' ? 'fixed' : 'unknown'
  return { e164: p.number, type }
}
