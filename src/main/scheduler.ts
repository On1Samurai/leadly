import type { Db } from './db/db'
import { getPlace } from './db/repo'
import { rescore } from './search/rescore'
import type { Priors } from './core/scoring'
import type { TodayView } from '../shared/ipc'
import type { Place } from '../shared/types'
import { loadSettings } from './settings'
import { todayView } from './today'

export type JobKind = 'reminder' | 'digest' | 'backup' | 'noreply'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<JobKind, (payload: any, now: number) => Promise<void>>
export interface DailyCfg { digestTime: string; latestCatchUp: string }

const RETRY_MS = 30 * 60_000
const BATCH = 50
export const BACKUP_TIME = '04:00'

// Всё время — местное: локальные конструкторы Date, поэтому смена часового пояса/DST не ломает «09:00».
export function atLocal(now: number, hhmm: string, dayOffset = 0): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m, 0, 0).getTime()
}
export const startOfDay = (now: number): number => atLocal(now, '00:00')
/** Ближайший круглый час строго после now. */
export function nextHour(now: number): number {
  const d = new Date(now); d.setMinutes(60, 0, 0); return d.getTime()
}

/** Когда ставить ежедневную задачу: сегодня в `time`; уже прошло и сегодня не делали — сейчас (если до `deadline`), иначе завтра. */
export function nextDaily(now: number, time: string, doneToday: boolean, deadline?: string): number {
  const t = atLocal(now, time)
  if (doneToday) return atLocal(now, time, 1)
  if (t > now) return t
  return deadline === undefined || now < atLocal(now, deadline) ? now : atLocal(now, time, 1)
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private db: Db, private handlers: Handlers, private now: () => number,
    private cfg?: () => DailyCfg, private log: (m: string, e: unknown) => void = (m, e) => console.error(m, e)
  ) {}

  add(kind: JobKind, runAt: number, payload?: object): void {
    this.db.prepare('INSERT INTO jobs(kind,run_at,payload,done) VALUES (?,?,?,0)').run(kind, runAt, payload ? JSON.stringify(payload) : null)
  }

  private hasPending(kind: JobKind): boolean {
    return !!this.db.prepare('SELECT 1 FROM jobs WHERE kind=? AND done=0').get(kind)
  }
  private doneToday(kind: JobKind, now: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM jobs WHERE kind=? AND done=1 AND run_at>=?').get(kind, startOfDay(now))
  }

  ensureDaily(now: number, s: DailyCfg): void {
    if (!this.hasPending('digest')) this.add('digest', nextDaily(now, s.digestTime, this.doneToday('digest', now), s.latestCatchUp))
    if (!this.hasPending('backup')) this.add('backup', nextDaily(now, BACKUP_TIME, this.doneToday('backup', now)))
    if (!this.hasPending('noreply')) this.add('noreply', nextHour(now))
  }

  async tick(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const now = this.now()
      if (this.cfg) this.ensureDaily(now, this.cfg())
      const jobs = this.db.prepare('SELECT id, kind, run_at AS runAt, payload FROM jobs WHERE done=0 AND run_at<=? ORDER BY run_at, id LIMIT ?')
        .all(now, BATCH) as { id: number; kind: JobKind; runAt: number; payload: string | null }[]
      let ok = 0
      for (const j of jobs) {
        try {
          await this.handlers[j.kind](j.payload ? JSON.parse(j.payload) : {}, now)
          this.db.prepare('UPDATE jobs SET done=1 WHERE id=?').run(j.id)
          ok++
        } catch (e) {
          this.log(`job ${j.kind}#${j.id} failed`, e)
          // повтор на следующем тике, но не дольше 30 минут после run_at
          if (now - j.runAt >= RETRY_MS) this.db.prepare('UPDATE jobs SET done=1 WHERE id=?').run(j.id)
        }
      }
      return ok
    } finally { this.running = false }
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return
    const run = (): void => { this.tick().catch((e) => this.log('tick failed', e)) }
    run() // догон сразу после запуска
    this.timer = setInterval(run, intervalMs)
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null }
}

/** Пересчёт score по всем (категория, город), где есть «написали». */
// shortcut: пересчёт всех пар с written раз в час, а не только тех, где истекло noReplyDays; дёшево, но при тысячах пар заменить точечным выбором.
export function noreplyRescore(db: Db, priors: Priors, now: number): void {
  const pairs = db.prepare("SELECT DISTINCT category AS categoryId, city_id AS cityId FROM places WHERE status='written'")
    .all() as { categoryId: string; cityId: number }[]
  for (const p of pairs) rescore(db, priors, p, now)
}

export interface HandlerDeps {
  notify: { digest(v: TodayView): Promise<void>; reminder(p: Place): Promise<void> }
  backup: (now: number) => Promise<unknown>
  noreply: (now: number) => Promise<void> | void
}

export function makeHandlers(db: Db, d: HandlerDeps): Handlers {
  return {
    digest: async (_p, now) => d.notify.digest(todayView(db, now, loadSettings(db).dailyGoal)),
    // место удалено или ушло из «позже» — напоминание уже не нужно, молча считаем выполненным
    reminder: async (p: { placeId: number }) => {
      const place = getPlace(db, p.placeId)
      if (place && place.status === 'later') await d.notify.reminder(place)
    },
    backup: async (_p, now) => { await d.backup(now) },
    noreply: async (_p, now) => { await d.noreply(now) }
  }
}
