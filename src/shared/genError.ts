/** Ошибка message.generate (через IPC доходит только текст) -> понятная русская строка. */
export function genErrorText(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
  if (m.includes('no_anthropic_key')) return 'Добавьте ключ Anthropic в настройках'
  if (m.includes('Claude отказался отвечать')) return 'Claude отказался писать этот текст — напишите сами'
  if (m.includes('Текст не прошёл проверку')) return 'Не удалось получить корректный текст — попробуйте ещё раз'
  return `Ошибка Claude: ${m}`
}
