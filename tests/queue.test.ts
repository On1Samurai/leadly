import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { AuditQueue, enqueueAudits } from '../src/main/audit/queue'

describe('AuditQueue', () => {
  it('respects concurrency, survives worker errors', async () => {
    let cur = 0, max = 0
    const done: number[] = []
    const q = new AuditQueue(2, async (id) => {
      cur++; max = Math.max(max, cur)
      await new Promise((r) => setTimeout(r, 20))
      cur--
      if (id === 2) throw new Error('boom')
      done.push(id)
    })
    for (let i = 1; i <= 5; i++) q.push(i)
    expect(q.size()).toBeGreaterThan(0)
    await q.idle()
    expect(max).toBe(2)
    expect(done.sort()).toEqual([1, 3, 4, 5])
    expect(q.size()).toBe(0)
  })
})

describe('enqueueAudits', () => {
  let dir: string, db: Db
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'll-q-'))
    db = openDb(join(dir, 't.db'))
    db.prepare("INSERT INTO cities(id,name,country,bbox,created_at) VALUES (1,'T','UA','{}',0)").run()
    const ins = db.prepare("INSERT INTO places(id,name,category,lat,lon,city_id,website,web_class,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    ins.run(1, 'a', 'c', 0, 0, 1, 'http://a.ru', 'own', 0)
    ins.run(2, 'b', 'c', 0, 0, 1, 'http://b.ru', 'own', 0)
    ins.run(3, 'c', 'c', 0, 0, 1, 'http://c.ru', 'template', 0)
    ins.run(4, 'd', 'c', 0, 0, 1, null, 'own', 0)
    db.prepare("INSERT INTO audits(place_id,url,ran_at) VALUES (2,'http://b.ru',1)").run()
  })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  it('queues own sites without audit', async () => {
    const got: number[] = []
    const q = new AuditQueue(1, async (id) => { got.push(id) })
    expect(enqueueAudits(db, q)).toBe(1)
    await q.idle()
    expect(got).toEqual([1])
  })
})

describe('AuditQueue dedupe', () => {
  it('ignores an id already queued or running', async () => {
    const runs: number[] = []
    const q = new AuditQueue(1, async (id) => { runs.push(id); await new Promise((r) => setTimeout(r, 10)) })
    q.push(1); q.push(1); q.push(2); q.push(2); q.push(1)
    await q.idle()
    expect(runs).toEqual([1, 2])
    q.push(1) // finished ids can be queued again
    await q.idle()
    expect(runs).toEqual([1, 2, 1])
  })
})

describe('AuditQueue onIdle', () => {
  it('fires when the queue drains', async () => {
    let n = 0
    const q = new AuditQueue(1, async () => { await new Promise((r) => setTimeout(r, 5)) })
    q.onIdle = () => { n++ }
    q.push(1); q.push(2)
    await q.idle()
    expect(n).toBe(1)
  })
})
