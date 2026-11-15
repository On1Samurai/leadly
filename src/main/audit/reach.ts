import type { Finding } from '../../shared/types'
import type { AuditResult } from './runner-types'

/** Почему не открылась попытка загрузки. */
export type LoadFail = 'timeout' | 'error'

// generate_204: крошечный ответ для проверки связи (так проверяет Android); google.com доступен и в РФ, и в РБ,
// а у Cloudflare в РФ бывают замедления — ложные «нет интернета» хуже.
const PROBE_URL = 'https://www.google.com/generate_204'

/** Есть ли интернет: ОС говорит «онлайн» и проба отвечает 204 (портал авторизации Wi-Fi отвечает иначе). */
export async function probeOnline(isOnline: () => boolean, fetchFn: typeof fetch = fetch, timeoutMs = 5000): Promise<boolean> {
  if (!isOnline()) return false
  try {
    const r = await fetchFn(PROBE_URL, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
    return r.status === 204
  } catch {
    return false
  }
}

/** Обе попытки не открылись: site_down только при работающем интернете, иначе offline без находок (аудит повторится). */
export function unreachableResult(online: boolean): AuditResult {
  return online
    ? { findings: [{ code: 'site_down', confirmed: true, evidence: 'сайт не открывается' }], screenshot: null, contacts: [] }
    : { findings: [], screenshot: null, contacts: [], error: 'offline' }
}

/** https упал только по таймауту, а http открылся — «нет HTTPS» не подтверждено. */
export function softenNoHttps(findings: Finding[], httpsFail: LoadFail | null): Finding[] {
  if (httpsFail !== 'timeout') return findings
  return findings.map((f) => (f.code === 'no_https' ? { ...f, confirmed: false } : f))
}
