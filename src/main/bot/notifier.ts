import type { Notifier } from '../notify'
import { digestFromView, escapeHtml } from './digest'

export interface BotNotifierDeps {
  send(html: string): Promise<void>
  bound(): boolean
  unlink(): void
  desktop: Notifier
  log(m: string, e: unknown): void
  now?: () => number
}

/** Дайджест: бот, если привязан, иначе системное уведомление. Напоминание: и бот, и системное. */
export function botNotifier(d: BotNotifierDeps): Notifier {
  const now = d.now ?? Date.now
  // true: доставлено ботом. 403 (пользователь заблокировал бота) — отвязываем и не бросаем; прочее бросаем, планировщик повторит.
  const viaBot = async (html: string): Promise<boolean> => {
    if (!d.bound()) return false
    try { await d.send(html); return true } catch (e) {
      if ((e as { error_code?: number }).error_code !== 403) throw e
      d.log('bot blocked by user, unlinking', (e as Error).message)
      d.unlink()
      return false
    }
  }
  return {
    digest: async (v) => { if (!(await viaBot(digestFromView(v, now())))) await d.desktop.digest(v) },
    reminder: async (p) => { await viaBot(`Пора напомнить: ${escapeHtml(p.name)}`); await d.desktop.reminder(p) }
  }
}
