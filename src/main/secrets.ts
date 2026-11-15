import type { SecretName } from '../shared/ipc'
import type { Db } from './db/db'

export type { SecretName }

/** Подмножество Electron safeStorage; в тестах подставляется поддельный. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}
export interface SecretEnv { safeStorage: SafeStorageLike; isDev: boolean; env: Record<string, string | undefined> }

export const SECRET_NAMES: readonly SecretName[] = ['llm', 'anthropic', 'google', 'telegram']
const DEV_VARS: Record<SecretName, string> = {
  llm: 'LLM_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', telegram: 'TELEGRAM_BOT_TOKEN'
}
const key = (n: SecretName): string => `secret:${n}`

/** Шифрует через safeStorage и кладёт base64 в settings. Пустая строка удаляет ключ. Без шифрования — отказ, не plaintext. */
export function setSecret(db: Db, name: SecretName, value: string, e: SecretEnv): void {
  if (value === '') {
    db.prepare('DELETE FROM settings WHERE key=?').run(key(name))
    return
  }
  if (!e.safeStorage.isEncryptionAvailable()) throw new Error('encryption_unavailable')
  const b64 = e.safeStorage.encryptString(value).toString('base64')
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key(name), JSON.stringify(b64))
}

/** Только для main-процесса. В renderer значение не уходит никогда. */
export function getSecret(db: Db, name: SecretName, e: SecretEnv): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key(name)) as { value: string } | undefined
  if (r) {
    try {
      if (e.safeStorage.isEncryptionAvailable()) {
        const v = e.safeStorage.decryptString(Buffer.from(JSON.parse(r.value) as string, 'base64'))
        if (v) return v
      }
    } catch { /* повреждённое значение: как будто ключа нет */ }
  }
  if (e.isDev) return e.env[DEV_VARS[name]] || null
  return null
}

export function hasSecret(db: Db, name: SecretName, e: SecretEnv): boolean {
  return getSecret(db, name, e) !== null
}
