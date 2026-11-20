export const WORKER_VERSION = '3'

export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS targets (slug TEXT PRIMARY KEY, url TEXT NOT NULL, tg TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL);`

const SLUG_RE = /^[a-z0-9-]{3,64}$/
const TG_RE = /^[A-Za-z0-9_]{1,32}$/
const RETENTION_MS = 90 * 86_400_000
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21,
  0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b
])

const page = (status, text) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${text}</title><p style="font:18px sans-serif;text-align:center;margin-top:20vh">${text}</p>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
const gone = () => page(410, 'Демо снято с публикации')
const notFound = () => page(404, 'Не найдено')
const unavailable = () => page(503, 'Демо временно недоступно, попробуйте позже')
const redirect = (url) => new Response(null, { status: 302, headers: { Location: url } })

function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const addEvent = (env, slug, kind) =>
  env.DB.prepare('INSERT INTO events (slug, kind, ts) VALUES (?, ?, ?)').bind(slug, kind, Date.now()).run()
// stats are best-effort: a D1 failure must never break the redirect / pixel (printed QR codes)
const track = (env, ctx, slug, kind) => {
  const p = Promise.resolve().then(() => addEvent(env, slug, kind)).then(() => undefined, () => undefined)
  return ctx && ctx.waitUntil ? ctx.waitUntil(p) : p
}
const getTarget = async (env, slug) => env.DB.prepare('SELECT url, tg FROM targets WHERE slug = ?').bind(slug).first()
const DOWN = Symbol('down')
// D1 read outage: a page instead of a 500 with a stack
const tryTarget = (env, slug) => getTarget(env, slug).catch(() => DOWN)
// https only, and nothing URL parsing would silently strip or encode
function goodUrl(u) {
  if (typeof u !== 'string' || !u.startsWith('https://') || /[\s\u0000-\u001f\u007f]/.test(u)) return false
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

function isMine(referer) {
  try {
    return new URL(referer).searchParams.get('me') === '1'
  } catch {
    return false
  }
}

async function api(request, env, parts, url) {
  const auth = request.headers.get('Authorization') || ''
  if (!env.SECRET || !safeEqual(auth, `Bearer ${env.SECRET}`)) return new Response('unauthorized', { status: 401 })

  if (parts[1] === 'events' && parts.length === 2 && request.method === 'GET') {
    const raw = url.searchParams.get('since') ?? ''
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return new Response('bad since', { status: 400 })
    await env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(Date.now() - RETENTION_MS).run()
    const { results } = await env.DB.prepare('SELECT id, slug, kind, ts FROM events WHERE id > ? ORDER BY id ASC LIMIT 500')
      .bind(Number(raw))
      .all()
    return Response.json({ events: results })
  }

  if (parts[1] === 'targets' && parts.length === 3 && SLUG_RE.test(parts[2])) {
    const slug = parts[2]
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM targets WHERE slug = ?').bind(slug).run()
      return new Response(null, { status: 204 })
    }
    if (request.method === 'PUT') {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('bad json', { status: 400 })
      }
      const u = body && body.url
      const tg = body && body.tg
      if (!goodUrl(u) || typeof tg !== 'string' || !TG_RE.test(tg))
        return new Response('bad body', { status: 400 })
      await env.DB.prepare('INSERT INTO targets (slug, url, tg) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET url = excluded.url, tg = excluded.tg')
        .bind(slug, u, tg)
        .run()
      return new Response(null, { status: 204 })
    }
  }
  return notFound()
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const parts = url.pathname.replace(/\/$/, '').split('/').slice(1)
    const [first, second] = parts

    if (first === 'api') {
      // only /api/targets/<slug> takes PUT/DELETE, only /api/events takes GET: others fall to 404 inside
      return api(request, env, parts, url)
    }
    if (request.method !== 'GET') return notFound()

    if (first === 'health' && parts.length === 1) return new Response(`ok ${WORKER_VERSION}`)

    if (first === 'o' && parts.length === 2 && SLUG_RE.test(second)) {
      const t = isMine(request.headers.get('Referer') || '') ? null : await tryTarget(env, second)
      if (t && t !== DOWN) await track(env, ctx, second, 'open')
      return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } })
    }

    if (first === 'w' && parts.length === 2 && SLUG_RE.test(second)) {
      const t = await tryTarget(env, second)
      if (t === DOWN) return unavailable()
      if (!t || !t.tg) return gone()
      await track(env, ctx, second, 'want')
      return redirect(`https://t.me/${t.tg}`)
    }

    if (parts.length === 1 && SLUG_RE.test(first)) {
      const t = await tryTarget(env, first)
      if (t === DOWN) return unavailable()
      if (!t) return gone()
      await track(env, ctx, first, 'qr')
      return redirect(t.url)
    }
    return notFound()
  }
}
