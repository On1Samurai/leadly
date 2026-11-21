import { useEffect, useState } from 'react'
import type { DemoView } from '../../../shared/demo/types'
import { Button } from '../components/Button'
import { DEMO_STATUS_LABEL, POSTCARD_HINT } from '../labels'
import { errText } from '../lib'
import { useNav } from '../nav'

type Row = DemoView & { placeName: string }
const MAX_CARDS = 4

export function Demos(): React.JSX.Element {
  const { navigate } = useNav()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sel, setSel] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => { window.api.demo.list().then(setRows).catch((e) => setErr(errText(e))) }, [])

  const toggle = (id: number, on: boolean): void => setSel((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
  const postcards = async (): Promise<void> => {
    setBusy(true); setErr(null); setNote(null)
    try { const p = await window.api.demo.postcard(sel); if (p) setNote(`Сохранено: ${p}`) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }

  return (
    <main className="flex flex-col gap-4 px-8 py-6">
      <h1 className="text-2xl font-bold">Демо</h1>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {!rows && !err && <p className="text-sm text-muted">Загрузка…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted">Демо пока нет. Откройте карточку заведения → вкладка «Работа» → «Собрать демо».</p>}
      {rows && rows.length > 0 && <>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy || sel.length === 0} onClick={postcards}>{busy ? 'Готовим PDF…' : 'Открытки'}</Button>
          <span className="text-xs text-muted">Выберите до {MAX_CARDS} опубликованных демо: одно — 4 копии на листе A4. {POSTCARD_HINT}</span>
        </div>
        {note && <p role="status" className="break-all text-sm text-muted">{note}</p>}
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Выбор для открыток</span></th>
                <th scope="col" className="px-3 py-2 font-normal">Заведение</th>
                <th scope="col" className="px-3 py-2 font-normal">Статус</th>
                <th scope="col" className="px-3 py-2 font-normal">Ссылка</th>
                <th scope="col" className="px-3 py-2 font-normal">Открыли · QR · «Хочу так»</th>
                <th scope="col" className="px-3 py-2 font-normal">Дата</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = sel.includes(r.placeId)
                return (
                  <tr key={r.placeId} className="border-t border-line">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Открытка: ${r.placeName}`} checked={on}
                        disabled={r.status !== 'published' || (!on && sel.length >= MAX_CARDS)} onChange={(e) => toggle(r.placeId, e.target.checked)} />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className="cursor-pointer text-left font-semibold hover:underline" onClick={() => navigate('demoEditor', { placeId: r.placeId })}>{r.placeName}</button>
                    </td>
                    <td className="px-3 py-2">{DEMO_STATUS_LABEL[r.status]}{r.error ? <span className="block text-xs text-danger">{errText(r.error)}</span> : null}</td>
                    <td className="max-w-64 truncate px-3 py-2 font-mono text-xs text-muted">{r.url ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{r.counts.open} · {r.counts.qr} · {r.counts.want}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString('ru-RU') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}
    </main>
  )
}
