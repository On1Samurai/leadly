import type { Db } from './db/db'
import { getPlace, getSetting } from './db/repo'
import { rescore } from './search/rescore'
import type { Priors } from './core/scoring'
import type { TodayView } from '../shared/ipc'
import type { Place } from '../shared/types'
import { loadSettings } from './settings'
import { todayView } from './today'
import { atLocal, nextHour, startOfDay } from './time'

export { atLocal, nextHour, startOfDay }

export type JobKind = 'reminder' | 'digest' | 'backup' | 'noreply' | 'demo_events' | 'rescore'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<JobKind, (payload: any, now: number) => Promise<void>>
export interface DailyCfg { digestTime: string; latestCatchUp: string }

const RETRY_MS = 30 * 60_000
const BATCH = 50
const DEMO_EVENTS_MS = 5 * 60_000
const BACKUP_COOLDOWN_MS = 60 * 60_000
export const BACKUP_TIME = '04:00'

/** Когда ставить ежедневную задачу: сегодня в `time`; уже прошло и сегодня не делали — сейчас (если до `deadline`), иначе завтра. */
export function nextDaily(now: number, time: string, doneToday: boolean, deadline?: string): number {
  const t = atLocal(now, time)
  if (doneToday) return atLocal(now, time, 1)
  if (t > now) return t
  return deadline === undefined || now < atLocal(now, deadline) ? now : atLocal(now, time, 1)
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private inflight: Promise<number> | null = null

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
    // брошенные (dropped) и пропущенные задачи не считаются выполненными; день — по времени завершения, не по run_at
    return !!this.db.prepare(
      "SELECT 1 FROM jobs WHERE kind=? AND done=1 AND done_at>=? AND done_at<? AND COALESCE(json_extract(payload,'$.dropped'),0)=0"
    ).get(kind, startOfDay(now), atLocal(now, '00:00', 1))
  }

  /** После брошенного бэкапа следующая попытка не раньше чем через час, иначе он ставится заново на каждом тике. */
  private backupCooldownEnd(): number {
    const r = this.db.prepare(
      "SELECT MAX(done_at) AS t FROM jobs WHERE kind='backup' AND done=1 AND COALESCE(json_extract(payload,'$.dropped'),0)=1"
    ).get() as { t: number | null }
    return r.t === null ? 0 : r.t + BACKUP_COOLDOWN_MS
  }

  ensureDaily(now: number, s: DailyCfg): void {
    if (!this.hasPending('digest')) this.add('digest', nextDaily(now, s.digestTime, this.doneToday('digest', now), s.latestCatchUp))
    if (!this.hasPending('backup')) this.add('backup', Math.max(nextDaily(now, BACKUP_TIME, this.doneToday('backup', now)), this.backupCooldownEnd()))
    if (!this.hasPending('noreply')) this.add('noreply', nextHour(now))
    if (!this.hasPending('rescore')) this.add('rescore', nextHour(now))
    if (!this.hasPending('demo_events') && getSetting(this.db, 'demo:worker', null)) this.add('demo_events', now)
  }

  private finish(id: number, now: number, dropped: boolean): void {
    this.db.prepare(
      "UPDATE jobs SET done=1, done_at=?, payload=CASE WHEN ? THEN json_set(COALESCE(payload,'{}'),'$.dropped',json('true')) ELSE payload END WHERE id=?"
    ).run(now, dropped ? 1 : 0, id)
  }

  /** Просроченный дайджест после дедлайна и повторный дайджест/бэкап за день не выполняем. */
  private skip(j: { kind: JobKind; runAt: number }, now: number): boolean {
    if (j.kind === 'digest' && now >= atLocal(now, this.cfg?.().latestCatchUp ?? '12:00') && j.runAt < atLocal(now, this.cfg?.().latestCatchUp ?? '12:00')) return true
    return (j.kind === 'digest' || j.kind === 'backup') && this.doneToday(j.kind, now)
  }

  tick(): Promise<number> {
    if (this.inflight) return Promise.resolve(0)
    const p = this.runTick().finally(() => { this.inflight = null })
    this.inflight = p
    return p
  }

  private async runTick(): Promise<number> {
    const now = this.now()
    if (this.cfg) this.ensureDaily(now, this.cfg())
    const jobs = this.db.prepare('SELECT id, kind, run_at AS runAt, payload FROM jobs WHERE done=0 AND run_at<=? ORDER BY run_at, id LIMIT ?')
      .all(now, BATCH) as { id: number; kind: JobKind; runAt: number; payload: string | null }[]
    let ok = 0
    for (const j of jobs) {
      if (this.skip(j, now)) { this.finish(j.id, now, true); continue }
      try {
        await this.handlers[j.kind](j.payload ? JSON.parse(j.payload) : {}, now)
        this.finish(j.id, now, false)
        ok++
      } catch (e) {
        this.log(`job ${j.kind}#${j.id} failed`, e)
        // повтор на следующем тике, но не дольше 30 минут после run_at
        if (now - j.runAt >= RETRY_MS) this.finish(j.id, now, true)
      }
    }
    if (this.cfg) this.ensureDaily(now, this.cfg()) // следующие задачи сразу, без ожидания тика
    return ok
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return
    const run = (): void => { this.tick().catch((e) => this.log('tick failed', e)) }
    run() // догон сразу после запуска
    this.timer = setInterval(run, intervalMs)
  }
  /** Останавливает таймер и ждёт текущий тик (не дольше 10 с), чтобы БД не закрылась под ним. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!this.inflight) return
    let t: NodeJS.Timeout
    const limit = new Promise<void>((r) => { t = setTimeout(r, 10_000) })
    await Promise.race([this.inflight.then(() => undefined, () => undefined), limit])
    clearTimeout(t!)
  }
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
  demoEvents: (now: number) => Promise<void>
  rescore: (now: number) => Promise<void> | void
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
    noreply: async (_p, now) => { await d.noreply(now) },
    rescore: async (_p, now) => { await d.rescore(now) },
    demo_events: async (_p, now) => {
      if (!getSetting(db, 'demo:worker', null)) return
      await d.demoEvents(now)
      // текущая задача ещё не закрыта (run_at <= now), поэтому ищем только будущие
      if (!db.prepare("SELECT 1 FROM jobs WHERE kind='demo_events' AND done=0 AND run_at>?").get(now))
        db.prepare("INSERT INTO jobs(kind,run_at,payload,done) VALUES ('demo_events',?,NULL,0)").run(now + DEMO_EVENTS_MS)
    }
  }
}
