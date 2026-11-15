import type { Db } from '../db/db'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Дата 'YYYY-MM-DD' по локальному времени машины. */
export function localDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function opened(db: Db, now: number): number {
  const r = db.prepare('SELECT links_opened AS n FROM daily WHERE date=?').get(localDate(now)) as { n: number } | undefined
  return r?.n ?? 0
}

export function dailyGate(db: Db, now: number, limit: number): { allowed: boolean; left: number } {
  const left = Math.max(0, limit - opened(db, now))
  return { allowed: left > 0, left }
}

/** daily.links_opened + 1 за локальную дату. */
export function countOpen(db: Db, now: number): void {
  db.prepare('INSERT INTO daily(date, links_opened) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET links_opened = links_opened + 1')
    .run(localDate(now))
}
