import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Db } from './db/db'

const FILE_RE = /^data-\d{4}-\d{2}-\d{2}\.db$/

/** Возвращает лишние файлы (самые старые по имени), оставляя `keep` свежих. Чужие имена игнорируются. */
export function pruneBackups(files: string[], keep: number): string[] {
  const own = files.filter((f) => FILE_RE.test(f)).sort()
  return own.slice(0, Math.max(0, own.length - keep))
}

const TMP_RE = /^\.tmp-.*\.db$/

function scrubSecrets(file: string): void {
  const copy = new Database(file)
  try {
    copy.exec("DELETE FROM settings WHERE key LIKE 'secret:%'")
    copy.exec('VACUUM')
  } finally {
    copy.close()
  }
}

/** Копия БД без секретов (ключи API, токен бота). Пишем во временный файл рядом, чистим, и только потом rename: на диске нет копии с секретами под финальным именем. */
export async function backupTo(db: Db, dest: string, scrub: (file: string) => void = scrubSecrets): Promise<void> {
  const tmp = join(dirname(dest), `.tmp-${randomBytes(6).toString('hex')}.db`)
  try {
    await db.backup(tmp)
    scrub(tmp)
    renameSync(tmp, dest)
  } catch (e) {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]) rmSync(f, { force: true })
    throw e
  }
}

export const backupName = (now: number): string => {
  const d = new Date(now)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `data-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.db`
}

export async function backupNow(db: Db, dir: string, now: number): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, backupName(now))
  for (const f of readdirSync(dir)) if (TMP_RE.test(f)) rmSync(join(dir, f), { force: true }) // хвосты прерванных копий
  await backupTo(db, dest)
  for (const f of pruneBackups(readdirSync(dir), 7)) rmSync(join(dir, f), { force: true })
  return dest
}
