import { useEffect, useState, type ReactNode } from 'react'
import type { LicenseState, SecretName } from '../../../shared/ipc'
import { updateErrorText } from '../../../shared/update'
import type { AppSettings, NumKey, Tone } from '../../../shared/settings'
import { DEFAULT_SETTINGS, NUM_LIMITS, parseNumDraft } from '../../../shared/settings'
import { Button } from '../components/Button'
import { LicenseForm } from '../components/LicenseForm'
import { useUpdate } from '../useUpdate'
import { Field, SecretField, TextInput, inputCls } from '../components/Field'
import { CountryPicker, SellsPicker } from '../components/Pickers'
import { KEY_HELP, errText } from '../lib'

const Section = ({ title, children }: { title: string; children: ReactNode }): React.JSX.Element => (
  <section className="rounded-card border border-line bg-surface p-5">
    <h2 className="mb-4 font-semibold">{title}</h2>
    <div className="flex flex-col gap-4">{children}</div>
  </section>
)

/** Число: черновик-строка, сохранение по blur/Enter; при ошибке откат к последнему сохранённому. */
function NumField({ k, label, hint, value, onCommit, onError }: {
  k: NumKey; label: string; hint?: string; value: number; onCommit: (v: number) => void; onError: (m: string | null) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  const [local, setLocal] = useState<string | null>(null)
  useEffect(() => setDraft(String(value)), [value])
  const commit = async (): Promise<void> => {
    if (draft.trim() === String(value)) { setLocal(null); return }
    const v = parseNumDraft(draft, k)
    if (v === null) {
      setDraft(String(value))
      setLocal(`Введите целое число от ${NUM_LIMITS[k].min} до ${NUM_LIMITS[k].max.toLocaleString('ru-RU')}`)
      return
    }
    try { await window.api.settings.set({ [k]: v }); onCommit(v); setLocal(null); onError(null) } catch (e) {
      setDraft(String(value)); setLocal(errText(e))
    }
  }
  return (
    <Field label={label} hint={hint}>
      <TextInput type="text" inputMode="numeric" value={draft} className="w-28 font-mono"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      {local && <span role="alert" className="mt-1 block text-xs text-danger">{local}</span>}
    </Field>
  )
}

/** Текстовая настройка: сохраняется при уходе с поля или Enter; при ошибке возвращает прежнее значение. */
function TextSetting({ label, hint, value, onCommit, onError }: {
  label: string; hint: string; value: string; onCommit: (v: string) => Promise<void>; onError: (m: string | null) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = async (): Promise<void> => {
    const v = draft.trim()
    if (v === value) return
    try { await onCommit(v) } catch (e) { setDraft(value); onError(errText(e)) }
  }
  return (
    <Field label={label} hint={hint}>
      <TextInput className="font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </Field>
  )
}

function BotSection({ onError, tokenSaved }: { onError: (m: string | null) => void; tokenSaved: boolean }): React.JSX.Element {
  const [st, setSt] = useState<{ linked: boolean; running: boolean } | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const refresh = (): void => { window.api.bot.status().then(setSt).catch((e) => onError(errText(e))) }
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000) // привязка происходит снаружи, в Telegram
    return () => clearInterval(t)
  }, [tokenSaved]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st?.linked) setCode(null) }, [st?.linked])
  const getCode = async (): Promise<void> => {
    try { setCode(await window.api.bot.bindCode()); onError(null) } catch (e) {
      onError((e as Error).message.includes('bot_not_running') ? 'Бот не запущен: сохраните токен Telegram-бота и проверьте сеть' : errText(e))
    }
  }
  const unlink = async (): Promise<void> => {
    try { await window.api.bot.unlink(); refresh() } catch (e) { onError(errText(e)) }
  }
  return (
    <Section title="Telegram-бот">
      <p className="text-sm">{st?.linked ? 'привязан ✓' : 'не привязан'}; {st?.running ? 'запущен' : 'не запущен'}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={getCode}>Получить код привязки</Button>
        {st?.linked && <Button variant="ghost" onClick={unlink}>Отвязать</Button>}
      </div>
      {code && <p className="text-sm">Код: <code className="font-mono text-base">{code}</code>. Отправьте боту /start {code} в течение 10 минут</p>}
    </Section>
  )
}

function LicenseSection(): React.JSX.Element {
  const [lic, setLic] = useState<LicenseState | null>(null)
  const [change, setChange] = useState(false)
  useEffect(() => { window.api.license.get().then(setLic).catch(() => undefined) }, [])
  return (
    <Section title="Лицензия">
      <p className="text-sm">
        {lic?.name ? `${lic.name} · ` : ''}
        {lic?.exp ? `Активна до ${new Date(lic.exp).toLocaleDateString('ru-RU')}` : lic?.valid ? 'Бессрочная' : 'Не активирована'}
      </p>
      {change
        ? <LicenseForm onActivated={(s) => { setLic(s); setChange(false) }} />
        : <div><Button variant="ghost" onClick={() => setChange(true)}>Сменить ключ</Button></div>}
    </Section>
  )
}

