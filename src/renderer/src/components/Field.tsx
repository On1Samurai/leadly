import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Button } from './Button'

export const inputCls = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function TextInput(p: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />
}

/** Поле ключа: только запись; после сохранения показывает «сохранён ✓». */
export function SecretField({ label, hint, saved, onSave }: {
  label: string; hint: readonly string[]; saved: boolean; onSave: (v: string) => Promise<string | null>
}): React.JSX.Element {
  return <SecretInner label={label} hint={hint} saved={saved} onSave={onSave} />
}
function SecretInner({ label, hint, saved, onSave }: { label: string; hint: readonly string[]; saved: boolean; onSave: (v: string) => Promise<string | null> }): React.JSX.Element {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    const e = await onSave(v.trim())
    setErr(e)
    if (!e) setV('')
  }
  return (
    <div>
      <Field label={label} hint={hint.map((h) => <span key={h} className="block">{h}</span>)}>
        <div className="flex gap-2">
          <TextInput type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)}
            placeholder={saved ? 'сохранён, введите новый, чтобы заменить' : 'вставьте ключ'} />
          <Button variant="ghost" disabled={!v.trim()} onClick={save}>Сохранить</Button>
        </div>
      </Field>
      {saved && <p className="mt-1 text-xs text-ok font-mono">сохранён ✓</p>}
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  )
}
