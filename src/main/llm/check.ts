import type { MessageInput } from './message'

export const MAX_LEN = 300

export function checkMessage(
  text: string, input: MessageInput
): { ok: true } | { ok: false; reason: 'too_long' | 'unknown_number' } {
  if ([...text].length > MAX_LEN) return { ok: false, reason: 'too_long' }
  const known = JSON.stringify(input)
  for (const m of text.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (!known.includes(m.replace(',', '.'))) return { ok: false, reason: 'unknown_number' }
  }
  return { ok: true }
}
