import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db/db'
import { addContacts, getPlace } from '../db/repo'
import type { AuditResult } from './runner-types'

/** Место могли удалить, пока шёл аудит: тогда ни PNG, ни строки. PNG без строки в audits не остаётся. */
export function saveAudit(db: Db, userDataDir: string, placeId: number, url: string, ranAt: number, r: AuditResult): void {
  if (!getPlace(db, placeId)) return
  let shot: string | null = null
  if (r.screenshot) {
    const dir = join(userDataDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    shot = join(dir, `${placeId}.png`)
    writeFileSync(shot, r.screenshot)
  }
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO audits(place_id,url,ran_at,findings,screenshot,error) VALUES (?,?,?,?,?,?)')
        .run(placeId, url, ranAt, JSON.stringify(r.findings), shot, r.error ?? null)
      if (r.contacts.length > 0) addContacts(db, placeId, r.contacts)
    })()
  } catch (e) {
    if (shot) rmSync(shot, { force: true })
    throw e
  }
}
