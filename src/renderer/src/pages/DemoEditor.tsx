import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DemoContent, DemoCta, DemoView, SetupState } from '../../../shared/demo/types'
import { addItem, canPublish, ctaValid, movePhoto, removeItem, removePhoto, setItem, toggleReview } from '../../../shared/demo/edit'
import { Button } from '../components/Button'
import { Field, TextInput, inputCls } from '../components/Field'
import { DEMO_STATUS_LABEL, POSTCARD_HINT } from '../labels'
import { draftQueue } from '../draft-save'
import { errText } from '../lib'
import { useNav } from '../nav'

const CTA: [DemoCta['kind'], string, string][] = [
  ['call', 'Позвонить', 'tel:+7…'], ['route', 'Как добраться', 'https://… — ссылка на карту'], ['book', 'Записаться', 'https://… или tel:…']
]
const areaCls = `${inputCls} min-h-20 resize-y`

/** Полноэкранный редактор демо: форма слева, превью в рамке телефона справа. */
export function DemoEditor({ placeId }: { placeId: number }): React.JSX.Element {
  const { navigate } = useNav()
  const [v, setV] = useState<DemoView | null>(null)
  const [c, setC] = useState<DemoContent | null>(null)
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [tg, setTg] = useState('')
  const [html, setHtml] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [save, setSave] = useState<'idle' | 'pending' | 'saved'>('idle')
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const saveTimer = useRef<number>(0)
  const previewReq = useRef(0)

  useEffect(() => {
    window.api.demo.get(placeId).then((x) => { setV(x); setC(x?.content ?? null) }).catch((e) => setErr(errText(e)))
    window.api.demo.setup().then(setSetup).catch(() => setSetup({ github: { ok: false }, worker: { ok: false } }))
    window.api.settings.get().then((s) => setTg(s.demoTg)).catch(() => undefined)
  }, [placeId])

  const saver = useMemo(() => draftQueue<DemoContent>((x) => window.api.demo.save(placeId, x), {
    ok: (idle) => { setSaveErr(null); if (idle) setSave('saved') },
    fail: (e) => setSaveErr(errText(e))
  }), [placeId])
  /** Отправляет отложенное сохранение сразу («Сохранить», перед действиями, уход с экрана), дождавшись начатого. false — не сохранилось. */
  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(saveTimer.current)
    return saver.flush()
  }, [saver])
  // уход со страницы размонтирует редактор: черновик не теряется
  useEffect(() => () => { void flush() }, [flush])

  // превью: тот же DemoPage, что и на сайте; 300 мс после последней правки
  useEffect(() => {
    if (!c || !ctaValid(c)) return
    const r = ++previewReq.current
    const t = window.setTimeout(() => {
      window.api.demo.preview(placeId, c).then((h) => { if (r === previewReq.current) setHtml(h) }).catch((e) => setErr(errText(e)))
    }, 300)
    return () => window.clearTimeout(t)
  }, [c, placeId])

  const edit = (next: DemoContent): void => {
    setC(next)
    if (!ctaValid(next)) return // поле подсветит ошибку; сохраним, когда ссылка станет верной
    setSave('pending')
    saver.put(next)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void flush() }, 1000)
  }
  const set = <K extends keyof DemoContent>(k: K, val: DemoContent[K]): void => { if (c) edit({ ...c, [k]: val }) }

  const act = async (label: string, f: () => Promise<void>): Promise<void> => {
    setBusy(label); setErr(null); setNote(null)
    try { if (await flush()) await f() } catch (e) {
      if (!String((e as Error)?.message ?? e).includes('cancelled')) setErr(errText(e))
    } finally { setBusy(null) }
  }
  const view = (x: DemoView): void => { setV(x); if (x.error) setErr(errText(x.error)) } // и снятое демо, у которого Worker не удалил цель

  if (err && !v) return <main className="px-8 py-6"><p role="alert" className="text-sm text-danger">{err}</p></main>
  if (!v) return <main className="px-8 py-6"><p className="text-sm text-muted">Загрузка…</p></main>

  const can = setup ? canPublish(v, setup, tg) : { ok: false as const, why: 'Проверяем настройку…' }
  const published = v.status === 'published'
  const status = busy === 'publish' ? 'Публикуется…' : DEMO_STATUS_LABEL[v.status]
  // неверная ссылка: черновик не сохраняется, действия с содержимым взяли бы прежнюю версию
  const linkBad = v.kind === 'template' && c !== null && !ctaValid(c)
  const saveLabel = linkBad || saveErr ? 'Не сохранено' : save === 'pending' ? 'Сохраняем…' : save === 'saved' ? 'Сохранено' : ''

  return (
    <main className="flex flex-col gap-4 px-8 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('demos')}>← Все демо</Button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">{c?.name ?? 'Демо'}</h1>
        <span className="font-mono text-xs text-muted" role="status">{status}{saveLabel ? ` · ${saveLabel}` : ''}</span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {v.kind === 'template' && <Button variant="ghost" disabled={!!busy || linkBad} onClick={() => void flush()}>Сохранить</Button>}
        {v.kind === 'template' && <Button variant="ghost" disabled={!!busy || linkBad} onClick={() => act('rewrite', async () => { const x = await window.api.demo.rewrite(placeId); setC(x) })}>
          {busy === 'rewrite' ? 'Переписываем…' : 'Переписать текст ИИ'}
        </Button>}
        <Button disabled={!!busy || !can.ok || linkBad} onClick={() => act('publish', async () => view(await window.api.demo.publish(placeId)))}>
          {busy === 'publish' ? 'Публикуется…' : 'Опубликовать'}
        </Button>
        {published && <>
          <Button variant="ghost" disabled={!!busy} onClick={() => act('open', () => window.api.demo.openLive(placeId))}>Открыть</Button>
          <Button variant="ghost" disabled={!!busy || linkBad} onClick={() => act('postcard', async () => {
            const p = await window.api.demo.postcard([placeId])
            if (p) setNote(`Сохранено: ${p}`)
          })}>Открытка</Button>
        </>}
        {(published || v.status === 'error') && <Button variant="ghost" disabled={!!busy} onClick={() => act('unpublish', async () => view(await window.api.demo.unpublish(placeId)))}>
          {busy === 'unpublish' ? 'Снимаем…' : 'Снять с публикации'}
        </Button>}
      </div>
      {!can.ok && (
        <p className="text-sm text-muted">
          {can.why}. <button type="button" className="cursor-pointer underline hover:text-fg" onClick={() => navigate('settings')}>Открыть настройки</button>
        </p>
      )}
      {linkBad && <p className="text-sm text-muted">Исправьте ссылку кнопки действия</p>}
      {saveErr && <p role="alert" className="text-sm text-danger">Черновик не сохранён: {saveErr}</p>}
      {published && v.url && <p className="break-all font-mono text-xs text-muted">{v.url}</p>}
      {published && <p className="text-xs text-muted">{POSTCARD_HINT}</p>}
      {note && <p role="status" className="break-all text-sm text-muted">{note}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-80 flex-1 flex-col gap-4">
          {v.kind === 'import'
            ? <ImportPanel v={v} busy={!!busy} onBadge={(on) => act('badge', async () => setV(await window.api.demo.setImportBadge(placeId, on)))} />
            : c && <Form c={c} edit={edit} set={set} busy={!!busy || linkBad} locked={busy === 'publish' || busy === 'rewrite'}
              onPhotoAdd={() => act('photo', async () => { const x = await window.api.demo.photoAdd(placeId); setC(x) })} />}
          <section aria-label="Импорт своего сайта" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-sm">
            <h2 className="font-semibold">Импортировать свой сайт</h2>
            <p className="text-xs text-muted">Заменит шаблон вашим сайтом: папка с index.html, ZIP-архив или один HTML-файл.</p>
            <div className="flex flex-wrap gap-2">
              {([['folder', 'Папка'], ['zip', 'ZIP'], ['html', 'HTML']] as const).map(([k, l]) => (
                <Button key={k} variant="ghost" disabled={!!busy || linkBad} onClick={() => act('import', async () => {
                  const x = await window.api.demo.importSite(placeId, k)
                  setV(x); setC(x.content)
                })}>{l}</Button>
              ))}
            </div>
          </section>
        </div>

        {v.kind === 'template' && (
          <figure aria-label="Превью на телефоне" className="sticky top-6 shrink-0 rounded-[2.5rem] border border-line bg-surface p-3">
            <iframe title="Превью демо" sandbox="" srcDoc={html} className="block h-[780px] w-[390px] rounded-[2rem] bg-white" />
          </figure>
        )}
      </div>
    </main>
  )
}

