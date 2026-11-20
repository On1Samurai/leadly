import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlaceView, TodayView } from '../../../shared/ipc'
import categories from '../../../../resources/data/categories.json'
import { PlaceCard } from '../components/PlaceCard'
import { PlaceDrawer } from '../components/PlaceDrawer'
import { errText } from '../lib'

const CAT_TITLE = new Map((categories as { id: string; title: string }[]).map((c) => [c.id, c.id === 'b2b' ? 'Все компании' : c.title]))

export function Today(): React.JSX.Element {
  const [v, setV] = useState<TodayView | null>(null)
  const [cities, setCities] = useState<Map<number, string>>(new Map())
  const [err, setErr] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => { window.api.today.get().then(setV).catch((e) => setErr(errText(e))) }, [])
  useEffect(() => {
    load()
    window.api.city.list().then((cs) => setCities(new Map(cs.map((c) => [c.id, c.name])))).catch(() => undefined)
  }, [load])

  const ids = useMemo(() => (v ? [...v.wanted, ...v.remindToday, ...v.replied].map((p) => p.id) : []), [v])
  const onToggle = useCallback((id: number, inBase: boolean) => {
    window.api.places.toBase(id, inBase).then(load).catch((e) => setErr(errText(e)))
  }, [load])

  const list = (title: string, items: PlaceView[], empty: string): React.JSX.Element => (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title} <span className="font-mono text-sm text-muted">{items.length}</span></h2>
      {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
        {items.map((p) => (
          <PlaceCard key={p.id} place={p} cityName={cities.get(p.cityId) ?? ''} categoryTitle={CAT_TITLE.get(p.category) ?? p.category}
            onOpen={setOpenId} onToggle={onToggle} />
        ))}
      </div>
    </section>
  )

  const pct = v ? Math.min(100, Math.round((v.written / Math.max(1, v.goal)) * 100)) : 0
  return (
    <main className="flex flex-col gap-6 px-8 py-6">
      <h1 className="text-2xl font-bold">Сегодня</h1>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {!v && !err && <p className="text-sm text-muted">Загрузка…</p>}
      {v && (
        <>
          <div className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Написано сегодня</span>
              <span className="font-mono text-lg">{v.written} / {v.goal}</span>
            </div>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={v.goal} aria-valuenow={Math.min(v.written, v.goal)}
              className="my-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm">{v.leftToday > 0 ? `Осталось на сегодня: ${v.leftToday}` : 'Цель на сегодня выполнена'}</p>
          </div>
          {v.wanted.length > 0 && list('Хотят такой сайт', v.wanted, '')}
          {list('Напомнить сегодня', v.remindToday, 'Напоминаний на сегодня нет.')}
          {list('Ответили', v.replied, 'Пока никто не ответил.')}
        </>
      )}
      <PlaceDrawer id={openId} ids={ids} total={ids.length} onMove={setOpenId}
        onClose={() => setOpenId(null)} onChanged={load} onRemoved={() => { setOpenId(null); load() }} />
    </main>
  )
}
