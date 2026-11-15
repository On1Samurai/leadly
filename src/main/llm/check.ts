import type { MessageInput } from './message'

export const MAX_LEN = 300
export type CheckReason = 'too_long' | 'unknown_number' | 'empty' | 'link'

const NUM = /\d+(?:[.,]\d+)?/g
// «1 200» -> «1200»
const collapse = (s: string): string => s.replace(/(\d)[ \u00a0](?=\d{3}(?!\d))/g, '$1')
const numbers = (s: string): string[] => (collapse(s).match(NUM) ?? []).map((n) => n.replace(',', '.'))

export function checkMessage(text: string, input: MessageInput): { ok: true } | { ok: false; reason: CheckReason } {
  if (text.trim() === '') return { ok: false, reason: 'empty' }
  if ([...text].length > MAX_LEN) return { ok: false, reason: 'too_long' }
  if (/https?:|www\./i.test(text)) return { ok: false, reason: 'link' }
  const known = new Set(numbers(JSON.stringify(input)))
  for (const n of numbers(text)) if (!known.has(n)) return { ok: false, reason: 'unknown_number' }
  return { ok: true }
}
