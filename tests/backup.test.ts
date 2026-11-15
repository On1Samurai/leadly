process.env.TZ = 'Europe/Minsk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db/db'
import { backupNow, backupTo, pruneBackups } from '../src/main/backup'
import { setSetting } from '../src/main/db/repo'

let dir: string, db: Db
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'll-bk-')); db = openDb(join(dir, 't.db')) })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

describe('backups', () => {
  it('pruneBackups keeps 7 newest', () => {
    const files = Array.from({ length: 9 }, (_, i) => `data-2026-11-0${i + 1}.db`).reverse()
    expect(pruneBackups([...files, 'notes.txt'], 7).sort()).toEqual(['data-2026-11-01.db', 'data-2026-11-02.db'])
  })
  it('backupNow writes local-dated copy without secrets and prunes', async () => {
    setSetting(db, 'secret:anthropic', 'KEY'); setSetting(db, 'app', { dailyGoal: 3 })
    const out = join(dir, 'backups')
    for (let d = 1; d <= 8; d++) await backupNow(db, out, new Date(2026, 10, d, 4, 0).getTime())
    const last = await backupNow(db, out, new Date(2026, 10, 9, 0, 30).getTime())
    expect(last.endsWith('data-2026-11-09.db')).toBe(true)
    expect(readdirSync(out).sort()).toHaveLength(7)
    expect(existsSync(join(out, 'data-2026-11-01.db'))).toBe(false)
    const copy = new Database(last, { readonly: true })
    expect(copy.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'secret:%'").get()).toEqual({ n: 0 })
    expect(copy.prepare("SELECT COUNT(*) n FROM settings WHERE key='app'").get()).toEqual({ n: 1 })
    copy.close()
    // оригинал не тронут
    expect(db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'secret:%'").get()).toEqual({ n: 1 })
  })
  it('scrub failure leaves no file at final path and no temp file', async () => {
    const out = join(dir, 'x'); mkdirSync(out)
    const dest = join(out, 'data-2026-11-09.db')
    await expect(backupTo(db, dest, () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(readdirSync(out)).toEqual([])
  })
  it('failed rerun keeps the previous same-day backup; leftover .tmp files are cleared', async () => {
    const out = join(dir, 'backups'); const now = new Date(2026, 10, 9, 10).getTime()
    const first = await backupNow(db, out, now)
    writeFileSync(join(out, '.tmp-old.db'), 'x')
    await backupNow(db, out, now)
    expect(readdirSync(out)).toEqual(['data-2026-11-09.db'])
    expect(existsSync(first)).toBe(true)
  })
  it('export path: copy in chosen dir is scrubbed, no temp left', async () => {
    setSetting(db, 'secret:telegram', 'T')
    const dest = join(dir, 'exp.db')
    await backupTo(db, dest)
    const c = new Database(dest, { readonly: true })
    expect(c.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'secret:%'").get()).toEqual({ n: 0 })
    c.close()
    expect(readdirSync(dir).filter((f) => f.startsWith('.tmp-'))).toEqual([])
  })
})
