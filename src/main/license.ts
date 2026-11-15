import { createPublicKey, verify } from 'node:crypto'
import type { LicenseState } from '../shared/ipc'
import type { Db } from './db/db'
import { getSetting, setSetting } from './db/repo'

// публичный ключ (SPKI DER, base64); приватный лежит вне репозитория, см. scripts/license.mjs
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEA4wUINP1sLxseFYZ+jUyVhJhjZqwv/NGR1JxqoYR0e5I='
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY_B64}\n-----END PUBLIC KEY-----\n`

export interface LicensePayload { v: 1; id: string; name: string; iat: number; exp: number | null }
export type LicenseReason = 'format' | 'signature' | 'expired'
export type LicenseCheck = { ok: true; payload: LicensePayload } | { ok: false; reason: LicenseReason }
export type { LicenseState }

const SETTING = 'license'

export function verifyLicense(key: string, now: number, publicKeyPem: string = PUBLIC_KEY_PEM): LicenseCheck {
  const m = /^LEADLY-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.replace(/\s+/g, ''))
  if (!m) return { ok: false, reason: 'format' }
  const [, body, sig] = m
  let payload: LicensePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload
  } catch { return { ok: false, reason: 'format' } }
  if (payload?.v !== 1 || typeof payload.name !== 'string' || typeof payload.id !== 'string'
    || typeof payload.iat !== 'number' || (payload.exp !== null && typeof payload.exp !== 'number')) return { ok: false, reason: 'format' }
  let good = false
  try { good = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url')) } catch { /* плохой ключ = не подходит */ }
  if (!good) return { ok: false, reason: 'signature' }
  if (payload.exp !== null && payload.exp <= now) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}

export function licenseState(db: Db, now: number, publicKeyPem?: string): LicenseState {
  const key = getSetting<string | null>(db, SETTING, null)
  if (!key) return { valid: false }
  const r = verifyLicense(key, now, publicKeyPem)
  return r.ok ? { valid: true, name: r.payload.name, exp: r.payload.exp } : { valid: false, reason: r.reason }
}

/** Сохраняет ключ, только если он валиден; иначе Error('license_invalid:<reason>'). */
export function setLicense(db: Db, key: string, now: number, publicKeyPem?: string): LicenseState {
  const r = verifyLicense(key, now, publicKeyPem)
  if (!r.ok) throw new Error(`license_invalid:${r.reason}`)
  setSetting(db, SETTING, key.replace(/\s+/g, ''))
  return licenseState(db, now, publicKeyPem)
}

export function requireLicense(db: Db, now: number, publicKeyPem?: string): void {
  if (!licenseState(db, now, publicKeyPem).valid) throw new Error('license_required')
}
