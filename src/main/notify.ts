import { Notification } from 'electron'
import type { TodayView } from '../shared/ipc'
import type { Place } from '../shared/types'

export interface Notifier {
  digest(v: TodayView): Promise<void>
  reminder(p: Place): Promise<void>
}

export const digestText = (v: TodayView): string => `План на сегодня: написать ${v.leftToday}, ответили ${v.replied.length}`
export const reminderText = (p: Place): string => `Пора напомнить: ${p.name}`

const show = (title: string, body: string): void => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** Системные уведомления; Задача 18 добавляет бота поверх. */
export const desktopNotifier: Notifier = {
  digest: async (v) => show('Leadly', digestText(v)),
  reminder: async (p) => show('Leadly', reminderText(p))
}
