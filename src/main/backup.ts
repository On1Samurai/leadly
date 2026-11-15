import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db/db'

const FILE_RE = /^data-\d{4}-\d{2}-\d{2}\.db$/

/** Возвращает лишние файлы (самые старые по имени), оставляя `keep` свежих. Чужие имена игнорируются. */
export function pruneBackups(files: string[], keep: number): string[] {
  const own = files.filter((f) => FILE_RE.test(f)).sort()
  return own.slice(0, Math.max(0, own.length - keep))
}

/** Копия БД без секретов (ключей API и токена бота): копия уходит из программы, секреты нет. */
export async function backupTo(db: Db, dest: string): Promise<void> {
  await db.backup(dest)
  const copy = new Database(dest)
  try {
    copy.exec("DELETE FROM settings WHERE key LIKE 'secret:%'")
    copy.exec('VACUUM')
  } finally {
    copy.close()
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
  rmSync(dest, { force: true }) // повторная копия за день заменяет первую
  await backupTo(db, dest)
  for (const f of pruneBackups(readdirSync(dir), 7)) rmSync(join(dir, f), { force: true })
  return dest
}
