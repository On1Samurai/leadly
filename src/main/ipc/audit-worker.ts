import type { Db } from '../db/db'
import { getPlace } from '../db/repo'
import type { AuditResult } from '../audit/runner-types'
import { saveAudit } from '../audit/save'
import { CATEGORIES } from './data'

type RunAudit = (url: string, opts: { checkMenu?: boolean }) => Promise<AuditResult>

/** Воркер очереди аудитов: runAudit по сайту места, затем saveAudit. */
export function makeAuditWorker(db: Db, userDataDir: string, run: RunAudit, now: () => number = Date.now) {
  return async (placeId: number): Promise<void> => {
    const place = getPlace(db, placeId)
    if (!place?.website) return
    const cat = CATEGORIES.find((c) => c.id === place.category)
    const result = await run(place.website, { checkMenu: cat?.menu })
    if (result.error === 'offline') return // без строки audits место снова попадёт в очередь (enqueueAudits)
    saveAudit(db, userDataDir, placeId, place.website, now(), result)
  }
}
