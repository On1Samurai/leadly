import type { Db } from '../db/db'

export class AuditQueue {
  private q: number[] = []
  private running = 0
  private active = new Set<number>() // queued or running
  private waiters: (() => void)[] = []
  constructor(private concurrency: number, private worker: (placeId: number) => Promise<void>) {}

  push(placeId: number): void {
    if (this.active.has(placeId)) return
    this.active.add(placeId)
    this.q.push(placeId)
    this.pump()
  }

  size(): number { return this.q.length + this.running }

  idle(): Promise<void> {
    return this.size() === 0 ? Promise.resolve() : new Promise((r) => this.waiters.push(r))
  }

  private pump(): void {
    while (this.running < this.concurrency && this.q.length > 0) {
      const id = this.q.shift()!
      this.running++
      void this.worker(id).catch(() => undefined).finally(() => {
        this.running--
        this.active.delete(id)
        this.pump()
        if (this.size() === 0) { const w = this.waiters; this.waiters = []; w.forEach((r) => r()) }
      })
    }
  }
}

export function enqueueAudits(db: Db, queue: AuditQueue): number {
  const rows = db.prepare(
    "SELECT id FROM places WHERE web_class='own' AND website IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audits a WHERE a.place_id = places.id) ORDER BY id"
  ).all() as { id: number }[]
  for (const r of rows) queue.push(r.id)
  return rows.length
}