function UpdateSection(): React.JSX.Element {
  const u = useUpdate()
  const [version, setVersion] = useState('…')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { window.api.app.version().then(setVersion).catch(() => undefined) }, [])
  const run = (f: () => Promise<unknown>) => async (): Promise<void> => {
    setErr(null)
    try { await f() } catch (e) { setErr(updateErrorText((e as Error).message)) }
  }
  return (
    <Section title="Обновления">
      <p className="text-sm">Версия {version}</p>
      <div className="flex flex-wrap items-center gap-3">
        {u.state === 'available' && <>
          <span className="text-sm">Доступна версия {u.version}</span>
          <Button onClick={run(() => window.api.update.download())}>Скачать</Button>
        </>}
        {u.state === 'downloading' && (
          <div className="flex w-full items-center gap-3" role="progressbar" aria-valuenow={u.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 flex-1 overflow-hidden rounded bg-line"><div className="h-full bg-fg" style={{ width: `${u.percent ?? 0}%` }} /></div>
            <span className="font-mono text-xs">{u.percent ?? 0}%</span>
          </div>)}
        {u.state === 'downloaded' && <>
          <span className="text-sm">Версия {u.version} загружена</span>
          <Button onClick={run(() => window.api.update.install())}>Перезапустить и обновить</Button>
        </>}
        {u.state !== 'downloading' && u.state !== 'downloaded' && (
          <Button variant="ghost" disabled={u.state === 'checking'} onClick={run(() => window.api.update.check())}>
            {u.state === 'checking' ? 'Проверяем…' : 'Проверить обновления'}
          </Button>)}
        {u.state === 'none' && <span className="text-sm text-muted">{u.message === 'dev' ? 'В режиме разработки обновления отключены' : 'Установлена последняя версия'}</span>}
      </div>
      {(err || u.state === 'error') && <p role="alert" className="text-sm text-danger">{err ?? updateErrorText(u.message)}</p>}
    </Section>
  )
}

export function Settings(): React.JSX.Element {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [has, setHas] = useState<Record<SecretName, boolean>>({ llm: false, anthropic: false, google: false, telegram: false, github: false, cloudflare: false })
  const [err, setErr] = useState<string | null>(null)
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.get().then(setS).catch((e) => setErr(errText(e)))
    window.api.secrets.has().then(setHas).catch((e) => setErr(errText(e)))
    window.api.app.dataDir().then(setDataDir).catch((e) => setErr(errText(e)))
  }, [])

  const patch = (p: Partial<AppSettings>): void => {
    setS((o) => ({ ...o, ...p }))
    setErr(null)
    window.api.settings.set(p).catch((e) => setErr(errText(e)))
  }
  const num = (k: NumKey, label: string, hint?: string): React.JSX.Element => (
    <NumField key={k} k={k} label={label} hint={hint} value={s[k]} onCommit={(v) => { setS((o) => ({ ...o, [k]: v })) }} onError={setErr} />
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
        {s.llmProvider === 'openai'
          ? <SecretField {...KEY_HELP.llm} saved={has.llm} onSave={saveKey('llm')} />
          : <SecretField {...KEY_HELP.anthropic} saved={has.anthropic} onSave={saveKey('anthropic')} />}
        <SecretField {...KEY_HELP.google} saved={has.google} onSave={saveKey('google')} />
        <SecretField {...KEY_HELP.telegram} saved={has.telegram} onSave={saveKey('telegram')} />
      </Section>

      <LicenseSection />
      <UpdateSection />

      <BotSection onError={setErr} tokenSaved={has.telegram} />

      <Section title="Нейросеть для текстов">
        <Field label="Сервис">
          <select className={`${inputCls} w-72`} value={s.llmProvider} onChange={(e) => patch({ llmProvider: e.target.value as 'openai' | 'anthropic' })}>
            <option value="openai">OpenAI-совместимый (AnyModel, DeepSeek)</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </Field>
        {s.llmProvider === 'openai' && <>
          <TextSetting label="Адрес API" hint="AnyModel: https://anymodel.org/v1 · DeepSeek: https://api.deepseek.com/v1" value={s.llmBaseUrl}
            onCommit={(v) => window.api.settings.set({ llmBaseUrl: v }).then(() => { setS((o) => ({ ...o, llmBaseUrl: v })); setErr(null) })} onError={setErr} />
          <TextSetting label="Модель" hint="AnyModel: ds/deepseek-v4-flash · DeepSeek напрямую: deepseek-v4-flash" value={s.llmModel}
            onCommit={(v) => window.api.settings.set({ llmModel: v }).then(() => { setS((o) => ({ ...o, llmModel: v })); setErr(null) })} onError={setErr} />
        </>}
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
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={exportDb}>Экспорт БД</Button>
          <span className="text-xs text-muted">Папка данных:</span>
          <code className="break-all font-mono text-xs text-fg">{dataDir ?? '…'}</code>
        </div>
        {note && <p className="break-all font-mono text-xs text-muted">{note}</p>}
      </Section>
    </main>
  )
}
