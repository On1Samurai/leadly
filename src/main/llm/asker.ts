import type { AppSettings } from '../../shared/settings'
import type { IpcDeps } from '../ipc/define'
import { getSecret } from '../secrets'
import { anthropicAsker, openaiAsker, type Asker } from './message'

/** Клиент ИИ по настройке провайдера; null — ключа нет. */
export function askerFor(d: Pick<IpcDeps, 'db' | 'secretEnv' | 'anthropicFactory'>, s: AppSettings): Asker | null {
  if (s.llmProvider === 'anthropic') {
    const key = getSecret(d.db, 'anthropic', d.secretEnv)
    return key ? anthropicAsker(d.anthropicFactory(key)) : null
  }
  const key = getSecret(d.db, 'llm', d.secretEnv)
  return key ? openaiAsker({ baseUrl: s.llmBaseUrl, apiKey: key, model: s.llmModel }) : null
}
