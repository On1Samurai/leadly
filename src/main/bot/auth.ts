export interface BindCode { code: string; exp: number }
export type Decision = 'allow' | 'bind' | 'ignore'

/** Кто может говорить с ботом: привязанный чат; любой чат — только с верным неистёкшим кодом в `/start КОД`. */
export function decide(a: { chatId: number | undefined; text: string | undefined; bound: number | null; bind: BindCode | null; now: number }): Decision {
  if (a.chatId === undefined) return 'ignore'
  const m = /^\/start\s+(\d{6})\s*$/.exec(a.text ?? '')
  if (m && a.bind && a.now <= a.bind.exp && m[1] === a.bind.code) return 'bind'
  return a.bound !== null && a.chatId === a.bound ? 'allow' : 'ignore'
}