function ImportPanel({ v, busy, onBadge }: { v: DemoView; busy: boolean; onBadge: (on: boolean) => void }): React.JSX.Element {
  return (
    <section aria-label="Импортированный сайт" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 text-sm">
      <h2 className="font-semibold">Ваш сайт</h2>
      <p className="text-muted">Демо — импортированный сайт. Перед публикацией в него добавятся счётчик открытий и кнопка «Хочу так».</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.importBadge} disabled={busy} onChange={(e) => onBadge(e.target.checked)} /> Сайт сделал @ник
      </label>
    </section>
  )
}

interface FormProps {
  c: DemoContent; busy: boolean
  /** публикация или ИИ: ответ ИИ не должен затереть то, что сейчас печатают */
  locked: boolean
  edit: (c: DemoContent) => void
  set: <K extends keyof DemoContent>(k: K, v: DemoContent[K]) => void
  onPhotoAdd: () => void
}

function Form({ c, busy, locked, edit, set, onPhotoAdd }: FormProps): React.JSX.Element {
  const box = 'flex flex-col gap-3 rounded-card border border-line bg-surface p-4 text-sm'
  const cta = CTA.find(([k]) => k === c.cta.kind) ?? CTA[0]
  const okLink = ctaValid(c)
  // смена вида — цель по умолчанию из данных места, как при сборке
  const kindTarget = (k: DemoCta['kind']): string => (k === 'route' ? c.mapsUrl ?? '' : c.phone ? `tel:${c.phone}` : '')
  return (
    <fieldset disabled={locked} className="flex flex-col gap-4 disabled:opacity-60">
      <section aria-label="Тексты" className={box}>
        <Field label="Заголовок"><TextInput maxLength={200} value={c.headline} onChange={(e) => set('headline', e.target.value)} /></Field>
        <Field label="Подзаголовок"><TextInput maxLength={400} value={c.subhead} onChange={(e) => set('subhead', e.target.value)} /></Field>
        <Field label="О нас"><textarea maxLength={2000} className={areaCls} value={c.about} onChange={(e) => set('about', e.target.value)} /></Field>
      </section>

      <section aria-label="Пункты и цены" className={box}>
        <h2 className="font-semibold">Пункт — цена</h2>
        {c.items.length === 0 && <p className="text-xs text-muted">Добавьте блюда или услуги с ценами владельца. ИИ цены не придумывает.</p>}
        {c.items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <TextInput aria-label={`Пункт ${i + 1}`} placeholder="Название" maxLength={200} value={it.name} onChange={(e) => edit(setItem(c, i, { name: e.target.value }))} />
            <TextInput aria-label={`Цена ${i + 1}`} placeholder="Цена" maxLength={50} className="!w-32 font-mono" value={it.price} onChange={(e) => edit(setItem(c, i, { price: e.target.value }))} />
            <Button variant="ghost" aria-label={`Убрать пункт ${i + 1}`} onClick={() => edit(removeItem(c, i))}>Убрать</Button>
          </div>
        ))}
        <Button variant="ghost" className="self-start" disabled={c.items.length >= 100} onClick={() => edit(addItem(c))}>Добавить пункт</Button>
      </section>

      <section aria-label="Часы работы" className={box}>
        <Field label="Часы работы" hint="Одна строка — один день или период, не больше 14 строк">
          <textarea className={`${areaCls} font-mono`} value={c.hours.join('\n')}
            onChange={(e) => set('hours', e.target.value.split('\n').slice(0, 14).map((x) => x.slice(0, 200)))} />
        </Field>
      </section>

      <section aria-label="Отзывы" className={box}>
        <h2 className="font-semibold">Отзывы</h2>
        {c.reviews.length === 0 && <p className="text-xs text-muted">Отзывов нет.</p>}
        {c.reviews.map((r, i) => (
          <label key={i} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={r.on} onChange={() => edit(toggleReview(c, i))} />
            <span><span className="font-semibold">{r.author}</span>{r.rating !== null ? ` · ${r.rating}★` : ''}<span className="block text-muted">{r.text}</span></span>
          </label>
        ))}
        {c.fromGoogle && c.reviews.length > 0 && (
          <p className="text-xs text-muted">На сайте под отзывами будут имена авторов и подпись «Отзывы из Google». Публиковать отзывы Google на своём сайте условия Google не разрешают — выключите лишние.</p>
        )}
      </section>

      <section aria-label="Фото" className={box}>
        <h2 className="font-semibold">Фото</h2>
        {c.photos.length === 0 && <p className="text-xs text-muted">Фото нет.</p>}
        <ol className="flex flex-col gap-2">
          {c.photos.map((p, i) => (
            <li key={p.file} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{i + 1}. {p.source === 'google' ? 'Google' : 'Своё'}{p.author ? ` · ${p.author}` : ''}</span>
              {p.source === 'google' && <span className="text-xs text-muted">Замените фото владельца перед продажей</span>}
              <span className="flex-1" />
              <Button variant="ghost" className="!px-2 !py-1" aria-label={`Фото ${i + 1} выше`} disabled={i === 0} onClick={() => edit(movePhoto(c, i, i - 1))}>↑</Button>
              <Button variant="ghost" className="!px-2 !py-1" aria-label={`Фото ${i + 1} ниже`} disabled={i === c.photos.length - 1} onClick={() => edit(movePhoto(c, i, i + 1))}>↓</Button>
              <Button variant="ghost" className="!px-2 !py-1" aria-label={`Убрать фото ${i + 1}`} onClick={() => edit(removePhoto(c, i))}>Убрать</Button>
            </li>
          ))}
        </ol>
        <Button variant="ghost" className="self-start" disabled={busy} onClick={onPhotoAdd}>Загрузить фото</Button>
      </section>

      <section aria-label="Кнопка действия" className={box}>
        <Field label="Кнопка действия">
          <select className={`${inputCls} w-56`} value={c.cta.kind} onChange={(e) => { const k = e.target.value as DemoCta['kind']; set('cta', { kind: k, target: kindTarget(k) }) }}>
            {CTA.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Куда ведёт кнопка" hint={cta[2]}>
          <TextInput className="font-mono" maxLength={2000} aria-invalid={!okLink} value={c.cta.target} onChange={(e) => set('cta', { ...c.cta, target: e.target.value })} />
        </Field>
        {!okLink && <p role="alert" className="text-xs text-danger">Ссылка должна начинаться с https:// или tel: — пока она неверна, черновик не сохраняется</p>}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.showBadge} onChange={(e) => set('showBadge', e.target.checked)} /> Сайт сделал @ник
        </label>
      </section>
    </fieldset>
  )
}
