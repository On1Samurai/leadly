/** Короткое русское сообщение об ошибке window.api. */
const LICENSE_ERRORS: Record<string, string> = {
  format: 'Ключ повреждён — скопируйте его целиком',
  signature: 'Ключ не подходит к этой программе',
  expired: 'Срок действия ключа истёк'
}

export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('bad_args')) return 'Неверные данные'
  if (m.includes('encryption_unavailable')) return 'Шифрование недоступно — ключ не сохранён'
  if (m.includes('refresh_limit')) return 'Лимит обновлений из Google на сегодня исчерпан'
  if (m.includes('refresh_running')) return 'Обновление из Google уже идёт'
  if (m.includes('license_required')) return 'Нужна лицензия: активируйте программу ключом'
  const lic = /license_invalid:(\w+)/.exec(m)
  if (lic) return LICENSE_ERRORS[lic[1]] ?? 'Ключ не принят'
  return `Ошибка: ${m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}`
}

export const SELL_OPTIONS = ['сайты', 'веб-приложения', 'SMM', 'дизайн', 'QR-меню', 'фото', 'видео']
export const COUNTRIES: { code: string; name: string; lang: 'ru' | 'uk' }[] = [
  { code: 'RU', name: 'Россия', lang: 'ru' },
  { code: 'BY', name: 'Беларусь', lang: 'ru' },
  { code: 'UA', name: 'Украина', lang: 'uk' }
]
export const KEY_HELP = {
  llm: { label: 'Ключ нейросети (AnyModel / DeepSeek)', hint: ['Нужен для текстов сообщений. По умолчанию — DeepSeek V4 Flash через AnyModel.', 'Где взять: anymodel.org → API keys (или platform.deepseek.com, тогда смените адрес и модель в настройках).'] },
  anthropic: { label: 'Ключ Anthropic', hint: ['Только если в настройках выбрана нейросеть Anthropic (Claude).', 'Где взять: console.anthropic.com → API Keys.'] },
  google: { label: 'Ключ Google Places', hint: ['Необязателен: уточняет сайт, рейтинг и телефон.', 'Где взять: Google Cloud Console → Places API (New) → ключ API.'] },
  telegram: { label: 'Токен Telegram-бота', hint: ['Необязателен: ежедневный дайджест в Telegram.', 'Где взять: в Telegram найдите @BotFather → /newbot.'] }
} as const
