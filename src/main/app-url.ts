/** Адрес своей страницы программы: тот же index.html (file://) или тот же origin dev-сервера. Хеш и запрос не важны. */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    const u = new URL(url)
    const app = new URL(appUrl)
    // пути Windows без учёта регистра; кодирование кириллицы у Chromium и Node может отличаться
    const path = (x: URL): string => decodeURIComponent(x.pathname).toLowerCase()
    if (app.protocol === 'file:') return u.protocol === 'file:' && u.host === app.host && path(u) === path(app)
    return u.origin === app.origin
  } catch {
    return false
  }
}

/** Навигация главного окна: своё — пускаем, http(s) — во внешний браузер, прочее (файлы, data:, javascript:) — нет. */
export function navDecision(url: string, appUrl: string): 'allow' | 'external' | 'block' {
  if (isAppUrl(url, appUrl)) return 'allow'
  return /^https?:\/\//i.test(url) ? 'external' : 'block'
}
