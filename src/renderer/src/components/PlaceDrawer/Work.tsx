import { useEffect, useState } from 'react'
import type { DemoView } from '../../../../shared/demo/types'
import type { PlaceDetails } from '../../../../shared/ipc'
import { parseDateInput, remindAt, type RemindPreset } from '../../../../shared/remind'
import { errText } from '../../lib'
import { DEMO_STATUS_LABEL, POSTCARD_HINT, STATUS_LABEL, STATUS_ORDER } from '../../labels'
import { useNav } from '../../nav'
import type { Status } from '../../../../shared/types'
import { Button } from '../Button'
import { Modal } from '../Modal'

const CUR: Record<string, string> = { RU: '₽', BY: 'BYN', UA: '₴' }
const fmt = (ts: number): string => new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const major = (minor: number | null): string => (minor === null ? '' : String(minor / 100))

interface Props { d: PlaceDetails; country: string; onChanged: () => void }

export function Work({ d, country, onChanged }: Props): React.JSX.Element {
  const [date, setDate] = useState('')
  const [deal, setDeal] = useState(major(d.dealAmount))
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setDeal(major(d.dealAmount)); setErr(null) }, [d.id, d.dealAmount])

  const act = (p: Promise<void>): void => { setErr(null); p.then(onChanged).catch((e) => setErr(errText(e))) }
  const remind = (preset: RemindPreset): void => act(window.api.places.remind(d.id, remindAt(Date.now(), preset)))
  const picked = parseDateInput(date, Date.now())

  const saveDeal = (): void => {
    const t = deal.trim().replace(',', '.')
    if (t === '') return act(window.api.places.setDeal(d.id, null))
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) { setErr('Введите сумму числом'); return }
    act(window.api.places.setDeal(d.id, Math.round(n * 100)))
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted">Статус</span>
        <select value={d.status} onChange={(e) => act(window.api.places.setStatus(d.id, e.target.value as Status))}
          className="rounded-lg border border-line bg-surface p-2 text-fg">
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Напомнить позже</h3>
        {d.remindAt !== null && <p className="text-muted">Напомним: {fmt(d.remindAt)}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => remind('tomorrow')}>Завтра</Button>
          <Button variant="ghost" onClick={() => remind('days3')}>Через 3 дня</Button>
          <Button variant="ghost" onClick={() => remind('week')}>Через неделю</Button>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата напоминания"
            className="rounded-lg border border-line bg-surface p-2 text-fg" />
          <Button variant="ghost" disabled={!picked} onClick={() => picked && remind(picked)}>Напомнить</Button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Сумма сделки, {CUR[country] ?? ''}</span>
          <input inputMode="decimal" value={deal} onChange={(e) => setDeal(e.target.value)} onBlur={saveDeal}
            onKeyDown={(e) => { if (e.key === 'Enter') saveDeal() }}
            className="rounded-lg border border-line bg-surface p-2 font-mono text-fg" />
        </label>
      </section>
      {err && <p role="alert" className="text-danger">{err}</p>}
      <DemoSection key={d.id} d={d} />
      <section>
        <h3 className="mb-1 font-semibold">История статусов</h3>
        {d.statusLog.length === 0 && <p className="text-muted">Пока без изменений.</p>}
        <ul>{d.statusLog.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-0.5">
            <span>{l.from ? `${STATUS_LABEL[l.from]} → ` : ''}{STATUS_LABEL[l.to]}</span>
            <span className="font-mono text-xs text-muted">{fmt(l.at)}</span>
          </li>
        ))}</ul>
      </section>
    </div>
  )
}

type Match = NonNullable<Awaited<ReturnType<typeof window.api.demo.match>>>
type Budget = Awaited<ReturnType<typeof window.api.demo.budget>>

