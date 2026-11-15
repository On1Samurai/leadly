import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlaceCounts, PlaceFilter, PlaceView } from '../../../shared/ipc'
import { nextAction, type NextAction as NA, type NextActionInput } from '../../../shared/nextAction'
import categories from '../../../../resources/data/categories.json'
import { Filters, type FilterState } from '../components/Filters'
import { NextAction } from '../components/NextAction'
import { PlaceCard } from '../components/PlaceCard'
import { PlaceDrawer } from '../components/PlaceDrawer'
import { errText } from '../lib'
import { useNav } from '../nav'

const PAGE = 60
const CATS = (categories as { id: string; title: string }[]).map((c) => ({ id: c.id, title: c.id === 'b2b' ? 'Все компании' : c.title }))
const CAT_TITLE = new Map(CATS.map((c) => [c.id, c.title]))

type Mode = 'found' | 'base'

export function Base(): React.JSX.Element {
  const { params } = useNav()
  const [mode, setMode] = useState<Mode>(params.cityId !== undefined ? 'found' : 'base')
  const [f, setF] = useState<FilterState>({ cityId: params.cityId ?? null, webClass: [], status: [], category: '', sort: 'score' })
  const [cities, setCities] = useState<{ id: number; name: string }[]>([])
  const [items, setItems] = useState<PlaceView[]>([])
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<PlaceCounts | null>(null)
  const [cands, setCands] = useState<NextActionInput[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const reqRef = useRef(0)
  const busyRef = useRef(false)
  const lenRef = useRef(0)
  lenRef.current = items.length
  const sentinel = useRef<HTMLDivElement>(null)

  // фильтр без пагинации: ключ для сброса списка
  const base = useMemo(() => {
    const b: Omit<PlaceFilter, 'sort' | 'limit' | 'offset'> = {}
    if (mode === 'base') b.inBase = true
    if (f.cityId !== null) b.cityId = f.cityId
    if (f.webClass.length) b.webClass = f.webClass
    if (f.status.length) b.status = f.status
    if (f.category) b.category = f.category
    return b
  }, [mode, f])
  const key = JSON.stringify([base, f.sort])
  const cityName = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities])

  useEffect(() => { window.api.city.list().then(setCities).catch((e) => setErr(errText(e))) }, [])

  const loadSide = useCallback((req: number, b: typeof base) => {
    window.api.places.counts(b).then((c) => { if (req === reqRef.current) setCounts(c) }).catch(() => undefined)
    window.api.places.nextCandidates(b.cityId).then((c) => { if (req === reqRef.current) { setCands(c); setNow(Date.now()) } }).catch(() => undefined)
  }, [])

  // смена фильтра: новый запрос, ответы старых игнорируются по номеру
  useEffect(() => {
    const req = ++reqRef.current
    busyRef.current = true
    setItems([]); setDone(false); setLoading(true); setErr(null)
    window.api.places.list({ ...base, sort: f.sort, limit: PAGE, offset: 0 })
      .then((r) => { if (req !== reqRef.current) return; setItems(r); setDone(r.length < PAGE) })
      .catch((e) => { if (req === reqRef.current) { setErr(errText(e)); setDone(true) } })
      .finally(() => { if (req === reqRef.current) { busyRef.current = false; setLoading(false) } })
    loadSide(req, base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const more = useCallback(() => {
    if (busyRef.current) return
    const req = reqRef.current
    busyRef.current = true
    window.api.places.list({ ...base, sort: f.sort, limit: PAGE, offset: lenRef.current })
      .then((r) => {
        if (req !== reqRef.current) return
        setItems((xs) => { const have = new Set(xs.map((x) => x.id)); return [...xs, ...r.filter((x) => !have.has(x.id))] })
        setDone(r.length < PAGE)
      })
      .catch((e) => { if (req === reqRef.current) { setErr(errText(e)); setDone(true) } })
      .finally(() => { if (req === reqRef.current) busyRef.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // сентинел внизу: пока он виден и страницы не кончились — догружаем (новый observer на каждую порцию)
  useEffect(() => {
    const el = sentinel.current
    if (!el || done || loading) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, done, loading, more])

  const onOpen = useCallback((id: number) => setOpenId(id), [])
  const onToggle = useCallback((id: number, v: boolean) => {
    const set = (x: boolean): void => setItems((xs) => xs.map((p) => (p.id === id ? { ...p, inBase: x } : p)))
    set(v)
    window.api.places.toBase(id, v)
      .then(() => loadSide(reqRef.current, base))
      .catch((e) => { set(!v); setErr(errText(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadSide])

  const action: NA = useMemo(() => nextAction(cands, now), [cands, now])
  const act = useCallback((a: NonNullable<NA>) => setOpenId(a.placeId), [])

  const stats: [string, number | string][] = [
    ['показано', counts?.total ?? '…'], ['без сайта', counts?.none ?? '…'],
    ['шаблон', counts?.template ?? '…'], ['только соцсети', counts?.social ?? '…']
  ]

  return (
    <main className="flex flex-col gap-4 px-8 py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{mode === 'base' ? 'База' : 'Найденное'}</h1>
        <div role="group" aria-label="Режим" className="flex overflow-hidden rounded-lg border border-line text-sm">
          {([['found', 'Найденное'], ['base', 'В базе']] as const).map(([m, t]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`cursor-pointer px-3 py-1.5 ${mode === m ? 'bg-accent font-semibold text-bg' : 'text-muted hover:text-fg'}`}>{t}</button>
          ))}
        </div>
      </div>
      <dl className="flex flex-wrap gap-3">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-card border border-line bg-surface px-4 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-mono text-lg">{v}</dd>
          </div>
        ))}
      </dl>
      <NextAction action={action} onAct={act} />
      <Filters value={f} cities={cities} categories={CATS} onChange={setF} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {!loading && items.length === 0 && !err && (
        <p className="py-10 text-center text-muted">{mode === 'base' ? 'В базе пока пусто. Добавьте места из «Найденное» кнопкой «+ В базу».' : 'Ничего не найдено. Запустите поиск или смените фильтры.'}</p>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
        {items.map((p) => (
          <PlaceCard key={p.id} place={p} cityName={cityName.get(p.cityId) ?? ''} categoryTitle={CAT_TITLE.get(p.category) ?? p.category}
            onOpen={onOpen} onToggle={onToggle} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" className="h-4" />
      {loading && <p className="text-sm text-muted">Загрузка…</p>}
      <PlaceDrawer id={openId} onClose={() => setOpenId(null)} />
    </main>
  )
}
