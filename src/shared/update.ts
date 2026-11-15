import type { UpdateEvent } from './ipc'

/** Состояние обновления в UI: версия переживает события без неё (прогресс, ошибка). */
export function reduceUpdate(prev: UpdateEvent, ev: UpdateEvent): UpdateEvent {
  const keepVersion = ev.state === 'downloading' || ev.state === 'downloaded' || ev.state === 'error'
  return { ...ev, version: ev.version ?? (keepVersion ? prev.version : undefined) }
}

export const hasUpdate = (u: UpdateEvent): boolean => u.state === 'available' || u.state === 'downloaded'

const ERRORS: [RegExp, string][] = [
  [/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo/i, 'Нет связи с сервером обновлений. Проверьте интернет'],
  [/404|Cannot find latest|HttpError/i, 'Файл обновления не найден. Попробуйте позже']
]
export const updateErrorText = (msg?: string): string =>
  ERRORS.find(([re]) => re.test(msg ?? ''))?.[1] ?? 'Не удалось проверить обновления. Попробуйте позже'
