import { describe, expect, it } from 'vitest'
import { errText } from '../src/renderer/src/lib'

const CODES = [
  'demo_busy', 'demo_google_limit', 'demo_no_content', 'demo_not_found', 'demo_no_tg', 'demo_not_published', 'demo_not_setup',
  'demo_offline', 'demo_too_many_photos', 'gh_bad_token', 'gh_no_access', 'gh_not_found', 'gh_conflict', 'gh_offline', 'gh_no_repo',
  'gh_pages_off', 'gh_build_failed', 'gh_build_timeout', 'cf_bad_token', 'cf_no_access', 'cf_no_subdomain', 'cf_offline',
  'worker_offline', 'worker_bad_response', 'google_auth', 'google_unavailable', 'import_bad_path', 'import_bad_type',
  'import_no_index', 'import_too_big', 'import_too_many', 'slug_exhausted', 'interrupted', 'gh_repo_locked'
]

describe('errText: коды демо', () => {
  it.each(CODES)('%s -> русский текст, не «Ошибка: код»', (code) => {
    const t = errText(new Error(code))
    expect(t).not.toMatch(/^Ошибка:/)
    expect(t).not.toContain(code)
  })
  it('код из ошибки IPC', () => {
    expect(errText(new Error("Error invoking remote method 'demo.publish': Error: demo_no_tg"))).toBe(errText(new Error('demo_no_tg')))
  })
  it('голый код из DemoView.error (строка)', () => {
    expect(errText('gh_build_failed')).toBe(errText(new Error('gh_build_failed')))
  })
  it('gh_http_<n> / cf_http_<n> / worker_http_<n> -> «Ошибка сервиса (n)»', () => {
    expect(errText(new Error('gh_http_502'))).toBe('Ошибка сервиса (502)')
    expect(errText(new Error("Error invoking remote method 'demo.publish': Error: cf_http_500"))).toBe('Ошибка сервиса (500)')
    expect(errText('worker_http_429')).toBe('Ошибка сервиса (429)')
  })
  it('demo_offline и gh_repo_locked — точные тексты', () => {
    expect(errText(new Error('demo_offline'))).toBe('Нет связи с GitHub — демо с телефоном осталось бы в открытом доступе. Повторите позже')
    expect(errText('gh_repo_locked')).toBe('Сначала снимите с публикации все демо — иначе они останутся в старом репозитории')
  })
  it('gh_rate_limited и bad_image — точные тексты', () => {
    expect(errText('gh_rate_limited')).toBe('GitHub временно ограничил запросы — повторите через несколько минут')
    expect(errText(new Error("Error invoking remote method 'demo.photoAdd': Error: bad_image"))).toBe('Не удалось прочитать картинку — используйте JPG или PNG')
  })
  it('неизвестный код как раньше', () => {
    expect(errText(new Error('boom'))).toBe('Ошибка: boom')
  })
})
