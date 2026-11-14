import { useEffect, useState, type ReactNode } from 'react'
import type { SecretName } from '../../../shared/ipc'
import type { AppSettings, Tone } from '../../../shared/settings'
import { DEFAULT_SETTINGS } from '../../../shared/settings'
import { Button } from '../components/Button'
import { Field, SecretField, TextInput, inputCls } from '../components/Field'
import { CountryPicker, SellsPicker } from '../components/Pickers'
import { KEY_HELP, errText } from '../lib'

const Section = ({ title, children }: { title: string; children: ReactNode }): React.JSX.Element => (
  <section className="rounded-card border border-line bg-surface p-5">
    <h2 className="mb-4 font-semibold">{title}</h2>
    <div className="flex flex-col gap-4">{children}</div>
  </section>
)

export function Settings(): React.JSX.Element {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [has, setHas] = useState<Record<SecretName, boolean>>({ anthropic: false, google: false, telegram: false })
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.get().then(setS).catch((e) => setErr(errText(e)))
    window.api.secrets.has().then(setHas).catch((e) => setErr(errText(e)))
  }, [])

  const patch = (p: Partial<AppSettings>): void => {
    setS((o) => ({ ...o, ...p }))
    setErr(null)
    window.api.settings.set(p).catch((e) => setErr(errText(e)))
  }
  const num = (k: 'densityThreshold' | 'nextPageThreshold' | 'randomEvery' | 'googleBudget' | 'dailyWriteLimit' | 'dailyGoal' | 'noReplyDays', label: string, hint?: string): React.JSX.Element => (
    <Field label={label} hint={hint}>
      <TextInput type="number" min={0} step={1} value={s[k]} className="w-28 font-mono"
        onChange={(e) => { const v = Math.floor(Number(e.target.value)); if (Number.isFinite(v) && v >= 0) patch({ [k]: v }) }} />
    </Field>
  )
  const saveKey = (n: SecretName) => async (v: string): Promise<string | null> => {
    try { await window.api.secrets.set(n, v); setHas(await window.api.secrets.has()); return null } catch (e) { return errText(e) }
  }
  const exportDb = async (): Promise<void> => {
    try { const p = await window.api.backup.export(); setNote(p ? `Сохранено: ${p}` : null) } catch (e) { setErr(errText(e)) }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-8">
      <h1 className="text-2xl font-bold">Настройки</h1>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      <Section title="Ключи">
        <SecretField {...KEY_HELP.anthropic} saved={has.anthropic} onSave={saveKey('anthropic')} />
        <SecretField {...KEY_HELP.google} saved={has.google} onSave={saveKey('google')} />
        <SecretField {...KEY_HELP.telegram} saved={has.telegram} onSave={saveKey('telegram')} />
      </Section>

      <Section title="Что продаю">
        <SellsPicker sells={s.sells} custom={s.custom} onChange={patch} />
      </Section>

      <Section title="Страна и сообщения">
        <CountryPicker country={s.country} onChange={patch} />
        <Field label="Язык сообщений">
          <select className={`${inputCls} w-48`} value={s.lang} onChange={(e) => patch({ lang: e.target.value as 'ru' | 'uk' })}>
            <option value="ru">Русский</option>
            <option value="uk">Украинский</option>
          </select>
        </Field>
        <Field label="Тон сообщений">
          <select className={`${inputCls} w-48`} value={s.tone} onChange={(e) => patch({ tone: e.target.value as Tone })}>
            <option value="business">Деловой</option>
            <option value="friendly">Дружелюбный</option>
            <option value="short">Короткий</option>
          </select>
        </Field>
      </Section>

      <Section title="Поиск">
        <Field label="Размер квадрата">
          <select className={`${inputCls} w-48`} value={s.sizeKm} onChange={(e) => patch({ sizeKm: Number(e.target.value) as 0.5 | 1 | 2 })}>
            <option value={0.5}>0,5 км</option>
            <option value={1}>1 км</option>
            <option value={2}>2 км</option>
          </select>
        </Field>
        {num('densityThreshold', 'Порог плотности OSM', 'Сколько мест из OSM в квадрате, чтобы считать его плотным')}
        {num('nextPageThreshold', 'Порог следующей страницы Google', 'Сколько новых мест нужно, чтобы просить следующую страницу')}
        {num('randomEvery', 'Каждый N-й квадрат случайный')}
        {num('googleBudget', 'Бюджет запросов Google на проход')}
      </Section>

      <Section title="Работа">
        {num('dailyWriteLimit', 'Дневной лимит «Написать»', 'Не больше этого числа сообщений в день, чтобы не попасть под спам-фильтры')}
        {num('dailyGoal', 'Цель дня')}
        {num('noReplyDays', 'Через сколько дней напомнить, если нет ответа')}
        <Field label="Время дайджеста">
          <TextInput type="time" value={s.digestTime} className="w-32 font-mono" onChange={(e) => e.target.value && patch({ digestTime: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.autostart} onChange={(e) => patch({ autostart: e.target.checked })} /> Запускать вместе с Windows
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.runInBackground} onChange={(e) => patch({ runInBackground: e.target.checked })} /> Работать в фоне после закрытия окна
        </label>
      </Section>

      <Section title="Данные">
        <div><Button variant="ghost" onClick={exportDb}>Экспорт БД</Button></div>
        {note && <p className="break-all font-mono text-xs text-muted">{note}</p>}
      </Section>
    </main>
  )
}
