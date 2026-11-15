import type { PlaceCounts } from '../../shared/ipc'
import type { Contact, Place, Status, WebClass } from '../../shared/types'
import { haversineM } from '../core/geo'
import type { Db } from './db'

export function getSetting<T>(db: Db, key: string, def: T): T {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return r ? (JSON.parse(r.value) as T) : def
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value))
}

export interface Candidate {
  id: number; googlePlaceId: string | null; osmId: string | null; phoneE164: string | null
  name: string; lat: number; lon: number
}

const CAND_COLS = 'id, google_place_id AS googlePlaceId, osm_id AS osmId, phone_e164 AS phoneE164, name, lat, lon'

export function candidatesNear(db: Db, lat: number, lon: number, radiusM: number): Candidate[] {
  const dLat = radiusM / 111320
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6)
  const rows = db.prepare(
    `SELECT ${CAND_COLS} FROM places WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
  ).all(lat - dLat, lat + dLat, lon - dLon, lon + dLon) as Candidate[]
  return rows.filter((c) => haversineM({ lat, lon }, c) <= radiusM)
}

export function candidatesByKeys(db: Db, k: { googlePlaceId?: string; osmId?: string; phoneE164?: string }): Candidate[] {
  const parts: string[] = []
  const args: string[] = []
  if (k.googlePlaceId) { parts.push('google_place_id=?'); args.push(k.googlePlaceId) }
  if (k.osmId) { parts.push('osm_id=?'); args.push(k.osmId) }
  if (k.phoneE164) { parts.push('phone_e164=?'); args.push(k.phoneE164) }
  if (!parts.length) return []
  return db.prepare(`SELECT ${CAND_COLS} FROM places WHERE ${parts.join(' OR ')}`).all(...args) as Candidate[]
}

// camelCase поле Place -> колонка SQL
const COLS: Record<keyof Omit<Place, 'id'>, string> = {
  name: 'name', category: 'category', lat: 'lat', lon: 'lon', address: 'address', cityId: 'city_id',
  cellId: 'cell_id', phoneE164: 'phone_e164', phoneType: 'phone_type', website: 'website',
  webClass: 'web_class', rating: 'rating', reviews: 'reviews', googlePlaceId: 'google_place_id',
  osmId: 'osm_id', googleFetchedAt: 'google_fetched_at', status: 'status', inBase: 'in_base',
  remindAt: 'remind_at', score: 'score', scoreReason: 'score_reason', createdAt: 'created_at'
}

const SELECT = `SELECT id, ${Object.entries(COLS).map(([k, c]) => (k === c ? c : `${c} AS ${k}`)).join(', ')} FROM places`

function toSql(v: unknown): unknown {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}

type Row = Omit<Place, 'inBase'> & { inBase: number }
const fromRow = (r: Row): Place => ({ ...r, inBase: r.inBase === 1 })

export function insertPlace(db: Db, p: Omit<Place, 'id'>): number {
  const keys = Object.keys(COLS) as (keyof typeof COLS)[]
  const sql = `INSERT INTO places(${keys.map((k) => COLS[k]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
  return Number(db.prepare(sql).run(...keys.map((k) => toSql(p[k]))).lastInsertRowid)
}

export function updatePlace(db: Db, id: number, patch: Partial<Place>): void {
  // patch may come from IPC (untyped at runtime): only own COLS keys, never undefined values
  const keys = (Object.keys(patch) as (keyof Place)[])
    .filter((k): k is keyof typeof COLS => k !== 'id' && Object.hasOwn(COLS, k) && patch[k] !== undefined)
  if (!keys.length) return
  db.prepare(`UPDATE places SET ${keys.map((k) => `${COLS[k]}=?`).join(',')} WHERE id=?`)
    .run(...keys.map((k) => toSql(patch[k])), id)
}

export function getPlace(db: Db, id: number): Place | null {
  const r = db.prepare(`${SELECT} WHERE id=?`).get(id) as Row | undefined
  return r ? fromRow(r) : null
}

export interface PlaceFilter {
  cityId?: number; inBase?: boolean; webClass?: WebClass[]; status?: Status[]; category?: string
  sort: 'score' | 'new'; limit: number; offset: number
}

function whereOf(f: Omit<PlaceFilter, 'sort' | 'limit' | 'offset'>, withWeb = true): { sql: string; args: unknown[] } {
  const where: string[] = []
  const args: unknown[] = []
  if (f.cityId !== undefined) { where.push('city_id=?'); args.push(f.cityId) }
  if (f.inBase !== undefined) { where.push('in_base=?'); args.push(f.inBase ? 1 : 0) }
  if (f.category) { where.push('category=?'); args.push(f.category) }
  if (withWeb && f.webClass?.length) { where.push(`web_class IN (${f.webClass.map(() => '?').join(',')})`); args.push(...f.webClass) }
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => '?').join(',')})`); args.push(...f.status) }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', args }
}

export function listPlaces(db: Db, f: PlaceFilter): Place[] {
  const { sql: w, args } = whereOf(f)
  const order = f.sort === 'score' ? 'score DESC, id DESC' : 'created_at DESC, id DESC'
  return (db.prepare(`${SELECT}${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset) as Row[]).map(fromRow)
}

export function countPlaces(db: Db, f: Omit<PlaceFilter, 'sort' | 'limit' | 'offset'>): PlaceCounts {
  const { sql: all, args: a1 } = whereOf(f)
  const total = (db.prepare(`SELECT COUNT(*) n FROM places${all}`).get(...a1) as { n: number }).n
  const { sql: w, args } = whereOf(f, false)
  const out: PlaceCounts = { total, none: 0, template: 0, social: 0, own: 0 }
  for (const r of db.prepare(`SELECT web_class c, COUNT(*) n FROM places${w} GROUP BY web_class`).all(...args) as { c: WebClass; n: number }[]) out[r.c] = r.n
  return out
}

export function setStatus(db: Db, id: number, to: Status, now: number): void {
  db.transaction(() => {
    const r = db.prepare('SELECT status FROM places WHERE id=?').get(id) as { status: Status } | undefined
    if (!r) throw new Error(`Place ${id} not found`)
    db.prepare('UPDATE places SET status=? WHERE id=?').run(to, id)
    db.prepare('INSERT INTO status_log(place_id,from_status,to_status,at) VALUES (?,?,?,?)').run(id, r.status, to, now)
  })()
}

export function addContacts(db: Db, placeId: number, c: Contact[]): void {
  const st = db.prepare('INSERT OR IGNORE INTO contacts(place_id,kind,value) VALUES (?,?,?)')
  db.transaction(() => { for (const x of c) st.run(placeId, x.kind, x.value) })()
}

export function deletePlaceForever(db: Db, id: number): string[] {
  return db.transaction(() => {
    const shots = (db.prepare('SELECT screenshot FROM audits WHERE place_id=? AND screenshot IS NOT NULL').all(id) as { screenshot: string }[])
      .map((r) => r.screenshot)
    for (const t of ['contacts', 'audits', 'messages', 'status_log']) db.prepare(`DELETE FROM ${t} WHERE place_id=?`).run(id)
    db.prepare('DELETE FROM places WHERE id=?').run(id)
    return shots
  })()
}
