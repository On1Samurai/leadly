import { percentLabel } from './percent'
import type { Status } from './types'

export interface NextActionInput {
  id: number; name: string; status: Status; remindAt: number | null; score: number
  textReady: boolean; lastIn: number | null; lastOut: number | null
}
export type NextAction = { kind: 'remind' | 'reply' | 'write'; placeId: number; line: string; button: string } | null

/** Приоритет: просроченное напоминание -> ответ без нашего ответа -> лучшее новое (с готовым текстом важнее). */
export function nextAction(items: NextActionInput[], now: number): NextAction {
  let due: NextActionInput | null = null
  for (const p of items) {
    if (p.remindAt !== null && p.remindAt <= now && (!due || p.remindAt < (due.remindAt as number))) due = p
  }
  if (due) return { kind: 'remind', placeId: due.id, line: `Напомнить: ${due.name}`, button: 'Открыть' }

  const replied = items.find((p) => p.status === 'replied' && p.lastIn !== null && p.lastIn > (p.lastOut ?? 0))
  if (replied) return { kind: 'reply', placeId: replied.id, line: `${replied.name} ответили — ответьте`, button: 'Ответить' }

  const best = (xs: NextActionInput[]): NextActionInput | undefined => xs.reduce<NextActionInput | undefined>((a, p) => (!a || p.score > a.score ? p : a), undefined)
  const fresh = items.filter((p) => p.status === 'new')
  const ready = best(fresh.filter((p) => p.textReady))
  const pick = ready ?? best(fresh)
  if (!pick) return null
  return { kind: 'write', placeId: pick.id, line: `${pick.name}: ${percentLabel(pick.score)}${pick.textReady ? ', текст готов' : ''}`, button: 'Написать' }
}
