/** Короткое русское сообщение об ошибке window.api. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('bad_args')) return 'Неверные данные'
  if (m.includes('encryption_unavailable')) return 'Шифрование недоступно — ключ не сохранён'
  return `Ошибка: ${m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}`
}

export const SELL_OPTIONS = ['сайты', 'веб-приложения', 'SMM', 'дизайн', 'QR-меню', 'фото', 'видео']
export const COUNTRIES: { code: string; name: string; lang: 'ru' | 'uk' }[] = [
  { code: 'RU', name: 'Россия', lang: 'ru' },
  { code: 'BY', name: 'Беларусь', lang: 'ru' },
  { code: 'UA', name: 'Украина', lang: 'uk' }
]
export const KEY_HELP = {
  anthropic: { label: 'Ключ Anthropic', hint: ['Нужен для текстов сообщений.', 'Где взять: console.anthropic.com → API Keys.'] },
  google: { label: 'Ключ Google Places', hint: ['Необязателен: уточняет сайт, рейтинг и телефон.', 'Где взять: Google Cloud Console → Places API (New) → ключ API.'] },
  telegram: { label: 'Токен Telegram-бота', hint: ['Необязателен: ежедневный дайджест в Telegram.', 'Где взять: в Telegram найдите @BotFather → /newbot.'] }
} as const
