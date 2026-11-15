import { useEffect, useState } from 'react'
import type { PlaceDetails } from '../../../../shared/ipc'
import { parseDateInput, remindAt, type RemindPreset } from '../../../../shared/remind'
import { errText } from '../../lib'
import { STATUS_LABEL, STATUS_ORDER } from '../../labels'
import type { Status } from '../../../../shared/types'
import { Button } from '../Button'

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
