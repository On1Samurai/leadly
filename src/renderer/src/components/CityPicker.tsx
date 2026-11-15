import { useEffect, useState } from 'react'
import type { CityHit } from '../../../shared/ipc'
import type { BBox } from '../../../shared/types'
import { Button } from './Button'
import { TextInput, inputCls } from './Field'
import { errText } from '../lib'

export interface PickedCity { id: number; name: string; bbox: BBox | null }

export function CityPicker({ value, disabled, onPick }: { value: PickedCity | null; disabled: boolean; onPick: (c: PickedCity) => void }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CityHit[]>([])
  const [saved, setSaved] = useState<{ id: number; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { window.api.city.list().then(setSaved).catch(() => undefined) }, [value?.id])

  const search = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await window.api.city.search(q.trim())
      setHits(r)
      if (r.length === 0) setErr('Ничего не найдено')
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const pick = async (h: CityHit): Promise<void> => {
    setErr(null)
    try {
      const id = await window.api.city.save({ id: h.id })
      setHits([]); onPick({ id, name: h.name, bbox: h.bbox })
    } catch (e) {
      setErr(String(e).includes('unknown_city') ? 'Результаты устарели — найдите город ещё раз' : errText(e))
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <TextInput value={q} disabled={disabled} placeholder="Город, например Молодечно" aria-label="Город"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search() }} />
        <Button variant="ghost" disabled={disabled || busy || !q.trim()} onClick={search}>{busy ? 'Ищу…' : 'Найти'}</Button>
      </div>
      {saved.length > 0 && (
        <select aria-label="Сохранённые города" className={inputCls} disabled={disabled} value=""
          onChange={(e) => { const c = saved.find((s) => s.id === Number(e.target.value)); if (c) onPick({ id: c.id, name: c.name, bbox: null }) }}>
          <option value="">Или выберите сохранённый город…</option>
          {saved.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {hits.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-line bg-bg">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-surface" onClick={() => void pick(h)}>
                {h.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  )
}
