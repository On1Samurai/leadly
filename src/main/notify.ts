import { Notification } from 'electron'
import type { TodayView } from '../shared/ipc'
import type { Place } from '../shared/types'
import type { DemoNotice } from './demo/events'

export interface Notifier {
  digest(v: TodayView): Promise<void>
  reminder(p: Place): Promise<void>
  demo(e: DemoNotice): Promise<void>
}

export const digestText = (v: TodayView): string => `План на сегодня: написать ${v.leftToday}, ответили ${v.replied.length}`
export const reminderText = (p: Place): string => `Пора напомнить: ${p.name}`

export const demoText = (e: DemoNotice): string =>
  `${e.placeName}: ${e.kind === 'open' ? 'открыли демо' : e.kind === 'qr' ? 'открыли демо по QR' : 'нажали «Хочу так»'}`

const show = (title: string, body: string): void => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** Системные уведомления; Задача 18 добавляет бота поверх. */
export const desktopNotifier: Notifier = {
  digest: async (v) => show('Leadly', digestText(v)),
  reminder: async (p) => show('Leadly', reminderText(p)),
  demo: async (e) => show('Leadly', demoText(e))
}
