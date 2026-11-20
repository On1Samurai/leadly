import { demoText, type Notifier } from '../notify'
import { digestFromView, escapeHtml } from './digest'

export interface BotNotifierDeps {
  send(html: string): Promise<void>
  bound(): boolean
  unlink(): void
  desktop: Notifier
  log(m: string, e: unknown): void
  now?: () => number
}

/** Ошибка без текста grammY/fetch: он может содержать URL с токеном. */
export class BotSendError extends Error {
  constructor(public code: number | string) { super(`bot_send_failed:${code}`) }
}
const wrap = (e: unknown): BotSendError =>
  new BotSendError((e as { error_code?: number }).error_code ?? (e as Error)?.name ?? 'unknown')

/** Дайджест: бот, если привязан, иначе (или если бот недоступен) системное уведомление. Напоминание: системное всегда, плюс бот. */
export function botNotifier(d: BotNotifierDeps): Notifier {
  const now = d.now ?? Date.now
  const shownReminders = new Set<string>() // shortcut: в памяти, после перезапуска напомнит ещё раз
  let digestShownOn = ''
  // true: доставлено ботом. 403 (бот заблокирован) — отвязываем, false. Прочее — BotSendError.
  const viaBot = async (html: string): Promise<boolean> => {
    if (!d.bound()) return false
    try { await d.send(html); return true } catch (e) {
      const err = wrap(e)
      d.log('bot send failed', err.message)
      if (err.code !== 403) throw err
      d.unlink()
      return false
    }
  }
  return {
    digest: async (v) => {
      let ok = false
      try { ok = await viaBot(digestFromView(v, now())) } catch { /* сеть: показываем локально, без повтора */ }
      if (ok) return
      const day = new Date(now()).toDateString()
      if (digestShownOn === day) return
      digestShownOn = day
      await d.desktop.digest(v)
    },
    reminder: async (p) => {
      const k = `${p.id}:${p.remindAt}`
      if (!shownReminders.has(k)) { shownReminders.add(k); await d.desktop.reminder(p) }
      await viaBot(`Пора напомнить: ${escapeHtml(p.name)}`)
    },
    demo: async (e) => {
      let ok = false
      try { ok = await viaBot(escapeHtml(demoText(e))) } catch { /* сеть: показываем локально */ }
      if (!ok) await d.desktop.demo(e)
    }
  }
}
