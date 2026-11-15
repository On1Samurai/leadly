import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, openDb, type Db } from '../src/main/db/db'
import {
  candidatesNear, deletePlaceForever, getSetting, getPlace, insertPlace, setSetting, setStatus, addContacts, updatePlace
} from '../src/main/db/repo'
import type { Place } from '../src/shared/types'
import { upsertRaw } from '../src/main/search/upsert'
import { generateMessage } from '../src/main/llm/message'

let dir: string
let db: Db

function mkPlace(over: Partial<Omit<Place, 'id'>> = {}): Omit<Place, 'id'> {
  return {
    name: 'Кафе', category: 'cafe', lat: 50, lon: 30, address: null, cityId: 1, cellId: null,
    phoneE164: null, phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null,
    googlePlaceId: null, osmId: null, googleFetchedAt: null, status: 'new', inBase: false,
    remindAt: null, score: 0, scoreReason: '', createdAt: 1, dealAmount: null, ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'll-db-'))
  db = openDb(join(dir, 'test.db'))
  db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','UA','{}',0)").run()
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('db', () => {
  it('updatePlace ignores unknown, prototype and undefined keys', () => {
    const id = insertPlace(db, mkPlace({ name: 'A', rating: 4 }))
    updatePlace(db, id, { name: 'B', rating: undefined, toString: 'x', hasOwnProperty: 1, 'name=1; --': 'z', id: 99 } as never)
    const p = getPlace(db, id)!
    expect(p.name).toBe('B')
    expect(p.rating).toBe(4)
    expect(p.id).toBe(id)
    updatePlace(db, id, { rating: undefined } as never) // nothing to update: no throw
  })

  it('migrate twice is idempotent', () => {
    migrate(db)
    const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[]
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4])
  })

  it('миграция 002: places.deal_amount', () => {
    const id = insertPlace(db, mkPlace({ dealAmount: 12345 }))
    expect(getPlace(db, id)!.dealAmount).toBe(12345)
    expect(getPlace(db, insertPlace(db, mkPlace()))!.dealAmount).toBeNull()
  })

  it('settings roundtrip', () => {
    setSetting(db, 'x', { a: 1 })
    expect(getSetting(db, 'x', null)).toEqual({ a: 1 })
    expect(getSetting(db, 'missing', 42)).toBe(42)
  })

  it('setStatus logs transition', () => {
    const id = insertPlace(db, mkPlace())
    setStatus(db, id, 'written', 1000)
    const row = db.prepare('SELECT * FROM status_log WHERE place_id=?').get(id) as Record<string, unknown>
    expect(row.from_status).toBe('new')
    expect(row.to_status).toBe('written')
    expect(row.at).toBe(1000)
  })

  it('candidatesNear radius', () => {
    // 1 градус широты = 111195 м; 40 м ~ 0.00036, 150 м ~ 0.00135
    insertPlace(db, mkPlace({ name: 'near', lat: 50 + 0.00036 }))
    insertPlace(db, mkPlace({ name: 'far', lat: 50 + 0.00135 }))
    const res = candidatesNear(db, 50, 30, 100)
    expect(res.map((c) => c.name)).toEqual(['near'])
  })

  it('deletePlaceForever removes everything', () => {
    const id = insertPlace(db, mkPlace())
    addContacts(db, id, [{ kind: 'telegram', value: 'a' }])
    db.prepare("INSERT INTO audits(place_id,url,ran_at,findings,screenshot) VALUES (?,?,?,?,?)").run(id, 'u', 1, '[]', '/s/1.png')
    db.prepare("INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,?,?,?,?)").run(id, 'out', 'telegram', 't', 1)
    setStatus(db, id, 'written', 5)
    const paths = deletePlaceForever(db, id)
    expect(paths).toEqual(['/s/1.png'])
    for (const t of ['contacts', 'audits', 'messages', 'status_log', 'places']) {
      const col = t === 'places' ? 'id' : 'place_id'
      const n = db.prepare(`SELECT count(*) c FROM ${t} WHERE ${col}=?`).get(id) as { c: number }
      expect(n.c).toBe(0)
    }
  })
  it('миграция 004: suppressed, cities.size_km, llm_cache.place_id, индексы', () => {
    const cols = (t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('suppressed')).toEqual(['hash', 'created_at'])
    expect(cols('cities')).toContain('size_km')
    expect(cols('llm_cache')).toContain('place_id')
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name)
    expect(idx).toEqual(expect.arrayContaining(['idx_audits_place', 'idx_messages_place']))
  })

  it('«Удалить навсегда»: то же место не возвращается, хеши без открытых данных, кэш текстов удалён', async () => {
    const ctx = { country: 'BY', cityId: 1, cellId: null, categoryId: 'cafe', now: 5 }
    const g = { source: 'google' as const, sourceId: 'gp-1', name: 'Smak', lat: 50, lon: 30, phones: ['+375 29 123-45-67'], contacts: [] }
    expect(upsertRaw(db, g, ctx)).toBe('new')
    const id = (db.prepare('SELECT id FROM places').get() as { id: number }).id
    const reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Здравствуйте!' }] }
    const ask = async () => ({ text: reply.content[0].text, truncated: false })
    const input = { scenario: 'no_site' as const, sells: 'сайты', tone: 'short' as const, lang: 'ru' as const,
      place: { name: 'Smak', category: 'cafe', city: 'T', rating: null, reviews: null, webClass: 'none' as const }, findings: [] }
    await generateMessage(input, { ask, db, placeId: id })
    expect(db.prepare('SELECT place_id FROM llm_cache').all()).toEqual([{ place_id: id }])

    deletePlaceForever(db, id)
    expect(db.prepare('SELECT COUNT(*) n FROM llm_cache').get()).toEqual({ n: 0 })
    const hashes = (db.prepare('SELECT hash FROM suppressed').all() as { hash: string }[]).map((r) => r.hash)
    expect(hashes).toHaveLength(2) // google id и телефон
    expect(hashes.join()).not.toMatch(/gp-1|375/)

    // тот же источник, OSM-копия с тем же телефоном — не вставляются
    expect(upsertRaw(db, g, ctx)).toBe('suppressed')
    expect(upsertRaw(db, { ...g, source: 'osm', sourceId: 'node/9', lat: 51 }, ctx)).toBe('suppressed')
    expect(db.prepare('SELECT COUNT(*) n FROM places').get()).toEqual({ n: 0 })
    // другое место вставляется
    expect(upsertRaw(db, { ...g, sourceId: 'gp-2', phones: [], lat: 52 }, ctx)).toBe('new')
  })
})
