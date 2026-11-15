import type { TodayView } from '../../shared/ipc'

export interface DigestData { date: string; replied: { name: string }[]; remind: { name: string }[]; goal: number; written: number }

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Текст для Telegram (parse_mode HTML): пустые разделы не выводятся. */
export function buildDigest(d: DigestData): string {
  const list = (xs: { name: string }[]): string => xs.map((x) => escapeHtml(x.name)).join(', ')
  const text = [
    `Доброе утро. Сегодня ${escapeHtml(d.date)}`,
    d.replied.length ? `Ответили: ${list(d.replied)}` : null,
    d.remind.length ? `Напомнить: ${list(d.remind)}` : null,
    `Цель: написать ${d.goal}, уже ${d.written}`
  ].filter((l): l is string => l !== null).join('\n')
  // лимит Telegram 4096; не оставляем обрезанную HTML-сущность
  return text.length <= 4000 ? text : text.slice(0, 4000).replace(/&[a-z]*$/, '')
}

export const digestFromView = (v: TodayView, now: number): string => buildDigest({
  date: new Date(now).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
  replied: v.replied, remind: v.remindToday, goal: v.goal, written: v.written
})