/** Демо-сайт места: сборка (с подтверждением совпадения в Google) или статус, счётчики и действия. */
function DemoSection({ d }: { d: PlaceDetails }): React.JSX.Element {
  const { navigate } = useNav()
  const [demo, setDemo] = useState<DemoView | null | undefined>(undefined)
  const [google, setGoogle] = useState(false)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true // ответ для прежнего места не попадёт в новое
    window.api.demo.get(d.id).then((x) => { if (live) setDemo(x) }).catch((e) => { if (live) { setDemo(null); setErr(errText(e)) } })
    window.api.secrets.has().then((h) => { if (live) setGoogle(h.google) }).catch(() => undefined)
    window.api.demo.budget().then((b) => { if (live) setBudget(b) }).catch(() => undefined)
    return () => { live = false }
  }, [d.id])

  const run = async (f: () => Promise<void>): Promise<void> => {
    setBusy(true); setErr(null); setNote(null)
    try { await f() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const doBuild = async (o: { source: 'auto' | 'free'; googleId?: string }): Promise<void> => {
    await window.api.demo.build(d.id, o)
    navigate('demoEditor', { placeId: d.id })
  }
  const build = (o: { source: 'auto' | 'free'; googleId?: string }): void => { setMatch(null); void run(() => doBuild(o)) }
  // лимит Google исчерпан — собираем из бесплатных данных, а не падаем на demo_google_limit
  // без googlePlaceId сначала платный поиск (match) — сервер требует 1 + need
  const paid = google && budget !== null && budget.left >= budget.need + (d.googlePlaceId ? 0 : 1)
  const start = (): void => {
    if (!paid) return build({ source: 'free' })
    if (d.googlePlaceId) return build({ source: 'auto' })
    void run(async () => {
      const m = await window.api.demo.match(d.id) // платный Text Search: 1 запрос из лимита
      setBudget(await window.api.demo.budget())
      if (m) setMatch(m)
      else await doBuild({ source: 'free' }) // в Google не нашлось
    })
  }
  const postcard = (): Promise<void> => run(async () => {
    const p = await window.api.demo.postcard([d.id])
    if (p) setNote(`Сохранено: ${p}`)
  })

  return (
    <section aria-label="Демо-сайт" className="flex flex-col gap-2">
      <h3 className="font-semibold">Демо-сайт</h3>
      {demo === undefined && <p className="text-muted">Загрузка…</p>}
      {demo === null && <>
        <Button className="self-start" disabled={busy} onClick={start}>{busy ? 'Собираем…' : 'Собрать демо'}</Button>
        {google && budget && (paid
          ? <p className="text-xs text-muted">≈ ${budget.costUsd.toFixed(2)} из Google{d.googlePlaceId ? '' : ` + поиск ≈ $${budget.matchCostUsd.toFixed(3)}`}, осталось сегодня {budget.left}</p>
          : <p className="text-xs text-muted">Лимит Google на сегодня исчерпан — демо соберётся без Google</p>)}
      </>}
      {demo && <>
        <p>{DEMO_STATUS_LABEL[demo.status]}{demo.status === 'error' && demo.error ? ` — ${errText(demo.error)}` : ''}</p>
        <p className="font-mono text-xs text-muted">открыли {demo.counts.open} · по QR {demo.counts.qr} · «Хочу так» {demo.counts.want}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => navigate('demoEditor', { placeId: d.id })}>Редактор</Button>
          {demo.status === 'published' && <>
            <Button variant="ghost" disabled={busy} onClick={() => run(() => window.api.demo.openLive(d.id))}>Открыть</Button>
            <Button variant="ghost" disabled={busy} onClick={postcard}>Открытка</Button>
          </>}
        </div>
        {demo.status === 'published' && <p className="text-xs text-muted">{POSTCARD_HINT}</p>}
      </>}
      {note && <p role="status" className="break-all text-muted">{note}</p>}
      {err && <p role="alert" className="text-danger">{err}</p>}
      {match && (
        <Modal title="Это то заведение?" onClose={() => setMatch(null)}>
          <p className="text-sm">{match.name}{match.address ? `, ${match.address}` : ''}, {match.distanceM} м</p>
          {budget && <p className="text-xs text-muted">≈ ${budget.costUsd.toFixed(2)} из Google, осталось сегодня {budget.left}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => build({ source: 'auto', googleId: match.googleId })}>Да</Button>
            <Button variant="ghost" onClick={() => build({ source: 'free' })}>Нет, без Google</Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
