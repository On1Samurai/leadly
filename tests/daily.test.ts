// TZ задаётся до загрузки модулей: localDate смотрит на локальное время машины
process.env.TZ = 'Europe/Minsk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '../src/main/db/db'

let dir: string
let db: Db
let daily: typeof import('../src/main/core/daily')

beforeEach(async () => {
  daily = await import('../src/main/core/daily')
  const { openDb } = await import('../src/main/db/db')
  dir = mkdtempSync(join(tmpdir(), 'll-daily-'))
  db = openDb(join(dir, 't.db'))
})
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

describe('daily', () => {
  it('localDate по локальному времени', () => {
    expect(daily.localDate(new Date(2026, 10, 14, 23, 59).getTime())).toBe('2026-11-14')
    // 21:30 UTC уже следующий день в Минске (UTC+3)
    expect(daily.localDate(Date.UTC(2026, 10, 14, 21, 30))).toBe('2026-11-15')
  })

  it('limit reached blocks', () => {
    const now = new Date(2026, 10, 14, 12, 0).getTime()
    expect(daily.dailyGate(db, now, 30)).toEqual({ allowed: true, left: 30 })
    for (let i = 0; i < 30; i++) daily.countOpen(db, now)
    expect(daily.dailyGate(db, now, 30)).toEqual({ allowed: false, left: 0 })
    daily.countOpen(db, now) // сверх лимита: left не уходит в минус
    expect(daily.dailyGate(db, now, 30)).toEqual({ allowed: false, left: 0 })
  })

  it('counter resets at local midnight', () => {
    const late = new Date(2026, 10, 14, 23, 59).getTime()
    const early = new Date(2026, 10, 15, 0, 1).getTime()
    for (let i = 0; i < 30; i++) daily.countOpen(db, late)
    expect(daily.dailyGate(db, late, 30).allowed).toBe(false)
    expect(daily.dailyGate(db, early, 30)).toEqual({ allowed: true, left: 30 })
  })
})
