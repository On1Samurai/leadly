import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings'
import type { SecretName } from '../../../shared/ipc'
import { Button } from '../components/Button'
import { SecretField } from '../components/Field'
import { CountryPicker, SellsPicker } from '../components/Pickers'
import { KEY_HELP, errText } from '../lib'

export function Onboarding({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [has, setHas] = useState<Record<SecretName, boolean>>({ llm: false, anthropic: false, google: false, telegram: false, github: false, cloudflare: false })
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.get().then(setS).catch((e) => setErr(errText(e)))
    window.api.secrets.has().then(setHas).catch((e) => setErr(errText(e)))
  }, [])

  const patch = (p: Partial<AppSettings>): void => {
    setS((o) => ({ ...o, ...p }))
    window.api.settings.set(p).catch((e) => setErr(errText(e)))
  }
  const saveKey = (n: SecretName) => async (v: string): Promise<string | null> => {
    try {
      await window.api.secrets.set(n, v)
      setHas(await window.api.secrets.has())
      return null
    } catch (e) { return errText(e) }
  }
  const finish = async (): Promise<void> => {
    try { await window.api.settings.set({ onboarded: true }); onDone() } catch (e) { setErr(errText(e)) }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-10">
      <p className="font-mono text-xs text-muted">Шаг {step} из 3</p>
      <h1 className="text-3xl font-bold">{step === 1 ? 'Что вы продаёте?' : step === 2 ? 'В какой вы стране?' : 'Ключи'}</h1>
      <section className="rounded-card border border-line bg-surface p-6">
        {step === 1 && <SellsPicker sells={s.sells} custom={s.custom} onChange={patch} />}
        {step === 2 && <CountryPicker country={s.country} onChange={patch} />}
        {step === 3 && (
          <div className="flex flex-col gap-6">
            <SecretField {...KEY_HELP.llm} saved={has.llm} onSave={saveKey('llm')} />
            <SecretField {...KEY_HELP.google} saved={has.google} onSave={saveKey('google')} />
            <SecretField {...KEY_HELP.telegram} saved={has.telegram} onSave={saveKey('telegram')} />
          </div>
        )}
      </section>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Назад</Button>
        {step < 3
          ? <Button onClick={() => setStep(step + 1)}>Далее</Button>
          : <Button disabled={!has.llm && !has.anthropic} onClick={finish}>Готово</Button>}
      </div>
      {step === 3 && !has.llm && !has.anthropic && <p className="text-xs text-muted">Чтобы закончить, сохраните ключ нейросети. Остальные можно пропустить.</p>}
    </main>
  )
}
