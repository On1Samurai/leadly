import type { Status, WebClass } from '../../../shared/types'
import { STATUS_LABEL, STATUS_ORDER, WEB_LABEL, WEB_ORDER } from '../labels'
import { inputCls } from './Field'

export interface FilterState {
  cityId: number | null; webClass: WebClass[]; status: Status[]; category: string; sort: 'score' | 'new'
}

interface Props {
  value: FilterState
  cities: { id: number; name: string }[]
  categories: { id: string; title: string }[]
  onChange: (v: FilterState) => void
}

function Chips<T extends string>({ label, all, labels, on, onToggle }: {
  label: string; all: T[]; labels: Record<T, string>; on: T[]; onToggle: (x: T) => void
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden="true" className="mr-1 text-xs text-muted">{label}</span>
      {all.map((x) => (
        <label key={x} className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white ${on.includes(x) ? 'border-accent bg-accent font-semibold text-bg' : 'border-line text-fg hover:bg-surface'}`}>
          <input type="checkbox" className="sr-only" checked={on.includes(x)} onChange={() => onToggle(x)} />
          {labels[x]}
        </label>
      ))}
    </fieldset>
  )
}

const flip = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

export function Filters({ value: v, cities, categories, onChange }: Props): React.JSX.Element {
  const set = (p: Partial<FilterState>): void => onChange({ ...v, ...p })
  const sel = `${inputCls} !w-auto`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Город" className={sel} value={v.cityId ?? ''} onChange={(e) => set({ cityId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Все города</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Категория" className={sel} value={v.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select aria-label="Сортировка" className={sel} value={v.sort} onChange={(e) => set({ sort: e.target.value as 'score' | 'new' })}>
          <option value="score">Сначала перспективные</option>
          <option value="new">Сначала новые</option>
        </select>
      </div>
      <Chips label="Сайт" all={WEB_ORDER} labels={WEB_LABEL} on={v.webClass} onToggle={(x) => set({ webClass: flip(v.webClass, x) })} />
      <Chips label="Статус" all={STATUS_ORDER} labels={STATUS_LABEL} on={v.status} onToggle={(x) => set({ status: flip(v.status, x) })} />
    </div>
  )
}
