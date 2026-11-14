import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db/db'
import { addContacts } from '../db/repo'
import type { AuditResult } from './runner-types'

export function saveAudit(db: Db, userDataDir: string, placeId: number, url: string, ranAt: number, r: AuditResult): void {
  let shot: string | null = null
  if (r.screenshot) {
    const dir = join(userDataDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    shot = join(dir, `${placeId}.png`)
    writeFileSync(shot, r.screenshot)
  }
  db.prepare('INSERT INTO audits(place_id,url,ran_at,findings,screenshot,error) VALUES (?,?,?,?,?,?)')
    .run(placeId, url, ranAt, JSON.stringify(r.findings), shot, r.error ?? null)
  if (r.contacts.length > 0) addContacts(db, placeId, r.contacts)
}
