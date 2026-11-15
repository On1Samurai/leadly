import { randomInt } from 'node:crypto'
import { Bot } from 'grammy'
import type { Db } from '../db/db'
import { getSetting, setSetting } from '../db/repo'
import { loadSettings } from '../settings'
import { todayView } from '../today'
import { decide, MAX_TRIES, type BindCode } from './auth'
import { digestFromView } from './digest'

const BIND_TTL_MS = 10 * 60_000
const RESTART_MS = 30_000
const K_CHAT = 'bot:chatId', K_CODE = 'bot:bindCode'

export const getChatId = (db: Db): number | null => getSetting<number | null>(db, K_CHAT, null)
export const unlinkChat = (db: Db): void => { db.prepare('DELETE FROM settings WHERE key IN (?,?)').run(K_CHAT, K_CODE) }

/** 6 цифр на 10 минут. */
export function newBindCode(db: Db, now: number): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  setSetting(db, K_CODE, { code, exp: now + BIND_TTL_MS } satisfies BindCode)
  return code
}

export interface BotHandle { stop(): Promise<void>; send(html: string): Promise<void>; running(): boolean }

// В логи идёт только имя/код ошибки: текст grammY может содержать URL с токеном.
const logErr = (m: string, e: unknown): void => console.error(m, (e as { error_code?: number }).error_code ?? (e as Error)?.name)

/** Long polling; без токена не вызывать. Старт не блокирует; при сбое запуска (сеть) повторяет каждые 30 с. */
export function startBot(db: Db, token: string): BotHandle {
  const bot = new Bot(token)
  let running = false, stopped = false, timer: NodeJS.Timeout | null = null

  bot.catch((e) => logErr('bot handler failed', e.error))
  bot.use(async (ctx, next) => {
    const bind = getSetting<BindCode | null>(db, K_CODE, null)
    const d = decide({ chatId: ctx.chat?.id, text: ctx.message?.text, bound: getChatId(db), bind, now: Date.now() })
    if (d === 'badcode' && bind) {
      const tries = (bind.tries ?? 0) + 1 // 5 неверных попыток гасят код
      if (tries >= MAX_TRIES) db.prepare('DELETE FROM settings WHERE key=?').run(K_CODE)
      else setSetting(db, K_CODE, { ...bind, tries })
      return
    }
    if (d === 'ignore' || d === 'badcode') return
    if (d === 'bind') {
      setSetting(db, K_CHAT, ctx.chat!.id)
      db.prepare('DELETE FROM settings WHERE key=?').run(K_CODE)
      await ctx.reply('Готово: бот привязан к Leadly.')
      return
    }
    await next()
  })
  bot.command('today', async (ctx) => {
    const now = Date.now()
    await ctx.reply(digestFromView(todayView(db, now, loadSettings(db).dailyGoal), now), { parse_mode: 'HTML' })
  })

  const run = (): void => {
    bot.start({ drop_pending_updates: true, onStart: () => { running = true } }).catch((e) => {
      running = false
      logErr('bot start failed', e)
      if (!stopped) timer = setTimeout(run, RESTART_MS)
    })
  }
  run()

  return {
    running: () => running,
    send: async (html) => {
      const chat = getChatId(db)
      if (chat !== null) await bot.api.sendMessage(chat, html, { parse_mode: 'HTML' })
    },
    stop: async () => {
      stopped = true; running = false
      if (timer) clearTimeout(timer)
      try { await bot.stop() } catch { /* не был запущен */ }
    }
  }
}

export interface BotManager {
  /** (Пере)запуск по текущему токену: старый бот останавливается; нет токена — просто стоп. */
  restart(): Promise<void>
  stop(): Promise<void>
  running(): boolean
  status(): { linked: boolean; running: boolean }
  bindCode(): string
  unlink(): void
  send(html: string): Promise<void>
  bound(): boolean
}

export function createBotManager(db: Db, getToken: () => string | null, start: (db: Db, token: string) => BotHandle = startBot): BotManager {
  let cur: BotHandle | null = null
  let chain: Promise<unknown> = Promise.resolve()
  // все restart/stop идут по очереди: два параллельных поллера дают 409
  const queue = (f: () => Promise<void>): Promise<void> => {
    const p = chain.then(f, f)
    chain = p.catch(() => undefined)
    return p
  }
  const halt = async (): Promise<void> => { const b = cur; cur = null; await b?.stop() }
  return {
    stop: () => queue(halt),
    restart: () => queue(async () => { await halt(); const t = getToken(); if (t) cur = start(db, t) }),
    running: () => cur?.running() ?? false,
    status: () => ({ linked: getChatId(db) !== null, running: cur?.running() ?? false }),
    bindCode: () => {
      if (!cur) throw new Error('bot_not_running')
      return newBindCode(db, Date.now())
    },
    unlink: () => unlinkChat(db),
    send: async (html) => { await cur?.send(html) },
    bound: () => cur !== null && getChatId(db) !== null
  }
}
