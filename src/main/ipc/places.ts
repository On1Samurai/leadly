import { requireLicense } from '../license'
import { readFileSync, unlinkSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Channel, Contact, Finding, Place } from '../../shared/types'
import type { PlaceDetails, PlaceView } from '../../shared/ipc'
import type { NextActionInput } from '../../shared/nextAction'
import type { AppSettings, Tone } from '../../shared/settings'
import type { Db } from '../db/db'
import { clearReminder, countPlaces, deletePlaceForever, getPlace, getSetting, listPlaces, setSetting, setStatus, updatePlace } from '../db/repo'
import { localDate } from '../core/daily'
import { mergePatch } from '../core/dedup'
import { channelsFor } from '../core/links'
import { parsePhone } from '../core/phones'
import { scorePlace } from '../core/scoring'
import { classifyWeb } from '../core/webclass'
import { anthropicAsker, buildMessageInput, cacheKey, generateMessage, isTextReady, openaiAsker, type Asker, type MessageInput } from '../llm/message'
import { historyFor, rescore } from '../search/rescore'
import { GoogleClient, Budget } from '../sources/google'
import { getSecret } from '../secrets'
import { loadSettings } from '../settings'
import { PRIORS } from './data'
import { define, type IpcDeps, type Table } from './define'
import type { DemoService } from '../demo/service'

export const latestFindings = (db: Db, placeId: number): Finding[] => {
  const r = db.prepare('SELECT findings FROM audits WHERE place_id=? ORDER BY id DESC LIMIT 1').get(placeId) as { findings: string } | undefined
  return r ? (JSON.parse(r.findings) as Finding[]) : []
}

const cityName = (db: Db, id: number): string =>
  (db.prepare('SELECT name FROM cities WHERE id=?').get(id) as { name: string } | undefined)?.name ?? ''

export function inputFor(db: Db, p: Place, s: AppSettings, tone: Tone = s.tone): MessageInput {
  const sells = [...s.sells, s.custom].map((x) => x.trim()).filter(Boolean).join(', ')
  return buildMessageInput(p, cityName(db, p.cityId), latestFindings(db, p.id), { sells, tone, lang: s.lang, mode: p.category === 'b2b' ? 'b2b' : 'local' })
}

const contactsOf = (db: Db, id: number): Contact[] =>
  db.prepare('SELECT kind, value FROM contacts WHERE place_id=?').all(id) as Contact[]

export const toView = (db: Db, p: Place, s: AppSettings): PlaceView => ({
  ...p,
  textReady: isTextReady(inputFor(db, p, s), db),
  channels: channelsFor(s.country, contactsOf(db, p.id), p.phoneE164, p.phoneType)
})

// лимиты блока «Что дальше»: всего не больше 50 строк
const NEXT_LIMITS = { remind: 10, replied: 15, fresh: 25 }
const NEXT_SELECT = `SELECT p.id, p.name, p.status, p.remind_at AS remindAt, p.score,
  (SELECT MAX(created_at) FROM messages m WHERE m.place_id=p.id AND m.direction='in') AS lastIn,
  (SELECT MAX(created_at) FROM messages m WHERE m.place_id=p.id AND m.direction='out') AS lastOut
  FROM places p WHERE (? IS NULL OR p.city_id=?)`

type NextRow = Omit<NextActionInput, 'textReady'>

function nextCandidates(db: Db, cityId: number | undefined, now: number, s: AppSettings): NextActionInput[] {
  const c = cityId ?? null
  const q = (cond: string, order: string, limit: number, ...extra: unknown[]): NextRow[] =>
    db.prepare(`${NEXT_SELECT} AND ${cond} ORDER BY ${order} LIMIT ?`).all(c, c, ...extra, limit) as NextRow[]
  const rows = [
    ...q(`p.remind_at IS NOT NULL AND p.remind_at<=? AND p.status NOT IN ('deal','refused')`, 'p.remind_at', NEXT_LIMITS.remind, now),
    ...q(`p.status='replied' AND lastIn IS NOT NULL AND lastIn > COALESCE(lastOut,0)`, 'lastIn DESC', NEXT_LIMITS.replied),
    ...q(`p.status='new'`, 'p.in_base DESC, p.score DESC, p.id DESC', NEXT_LIMITS.fresh)
  ]
  const seen = new Set<number>()
  const out = rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => {
    const p = getPlace(db, r.id)
    return { ...r, textReady: p ? isTextReady(inputFor(db, p, s), db) : false }
  })
  // готовый текст вперёд только внутри новых; напоминания и ответившие остаются впереди (sort стабилен)
  const isNew = (x: NextActionInput): boolean => x.status === 'new' && !(x.remindAt !== null && x.remindAt <= now)
  const head = out.filter((x) => !isNew(x))
  const fresh = out.filter(isNew).sort((x, y) => Number(y.textReady) - Number(x.textReady))
  return [...head, ...fresh]
}

