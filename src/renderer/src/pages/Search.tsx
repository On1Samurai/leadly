import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CellView, PassEvent } from '../../../shared/ipc'
import type { BBox } from '../../../shared/types'
import categories from '../../../../resources/data/categories.json'
import { Button } from '../components/Button'
import { CityPicker, type PickedCity } from '../components/CityPicker'
import { Counters } from '../components/Counters'
import { Field, inputCls } from '../components/Field'
import { GridMap } from '../components/GridMap'
import { useNav } from '../nav'
import { cellKey, cellValue, initialState, reduce } from '../search-view'

const CATS = (categories as { id: string; title: string }[]).map((c) => ({ id: c.id, title: c.id === 'b2b' ? 'Все компании' : c.title }))

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
  const [st, dispatch] = useReducer(reduce, 0, initialState)
  const cityRef = useRef<number | null>(null)
  const knownRef = useRef<Set<string>>(new Set())
  const budgetRef = useRef(0)
  const loadingRef = useRef(false)
  const againRef = useRef(false)

  // один запрос pass.cells за раз; запросы во время загрузки схлопываются в один повтор
  const loadCells = useCallback(async (cityId: number): Promise<void> => {
    if (loadingRef.current) { againRef.current = true; return }
    loadingRef.current = true
    try {
      do {
        againRef.current = false
        const c = await window.api.pass.cells(cityId)
        if (cityRef.current !== cityId) return
        knownRef.current = new Set(c.map((x) => cellKey(x.ix, x.iy)))
        setCells(c)
        dispatch({ type: 'cellsTotal', total: c.length })
      } while (againRef.current)
    } finally { loadingRef.current = false }
  }, [])

  // события прохода: подписка на всё время жизни экрана
  useEffect(() => {
    const off = window.api.pass.onEvent((e: PassEvent) => {
      dispatch({ type: 'event', e })
      if (e.type === 'cell' && cityRef.current !== null && !knownRef.current.has(cellKey(e.ix, e.iy))) void loadCells(cityRef.current)
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
        dispatch({ type: 'reset', budget: s.googleBudget })
        const status = await window.api.pass.status()
        if (!alive) return
        if (!status.running || status.cityId === null) { dispatch({ type: 'cellsTotal', total: 0 }); return }
        const name = (await window.api.city.list()).find((c) => c.id === status.cityId)?.name ?? ''
        cityRef.current = status.cityId
        setCity({ id: status.cityId, name, bbox: null })
        dispatch({ type: 'restore', status })
        await loadCells(status.cityId)
      } catch { /* экран остаётся пустым */ }
    })()
    return () => { alive = false }
  }, [loadCells])

  const pickCity = (c: PickedCity): void => {
    cityRef.current = c.id
    setCity(c); dispatch({ type: 'reset' })
    void loadCells(c.id).catch(() => undefined)
  }

  const start = async (): Promise<void> => {
    if (!city || st.running) return
    dispatch({ type: 'start', cellsTotal: cells.length })
    try {
      await window.api.pass.start({ cityId: city.id, categoryId })
      await loadCells(city.id)
    } catch (e) { dispatch({ type: 'startFailed', error: e }) }
  }

  const view = useMemo(
    () => cells.map((c) => ({ ...c, newCount: cellValue(st, c) })),
    [cells, st]
  )
  const box = city?.bbox ?? union(cells)
  const act = (f: () => Promise<void>): void => { f().catch((e) => dispatch({ type: 'error', error: e })) }

  return (
    <main className="flex h-full flex-col gap-4 px-8 py-6">
      <h1 className="text-2xl font-bold">Поиск</h1>
      <section className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-start">
        <Field label="Город"><CityPicker value={city} disabled={st.running} onPick={pickCity} /></Field>
        <Field label="Категория">
          <select className={inputCls} value={categoryId} disabled={st.running} onChange={(e) => setCategoryId(e.target.value)}>
            {CATS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <div className="md:pt-6"><Button disabled={!city || st.running} onClick={() => void start()}>Искать</Button></div>
      </section>
      {city && <p className="text-sm text-muted">Город: <span className="text-fg">{city.name}</span></p>}
      {st.error && <p role="alert" className="text-sm text-danger">{st.error}</p>}

      <Counters c={st.counters} />
      <div className="flex flex-wrap items-center gap-2">
        {st.running && !st.paused && <Button variant="ghost" onClick={() => act(async () => { await window.api.pass.pause(); dispatch({ type: 'paused', value: true }) })}>Пауза</Button>}
        {st.running && st.paused && <Button variant="ghost" onClick={() => act(async () => { await window.api.pass.resume(); dispatch({ type: 'paused', value: false }) })}>Продолжить</Button>}
        {st.running && <Button variant="ghost" onClick={() => act(() => window.api.pass.stop())}>Стоп</Button>}
        {st.finished && city && <Button onClick={() => navigate('base', { cityId: city.id })}>Смотреть найденное</Button>}
      </div>
      {st.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">{st.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <div className="min-h-[320px] flex-1 overflow-hidden rounded-card border border-line">
        <GridMap cells={view} box={box} fitKey={`${city?.id ?? 0}:${box ? 1 : 0}`} />
      </div>
    </main>
  )
}
