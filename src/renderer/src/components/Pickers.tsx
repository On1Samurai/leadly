import { useState } from 'react'
import type { AppSettings } from '../../../shared/settings'
import { COUNTRIES, SELL_OPTIONS } from '../lib'
import { TextInput } from './Field'

type Patch = (p: Partial<AppSettings>) => void

export function SellsPicker({ sells, custom, onChange }: { sells: string[]; custom: string; onChange: Patch }): React.JSX.Element {
  const toggle = (o: string): void => onChange({ sells: sells.includes(o) ? sells.filter((x) => x !== o) : [...sells, o] })
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Что продаёте (можно несколько)</legend>
      <div className="flex flex-wrap gap-2">
        {SELL_OPTIONS.map((o) => (
          <label key={o} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white ${sells.includes(o) ? 'border-accent bg-accent text-bg font-semibold' : 'border-line text-fg hover:bg-surface'}`}>
            <input type="checkbox" className="sr-only" checked={sells.includes(o)} onChange={() => toggle(o)} />
            {o}
          </label>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm text-muted">Своё</span>
        <TextInput value={custom} maxLength={1000} placeholder="например: ремонт квартир" onChange={(e) => onChange({ custom: e.target.value })} />
      </label>
    </fieldset>
  )
}

export function CountryPicker({ country, onChange }: { country: string; onChange: Patch }): React.JSX.Element {
  const known = COUNTRIES.some((c) => c.code === country)
  const [other, setOther] = useState(!known)
  const [code, setCode] = useState(known ? '' : country)
  const pick = (c: (typeof COUNTRIES)[number]): void => { setOther(false); onChange({ country: c.code, lang: c.lang }) }
  const valid = /^[A-Z]{2}$/.test(code)
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Страна</legend>
      <div className="flex flex-wrap gap-2">
        {COUNTRIES.map((c) => {
          const on = !other && country === c.code
          return (
            <label key={c.code} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white ${on ? 'border-accent bg-accent text-bg font-semibold' : 'border-line hover:bg-surface'}`}>
              <input type="radio" name="country" className="sr-only" checked={on} onChange={() => pick(c)} />
              {c.name}
            </label>
          )
        })}
        <label className={`cursor-pointer rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white ${other ? 'border-accent bg-accent text-bg font-semibold' : 'border-line hover:bg-surface'}`}>
          <input type="radio" name="country" className="sr-only" checked={other} onChange={() => setOther(true)} />
          Другая
        </label>
      </div>
      {other && (
        <label className="mt-3 block">
          <span className="mb-1 block text-sm text-muted">Код страны, две латинские буквы (например DE)</span>
          <TextInput value={code} maxLength={2} className="w-24 font-mono uppercase" placeholder="DE"
            onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); setCode(v); if (/^[A-Z]{2}$/.test(v)) onChange({ country: v }) }} />
          {code && !valid && <span role="alert" className="mt-1 block text-xs text-danger">Нужны ровно две буквы A–Z</span>}
        </label>
      )}
    </fieldset>
  )
}