/** Пересчёт процента категории в городе места (история ответов могла измениться). */
export function rescorePlace(db: Db, p: Place, now: number): void {
  rescore(db, PRIORS, { categoryId: p.category, cityId: p.cityId }, now)
}

function need(db: Db, id: number): Place {
  const p = getPlace(db, id)
  if (!p) throw new Error('not_found')
  return p
}

/** Платных обновлений из Google в день (на всю программу). */
export const REFRESH_PER_DAY = 20
const TONES: Tone[] = ['business', 'friendly', 'short']

/** Счётчик за локальную дату; true — запрос можно делать (и он уже засчитан). */
function takeRefresh(db: Db, now: number): boolean {
  const date = localDate(now)
  const cur = getSetting<{ date: string; n: number }>(db, 'googleRefresh', { date, n: 0 })
  const n = cur.date === date ? cur.n : 0
  if (n >= REFRESH_PER_DAY) return false
  setSetting(db, 'googleRefresh', { date, n: n + 1 })
  return true
}

/** Клиент ИИ по настройке провайдера; null — ключа нет. */
export function askerFor(d: Pick<IpcDeps, 'db' | 'secretEnv' | 'anthropicFactory'>, s: AppSettings): Asker | null {
  if (s.llmProvider === 'anthropic') {
    const key = getSecret(d.db, 'anthropic', d.secretEnv)
    return key ? anthropicAsker(d.anthropicFactory(key)) : null
  }
  const key = getSecret(d.db, 'llm', d.secretEnv)
  return key ? openaiAsker({ baseUrl: s.llmBaseUrl, apiKey: key, model: s.llmModel }) : null
}

const insideShots = (userDataDir: string, f: string): boolean =>
  resolve(f).startsWith(resolve(userDataDir, 'screenshots') + sep)

