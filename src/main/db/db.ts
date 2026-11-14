import Database from 'better-sqlite3'

export type Db = Database.Database

const sources = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function versionOf(path: string): number {
  const m = /(\d+)_[^/]*\.sql$/.exec(path)
  if (!m) throw new Error(`Bad migration name: ${path}`)
  return Number(m[1])
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  const current = row.v ?? 0
  const pending = Object.entries(sources)
    .map(([path, sql]) => ({ v: versionOf(path), sql }))
    .filter((m) => m.v > current)
    .sort((a, b) => a.v - b.v)
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(m.v)
    })()
  }
}

export function openDb(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
