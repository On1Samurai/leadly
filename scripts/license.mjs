// Выпуск ключа: node scripts/license.mjs --name "Иван" [--days 30] [--key /path/private.pem]
import { createPrivateKey, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const name = opt('name')
const days = opt('days')
if (!name || (days !== undefined && !(Number(days) > 0))) {
  console.error('usage: node scripts/license.mjs --name "Иван" [--days 30] [--key /path/private.pem]')
  process.exit(1)
}
const keyPath = opt('key') ?? process.env.LEADLY_LICENSE_KEY ?? '/home/vibe/claude-workspace/leadly-license/private.pem'
const now = Date.now()
const payload = { v: 1, id: randomBytes(4).toString('hex'), name, iat: now, exp: days === undefined ? null : now + Number(days) * 86_400_000 }
const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
const sig = sign(null, Buffer.from(body), createPrivateKey(readFileSync(keyPath))).toString('base64url')
console.log(`LEADLY-${body}.${sig}`)
