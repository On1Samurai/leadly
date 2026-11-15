import { useState } from 'react'
import type { PlaceDetails } from '../../../../shared/ipc'
import { errText } from '../../lib'
import { CHANNEL_LABEL } from '../../labels'
import { Button } from '../Button'

const DIR = { out: 'Мы', in: 'Они', note: 'Заметка' } as const
const fmt = (ts: number): string => new Date(ts).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function Chat({ d, onChanged }: { d: PlaceDetails; onChanged: () => void }): React.JSX.Element {
  const [reply, setReply] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const add = (dir: 'in' | 'note', text: string, clear: () => void): void => {
    if (!text.trim()) return
    window.api.places.note(d.id, dir, text)
      .then(() => { clear(); setErr(null); onChanged() })
      .catch((e) => setErr(errText(e)))
  }

  return (
    <div className="flex flex-col gap-4">
      {d.messages.length === 0 && <p className="text-sm text-muted">Переписки пока нет.</p>}
      <ul className="flex flex-col gap-2">
        {d.messages.map((m, i) => (
          <li key={i} className={`rounded-card border border-line p-3 text-sm ${m.direction === 'out' ? 'bg-surface' : ''}`}>
            <p className="mb-1 text-xs text-muted">
              {DIR[m.direction]}{m.channel ? ` · ${CHANNEL_LABEL[m.channel].title}` : ''} · {fmt(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap">{m.text}</p>
          </li>
        ))}
      </ul>
      {([['Вставить ответ', reply, setReply, 'in', 'Добавить ответ'], ['Заметка', note, setNote, 'note', 'Добавить заметку']] as const).map(([label, v, set, dir, btn]) => (
        <div key={dir} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{label}</span>
            <textarea value={v} onChange={(e) => set(e.target.value)} rows={3} maxLength={5000}
              className="resize-y rounded-lg border border-line bg-surface p-3 text-sm text-fg" />
          </label>
          <Button variant="ghost" className="self-start" disabled={!v.trim()} onClick={() => add(dir, v, () => set(''))}>{btn}</Button>
        </div>
      ))}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  )
}
