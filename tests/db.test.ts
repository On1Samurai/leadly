import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, openDb, type Db } from '../src/main/db/db'
import {
  candidatesNear, deletePlaceForever, getSetting, insertPlace, setSetting, setStatus, addContacts
} from '../src/main/db/repo'
import type { Place } from '../src/shared/types'

let dir: string
let db: Db

function mkPlace(over: Partial<Omit<Place, 'id'>> = {}): Omit<Place, 'id'> {
  return {
    name: 'Кафе', category: 'cafe', lat: 50, lon: 30, address: null, cityId: 1, cellId: null,
    phoneE164: null, phoneType: 'unknown', website: null, webClass: 'none', rating: null, reviews: null,
    googlePlaceId: null, osmId: null, googleFetchedAt: null, status: 'new', inBase: false,
    remindAt: null, score: 0, scoreReason: '', createdAt: 1, ...over
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
  it('migrate twice is idempotent', () => {
    migrate(db)
    const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[]
    expect(rows.map((r) => r.version)).toEqual([1])
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
})
