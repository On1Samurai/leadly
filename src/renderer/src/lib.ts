/** Короткое русское сообщение об ошибке window.api. */
const LICENSE_ERRORS: Record<string, string> = {
  format: 'Ключ повреждён — скопируйте его целиком',
  signature: 'Ключ не подходит к этой программе',
  expired: 'Срок действия ключа истёк'
}

/** Коды демо, GitHub, Cloudflare, Worker и импорта (main бросает Error('<код>'), DemoView.error хранит голый код). */
const CODE_ERRORS: Record<string, string> = {
  demo_busy: 'Демо уже собирается или публикуется — подождите',
  demo_google_limit: 'Лимит запросов Google для демо на сегодня исчерпан',
  demo_no_content: 'Сначала соберите демо',
  demo_not_found: 'Демо не найдено',
  demo_no_tg: 'Укажите ник Telegram в настройках',
  demo_not_published: 'Демо ещё не опубликовано',
  demo_not_setup: 'Настройте GitHub и Worker в настройках',
  demo_offline: 'Нет связи с GitHub — демо с телефоном осталось бы в открытом доступе. Повторите позже',
  demo_too_many_photos: 'Не больше 20 фото в демо',
  gh_bad_token: 'GitHub: неверный токен',
  gh_no_access: 'GitHub: у токена нет прав на этот репозиторий',
  gh_not_found: 'GitHub: репозиторий не найден',
  gh_conflict: 'GitHub: конфликт изменений — повторите',
  gh_offline: 'Нет связи с GitHub',
  gh_no_repo: 'Репозиторий GitHub не настроен',
  gh_repo_locked: 'Сначала снимите с публикации все демо — иначе они останутся в старом репозитории',
  gh_pages_off: 'GitHub Pages не включён',
  gh_no_branch: 'В репозитории нет ветки main — нажмите «Настроить GitHub»',
  gh_rate_limited: 'GitHub временно ограничил запросы — повторите через несколько минут',
  gh_tree_truncated: 'Репозиторий слишком большой — создайте новый для демо',
  gh_build_failed: 'GitHub не собрал сайт — повторите',
  gh_build_timeout: 'GitHub не собрал сайт за 3 минуты — повторите',
  cf_bad_token: 'Cloudflare: неверный токен',
  cf_no_access: 'Cloudflare: у токена нет нужных прав',
  cf_no_subdomain: 'Cloudflare: нет поддомена workers.dev',
  cf_offline: 'Нет связи с Cloudflare',
  cf_bad_response: 'Cloudflare ответил неожиданно — повторите',
  worker_offline: 'Worker не отвечает',
  worker_bad_response: 'Worker ответил неожиданно — настройте его заново',
  bad_image: 'Не удалось прочитать картинку — используйте JPG или PNG',
  google_auth: 'Google не принял ключ',
  google_unavailable: 'Google недоступен — попробуйте позже',
  import_bad_path: 'В сайте недопустимые пути к файлам',
  import_bad_type: 'В сайте файл недопустимого типа',
  import_no_index: 'В корне сайта нет index.html',
  import_too_big: 'Сайт больше 20 МБ',
  import_too_many: 'В сайте больше 200 файлов',
  slug_exhausted: 'Не удалось подобрать адрес демо',
  interrupted: 'Публикация прервалась — опубликуйте ещё раз',
  no_github_token: 'Сохраните токен GitHub',
  no_cloudflare_token: 'Сохраните токен Cloudflare',
  no_google_key: 'Нужен ключ Google',
  no_google_id: 'Заведение не найдено в Google'
}

export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const code = m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '').trim()
  if (CODE_ERRORS[code]) return CODE_ERRORS[code]
  const http = /^(?:gh|cf|worker)_http_(\d+)$/.exec(code)
  if (http) return `Ошибка сервиса (${http[1]})`
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
  telegram: { label: 'Токен Telegram-бота', hint: ['Необязателен: ежедневный дайджест в Telegram.', 'Где взять: в Telegram найдите @BotFather → /newbot.'] },
  github: { label: 'Токен GitHub', hint: ['Для публикации демо на GitHub Pages.', 'Где взять: GitHub → Settings → Developer settings → Fine-grained tokens; только репозиторий leadly-demos, права в «Помощи».'] },
  cloudflare: { label: 'Токен Cloudflare', hint: ['Для счётчика открытий и QR-ссылок (Worker).', 'Где взять: Cloudflare → My Profile → API Tokens; права Workers Scripts: Edit, D1: Edit, Account Settings: Read.'] }
} as const
