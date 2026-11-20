import { useEffect, useState } from 'react'
import type { SetupState } from '../../../shared/demo/types'
import { KEY_HELP, errText } from '../lib'
import { Button } from './Button'
import { Field, SecretField, TextInput } from './Field'

interface Props {
  hasGithub: boolean
  hasCloudflare: boolean
  saveKey: (n: 'github' | 'cloudflare') => (v: string) => Promise<string | null>
}

/** Токены GitHub и Cloudflare, настройка репозитория и Worker, проверка. */
export function DemoSetup({ hasGithub, hasCloudflare, saveKey }: Props): React.JSX.Element {
  const [st, setSt] = useState<SetupState | null>(null)
  const [repo, setRepo] = useState('leadly-demos')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = (label: string, f: () => Promise<SetupState>) => async (): Promise<void> => {
    setBusy(label); setErr(null)
    try { const s = await f(); setSt(s); if (s.github.repo) setRepo(s.github.repo) } catch (e) { setErr(errText(e)) } finally { setBusy(null) }
  }
  useEffect(() => { void run('check', () => window.api.demo.setup())() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const repoOk = /^[A-Za-z0-9._-]{1,100}$/.test(repo)
  return (
    <div className="flex flex-col gap-4">
      <SecretField {...KEY_HELP.github} saved={hasGithub} onSave={saveKey('github')} />
      <Field label="Репозиторий" hint="Имя публичного репозитория на GitHub; владелец берётся из токена">
        <TextInput className="w-72 font-mono" value={repo} onChange={(e) => setRepo(e.target.value.trim())} aria-invalid={!repoOk} />
      </Field>
      <SecretField {...KEY_HELP.cloudflare} saved={hasCloudflare} onSave={saveKey('cloudflare')} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={!!busy || !hasGithub || !repoOk} onClick={run('gh', () => window.api.demo.setupGithub(repo))}>
          {busy === 'gh' ? 'Настраиваем…' : 'Настроить GitHub'}
        </Button>
        <Button variant="ghost" disabled={!!busy || !hasCloudflare} onClick={run('cf', () => window.api.demo.setupWorker())}>
          {busy === 'cf' ? 'Настраиваем…' : 'Настроить Worker'}
        </Button>
        <Button variant="ghost" disabled={!!busy} onClick={run('check', () => window.api.demo.setup())}>
          {busy === 'check' ? 'Проверяем…' : 'Проверить'}
        </Button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {st && (
        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="inline text-muted">GitHub: </dt>
            <dd className="inline">{st.github.ok
              ? <span className="text-ok">✓ {st.github.pagesUrl ?? `${st.github.owner}/${st.github.repo}`}</span>
              : <span className={st.github.error ? 'text-danger' : 'text-muted'}>{st.github.error ? errText(st.github.error) : 'не настроен'}</span>}
              {st.github.manualPages && (
                <span className="mt-1 block text-muted">Включите Pages вручную: в репозитории Settings → Pages → Deploy from branch → main / root, затем нажмите «Проверить».</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">Worker: </dt>
            <dd className="inline">{st.worker.ok
              ? <span className="text-ok">✓ {st.worker.url}</span>
              : <span className={st.worker.error ? 'text-danger' : 'text-muted'}>{st.worker.error ? errText(st.worker.error) : 'не настроен'}</span>}
              {st.worker.needSubdomain && (
                <span className="mt-1 block text-muted">Откройте Workers & Pages в панели Cloudflare и создайте поддомен workers.dev, затем снова нажмите «Настроить Worker».</span>
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
