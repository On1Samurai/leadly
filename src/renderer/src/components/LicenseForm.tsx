import { useState } from 'react'
import type { LicenseState } from '../../../shared/ipc'
import { errText } from '../lib'
import { Button } from './Button'
import { inputCls } from './Field'

export function LicenseForm({ onActivated }: { onActivated: (s: LicenseState) => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null)
    try { onActivated(await window.api.license.set(key)) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-3">
      <textarea className={`${inputCls} h-28 resize-none break-all font-mono text-xs`} placeholder="LEADLY-…" aria-label="Лицензионный ключ"
        value={key} onChange={(e) => setKey(e.target.value)} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button onClick={submit} disabled={busy || !key.trim()}>Активировать</Button>
    </div>
  )
}
