import { generateKeyPairSync, sign } from 'node:crypto'
import type { Db } from '../../src/main/db/db'
import { setSetting } from '../../src/main/db/repo'

export const testKeys = (): { pub: string; priv: ReturnType<typeof generateKeyPairSync>['privateKey'] } => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }) as string, priv: privateKey }
}

export const mkKey = (priv: ReturnType<typeof testKeys>['priv'], over: Record<string, unknown> = {}): string => {
  const body = Buffer.from(JSON.stringify({ v: 1, id: 'abcd1234', name: 'Иван', iat: 0, exp: null, ...over })).toString('base64url')
  return `LEADLY-${body}.${sign(null, Buffer.from(body), priv).toString('base64url')}`
}

/** Выдаёт БД валидную лицензию тестового ключа; возвращает публичный ключ для IpcDeps.licensePublicKey. */
export const licensed = (db: Db): string => {
  const { pub, priv } = testKeys()
  setSetting(db, 'license', mkKey(priv))
  return pub
}