export function placesHandlers(t: Table, d: IpcDeps, demo: Pick<DemoService, 'removeForPlace'>): void {
  const { db } = d

  define(t, 'places.list', (_e, f) => {
    const s = loadSettings(db)
    return listPlaces(db, f).map((p) => toView(db, p, s))
  })

  define(t, 'places.counts', (_e, f) => countPlaces(db, f))
  define(t, 'places.nextCandidates', (_e, cityId?: number) => nextCandidates(db, cityId, d.now(), loadSettings(db)))

  define(t, 'places.get', (_e, id): PlaceDetails => {
    const p = need(db, id)
    const s = loadSettings(db)
    const contacts = contactsOf(db, id)
    const messages = (db.prepare('SELECT direction, channel, text, created_at AS createdAt FROM messages WHERE place_id=? ORDER BY id')
      .all(id) as PlaceDetails['messages'])
    const statusLog = (db.prepare('SELECT from_status AS "from", to_status AS "to", at FROM status_log WHERE place_id=? ORDER BY at, rowid')
      .all(id) as PlaceDetails['statusLog'])
    const prior = PRIORS.categories[p.category] ?? PRIORS.default
    const score = scorePlace(
      { webClass: p.webClass, phoneType: p.phoneType, reviews: p.reviews, rating: p.rating },
      prior, historyFor(db, { categoryId: p.category, cityId: p.cityId }, d.now()), PRIORS.weights, PRIORS.default
    )
    const channels: Channel[] = channelsFor(s.country, contacts, p.phoneE164, p.phoneType)
    const { score: _stored, ...rest } = p
    return { ...rest, contacts, findings: latestFindings(db, id), messages, statusLog, score, channels }
  })

  define(t, 'places.toBase', (_e, id, v) => { need(db, id); updatePlace(db, id, { inBase: v }) })
  define(t, 'places.setStatus', (_e, id, st) => {
    const p = need(db, id)
    setStatus(db, id, st, d.now())
    if (p.status === 'later' && st !== 'later') clearReminder(db, id)
    rescorePlace(db, p, d.now()) // ответил/отказ/сделка меняют историю ответов категории
  })
  define(t, 'places.remind', (_e, id, at) => {
    const p = need(db, id)
    db.transaction(() => {
      if (p.status !== 'later' && p.status !== 'deal' && p.status !== 'refused') setStatus(db, id, 'later', d.now())
      updatePlace(db, id, { remindAt: at })
      // одна незакрытая задача на место: новое напоминание заменяет старое
      db.prepare("DELETE FROM jobs WHERE kind='reminder' AND done=0 AND json_extract(payload,'$.placeId')=?").run(id)
      db.prepare("INSERT INTO jobs(kind,run_at,payload,done) VALUES ('reminder',?,?,0)").run(at, JSON.stringify({ placeId: id }))
    })()
    rescorePlace(db, p, d.now())
  })
  define(t, 'places.setDeal', (_e, id, amount) => { need(db, id); updatePlace(db, id, { dealAmount: amount }) })
  define(t, 'places.note', (_e, id, dir, text) => {
    need(db, id)
    db.prepare('INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,?,NULL,?,?)').run(id, dir, text, d.now())
  })

  const refreshing = new Set<number>()
  define(t, 'places.refreshGoogle', async (_e, id) => {
    requireLicense(db, d.now(), d.licensePublicKey)
    const p = need(db, id)
    const key = getSecret(db, 'google', d.secretEnv)
    if (!key) throw new Error('no_google_key')
    if (!p.googlePlaceId) throw new Error('no_google_id')
    if (refreshing.has(id)) throw new Error('refresh_running')
    if (!takeRefresh(db, d.now())) throw new Error('refresh_limit')
    refreshing.add(id)
    try {
      const raw = await new GoogleClient(key, new Budget(1)).details(p.googlePlaceId)
      const cur = need(db, id) // место могли изменить или удалить, пока шёл запрос
      const phone = raw.phones.map((x) => parsePhone(x, loadSettings(db).country)).find((x) => x !== null) ?? null
      const patch = mergePatch(cur, {
        name: raw.name, address: raw.address ?? null, phoneE164: phone?.e164 ?? null, phoneType: phone?.type ?? 'unknown',
        website: raw.website ?? null, rating: raw.rating ?? null, reviews: raw.reviews ?? null,
        googleFetchedAt: d.now(), googlePlaceId: cur.googlePlaceId
      })
      if ('website' in patch) patch.webClass = classifyWeb(patch.website ?? undefined)
      updatePlace(db, id, patch)
      const fresh = getPlace(db, id)!
      if (fresh.webClass === 'own' && fresh.website && !db.prepare('SELECT 1 FROM audits WHERE place_id=?').get(id)) d.auditQueue.push(id)
    } finally { refreshing.delete(id) }
  })

  define(t, 'places.remove', async (_e, id) => {
    // демо с телефоном не должно остаться в открытом доступе: не сняли — место не удаляем
    await demo.removeForPlace(id)
    const p = getPlace(db, id)
    if (p) { // кэш текстов, созданный до появления llm_cache.place_id, находим по ключу
      const s = loadSettings(db)
      const del = db.prepare('DELETE FROM llm_cache WHERE key=?')
      for (const tone of TONES) del.run(cacheKey(inputFor(db, p, s, tone)))
    }
    for (const f of deletePlaceForever(db, id, d.now())) {
      if (!insideShots(d.userDataDir, f)) continue
      try { unlinkSync(f) } catch { /* файла нет */ }
    }
  })

  define(t, 'message.generate', async (_e, id, tone) => {
    requireLicense(db, d.now(), d.licensePublicKey)
    const p = need(db, id)
    const s = loadSettings(db)
    const ask = askerFor(d, s)
    if (!ask) throw new Error(s.llmProvider === 'anthropic' ? 'no_anthropic_key' : 'no_llm_key')
    return generateMessage(inputFor(db, p, s, tone), { ask, db, placeId: id })
  })

  define(t, 'audit.run', (_e, id) => {
    if (!need(db, id).website) throw new Error('no_website')
    d.auditQueue.push(id)
  })

  define(t, 'audit.screenshot', (_e, id) => {
    const r = db.prepare('SELECT screenshot FROM audits WHERE place_id=? AND screenshot IS NOT NULL ORDER BY id DESC LIMIT 1')
      .get(id) as { screenshot: string } | undefined
    if (!r) return null
    const file = resolve(r.screenshot)
    if (!insideShots(d.userDataDir, file)) return null
    try { return `data:image/png;base64,${readFileSync(file).toString('base64')}` } catch { return null }
  })
}
