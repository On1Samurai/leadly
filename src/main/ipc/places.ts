import { readFileSync, unlinkSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Channel, Contact, Finding, Place } from '../../shared/types'
import type { PlaceDetails, PlaceView } from '../../shared/ipc'
import type { AppSettings, Tone } from '../../shared/settings'
import type { Db } from '../db/db'
import { deletePlaceForever, getPlace, listPlaces, setStatus, updatePlace } from '../db/repo'
import { mergePatch } from '../core/dedup'
import { channelsFor } from '../core/links'
import { parsePhone } from '../core/phones'
import { scorePlace } from '../core/scoring'
import { classifyWeb } from '../core/webclass'
import { buildMessageInput, generateMessage, isTextReady, type MessageInput } from '../llm/message'
import { historyFor } from '../search/rescore'
import { GoogleClient, Budget } from '../sources/google'
import { getSecret } from '../secrets'
import { loadSettings } from '../settings'
import { PRIORS } from './data'
import { define, type IpcDeps, type Table } from './define'

export const latestFindings = (db: Db, placeId: number): Finding[] => {
  const r = db.prepare('SELECT findings FROM audits WHERE place_id=? ORDER BY id DESC LIMIT 1').get(placeId) as { findings: string } | undefined
  return r ? (JSON.parse(r.findings) as Finding[]) : []
}

const cityName = (db: Db, id: number): string =>
  (db.prepare('SELECT name FROM cities WHERE id=?').get(id) as { name: string } | undefined)?.name ?? ''

export function inputFor(db: Db, p: Place, s: AppSettings, tone: Tone = s.tone): MessageInput {
  const sells = [...s.sells, s.custom].map((x) => x.trim()).filter(Boolean).join(', ')
  return buildMessageInput(p, cityName(db, p.cityId), latestFindings(db, p.id), { sells, tone, lang: s.lang, mode: 'local' })
}

export const toView = (db: Db, p: Place, s: AppSettings): PlaceView =>
  ({ ...p, textReady: isTextReady(inputFor(db, p, s), db) })

function need(db: Db, id: number): Place {
  const p = getPlace(db, id)
  if (!p) throw new Error('not_found')
  return p
}

export function placesHandlers(t: Table, d: IpcDeps): void {
  const { db } = d

  define(t, 'places.list', (_e, f) => {
    const s = loadSettings(db)
    return listPlaces(db, f).map((p) => toView(db, p, s))
  })

  define(t, 'places.get', (_e, id): PlaceDetails => {
    const p = need(db, id)
    const s = loadSettings(db)
    const contacts = db.prepare('SELECT kind, value FROM contacts WHERE place_id=?').all(id) as Contact[]
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
  define(t, 'places.setStatus', (_e, id, st) => setStatus(db, id, st, d.now()))
  define(t, 'places.remind', (_e, id, at) => { need(db, id); updatePlace(db, id, { remindAt: at }) })
  define(t, 'places.note', (_e, id, dir, text) => {
    need(db, id)
    db.prepare('INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,?,NULL,?,?)').run(id, dir, text, d.now())
  })

  define(t, 'places.refreshGoogle', async (_e, id) => {
    const p = need(db, id)
    const key = getSecret(db, 'google', d.secretEnv)
    if (!key) throw new Error('no_google_key')
    if (!p.googlePlaceId) throw new Error('no_google_id')
    const raw = await new GoogleClient(key, new Budget(1)).details(p.googlePlaceId)
    const phone = raw.phones.map((x) => parsePhone(x, loadSettings(db).country)).find((x) => x !== null) ?? null
    const patch = mergePatch(p, {
      name: raw.name, address: raw.address ?? null, phoneE164: phone?.e164 ?? null, phoneType: phone?.type ?? 'unknown',
      website: raw.website ?? null, rating: raw.rating ?? null, reviews: raw.reviews ?? null,
      googleFetchedAt: d.now(), googlePlaceId: p.googlePlaceId
    })
    if ('website' in patch) patch.webClass = classifyWeb(patch.website ?? undefined)
    updatePlace(db, id, patch)
  })

  define(t, 'places.remove', (_e, id) => {
    for (const f of deletePlaceForever(db, id)) {
      try { unlinkSync(f) } catch { /* файла нет */ }
    }
  })

  define(t, 'message.generate', async (_e, id, tone) => {
    const p = need(db, id)
    const key = getSecret(db, 'anthropic', d.secretEnv)
    if (!key) throw new Error('no_anthropic_key')
    return generateMessage(inputFor(db, p, loadSettings(db), tone), { client: d.anthropicFactory(key), db })
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
    if (!file.startsWith(resolve(d.userDataDir) + sep)) return null
    try { return `data:image/png;base64,${readFileSync(file).toString('base64')}` } catch { return null }
  })
}
