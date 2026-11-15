import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CellView, PassEvent } from '../../../shared/ipc'
import type { BBox } from '../../../shared/types'
import categories from '../../../../resources/data/categories.json'
import { Button } from '../components/Button'
import { CityPicker, type PickedCity } from '../components/CityPicker'
import { Counters, type PassCounters } from '../components/Counters'
import { Field, inputCls } from '../components/Field'
import { GridMap } from '../components/GridMap'
import { useNav } from '../nav'
import { passErrorText } from '../search-view'

const CATS = (categories as { id: string; title: string }[]).map((c) => ({ id: c.id, title: c.id === 'b2b' ? 'Все компании' : c.title }))
const ZERO: PassCounters = { cellsDone: 0, cellsTotal: 0, newCount: 0, dupCount: 0, googleUsed: 0, budget: 0 }
const key = (ix: number, iy: number): string => `${ix},${iy}`

function union(cells: CellView[]): BBox | null {
  if (cells.length === 0) return null
  return {
    south: Math.min(...cells.map((c) => c.bbox.south)), west: Math.min(...cells.map((c) => c.bbox.west)),
    north: Math.max(...cells.map((c) => c.bbox.north)), east: Math.max(...cells.map((c) => c.bbox.east))
  }
}

export function Search(): React.JSX.Element {
  const { navigate } = useNav()
  const [city, setCity] = useState<PickedCity | null>(null)
  const [categoryId, setCategoryId] = useState('cafe')
  const [cells, setCells] = useState<CellView[]>([])
  const [live, setLive] = useState<Record<string, number> | null>(null)
  const [counters, setCounters] = useState<PassCounters>(ZERO)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [finished, setFinished] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const cityRef = useRef<number | null>(null)
  const knownRef = useRef<Set<string>>(new Set())
  const budgetRef = useRef(0)

  const loadCells = useCallback(async (cityId: number): Promise<CellView[]> => {
    const c = await window.api.pass.cells(cityId)
    if (cityRef.current !== cityId) return c
    knownRef.current = new Set(c.map((x) => key(x.ix, x.iy)))
    setCells(c)
    setCounters((p) => ({ ...p, cellsTotal: c.length }))
    return c
  }, [])

  // события прохода: подписка на всё время жизни экрана
  useEffect(() => {
    const off = window.api.pass.onEvent((e: PassEvent) => {
      if (e.type === 'warning') {
        if (e.text.includes('city_too_large')) { setError(passErrorText(new Error('city_too_large'))); return }
        setWarnings((w) => [...w, e.text]); return }
      if (e.type === 'cell') {
        setLive((p) => ({ ...(p ?? {}), [key(e.ix, e.iy)]: e.newCount }))
        setCounters((p) => ({
          ...p, cellsDone: p.cellsDone + 1, newCount: p.newCount + e.newCount,
          dupCount: p.dupCount + e.dupCount, googleUsed: p.googleUsed + e.googleRequests
        }))
        if (cityRef.current !== null && !knownRef.current.has(key(e.ix, e.iy))) void loadCells(cityRef.current)
        return
      }
      setRunning(false); setPaused(false); setFinished(true)
      setCounters((p) => ({
        ...p, cellsDone: e.summary.cellsDone, newCount: e.summary.newCount, dupCount: e.summary.dupCount, googleUsed: e.summary.googleUsed
      }))
    })
    return off
  }, [loadCells])

  // старт экрана: бюджет и восстановление идущего прохода
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await window.api.settings.get()
        budgetRef.current = s.googleBudget
        setCounters((p) => ({ ...p, budget: s.googleBudget }))
        const st = await window.api.pass.status()
        if (!alive || !st.running || st.cityId === null) return
        const name = (await window.api.city.list()).find((c) => c.id === st.cityId)?.name ?? ''
        cityRef.current = st.cityId
        setCity({ id: st.cityId, name, bbox: null })
        setRunning(true)
        await loadCells(st.cityId)
      } catch { /* экран остаётся пустым */ }
    })()
    return () => { alive = false }
  }, [loadCells])

  const pickCity = (c: PickedCity): void => {
    cityRef.current = c.id
    setCity(c); setLive(null); setFinished(false); setWarnings([]); setError(null)
    setCounters({ ...ZERO, budget: budgetRef.current })
    void loadCells(c.id).catch(() => undefined)
  }

  const start = async (): Promise<void> => {
    if (!city || running) return
    setError(null); setWarnings([]); setFinished(false); setLive({})
    setCounters({ ...ZERO, cellsTotal: cells.length, budget: budgetRef.current })
    setRunning(true); setPaused(false)
    try {
      await window.api.pass.start({ cityId: city.id, categoryId })
      await loadCells(city.id)
    } catch (e) {
      setRunning(false); setError(passErrorText(e))
    }
  }

  const view = useMemo(
    () => cells.map((c) => ({ ...c, newCount: live ? (live[key(c.ix, c.iy)] ?? 0) : c.newCount })),
    [cells, live]
  )
  const box = city?.bbox ?? union(cells)
  const act = (f: () => Promise<void>): void => { f().catch((e) => setError(passErrorText(e))) }

  return (
    <main className="flex h-full flex-col gap-4 px-8 py-6">
      <h1 className="text-2xl font-bold">Поиск</h1>
      <section className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-start">
        <Field label="Город"><CityPicker value={city} disabled={running} onPick={pickCity} /></Field>
        <Field label="Категория">
          <select className={inputCls} value={categoryId} disabled={running} onChange={(e) => setCategoryId(e.target.value)}>
            {CATS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <div className="md:pt-6"><Button disabled={!city || running} onClick={() => void start()}>Искать</Button></div>
      </section>
      {city && <p className="text-sm text-muted">Город: <span className="text-fg">{city.name}</span></p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Counters c={counters} />
      <div className="flex flex-wrap items-center gap-2">
        {running && !paused && <Button variant="ghost" onClick={() => act(async () => { await window.api.pass.pause(); setPaused(true) })}>Пауза</Button>}
        {running && paused && <Button variant="ghost" onClick={() => act(async () => { await window.api.pass.resume(); setPaused(false) })}>Продолжить</Button>}
        {running && <Button variant="ghost" onClick={() => act(() => window.api.pass.stop())}>Стоп</Button>}
        {finished && city && <Button onClick={() => navigate('base', { cityId: city.id })}>Смотреть найденное</Button>}
      </div>
      {warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <div className="min-h-[320px] flex-1 overflow-hidden rounded-card border border-line">
        <GridMap cells={view} box={box} fitKey={`${city?.id ?? 0}:${box ? 1 : 0}`} />
      </div>
    </main>
  )
}
