import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaceDetails } from '../../../../shared/ipc'
import { percentLabel } from '../../../../shared/percent'
import { genErrorText } from '../../../../shared/genError'
import type { Tone } from '../../../../shared/settings'
import type { Channel } from '../../../../shared/types'
import { errText } from '../../lib'
import { CHANNEL_LABEL } from '../../labels'
import { Button } from '../Button'

const TONES: [Tone, string][] = [['business', 'Деловой'], ['friendly', 'Дружелюбный'], ['short', 'Коротко']]
const MAX = 1000

interface Pending { ch: Channel; text: string; hint: string }

interface Props { d: PlaceDetails; tone: Tone; limit: number; onTone: (t: Tone) => void; onWritten: () => void }

export function Now({ d, tone, limit, onTone, onWritten }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const req = useRef(0)

  const generate = useCallback(() => {
    const r = ++req.current
    setBusy(true); setErr(null)
    window.api.message.generate(d.id, tone)
      .then((x) => { if (r === req.current) setText(x.text) })
      .catch((e) => { if (r === req.current) { setText(''); setErr(genErrorText(e)) } })
      .finally(() => { if (r === req.current) setBusy(false) })
  }, [d.id, tone])

  // новая карточка или смена тона — новый текст; правка вручную ничего не перегенерирует
  useEffect(() => { setPending(null); setNote(null); generate(); return () => { req.current++ } }, [generate])

  const write = (ch: Channel): void => {
    setNote(null)
    window.api.write.open(d.id, ch, text)
      .then((r) => {
        if ('blocked' in r) { setPending(null); setNote(`Лимит на сегодня исчерпан (${limit}). Завтра снова можно`); return }
        const hint = r.url === null ? 'Текст скопирован — откройте мессенджер вручную'
          : r.prefilled ? 'Текст подставлен в сообщение' : 'Текст скопирован — вставьте его в чат (Ctrl+V)'
        setPending({ ch, text, hint })
      })
      .catch((e) => setNote(errText(e)))
  }

  const confirm = (): void => {
    if (!pending) return
    window.api.write.confirm(d.id, pending.ch, pending.text)
      .then(() => { setPending(null); onWritten() })
      .catch((e) => setNote(errText(e)))
  }

  const bad = text.trim() === '' || text.length > MAX
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-2xl">{percentLabel(d.score.p * 100)}</p>
        <p className="text-sm text-muted">{d.score.reason || 'нет явных причин'}</p>
      </div>
      <div role="group" aria-label="Тон" className="flex overflow-hidden rounded-lg border border-line text-sm">
        {TONES.map(([t, l]) => (
          <button key={t} type="button" aria-pressed={tone === t} onClick={() => onTone(t)}
            className={`flex-1 cursor-pointer px-3 py-1.5 ${tone === t ? 'bg-accent font-semibold text-bg' : 'text-muted hover:text-fg'}`}>{l}</button>
        ))}
      </div>
      {busy && <p role="status" className="text-sm text-muted">Пишу текст…</p>}
      {err && (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>{err}</span><Button variant="ghost" onClick={generate}>Повторить</Button>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Текст сообщения (можно править)</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} disabled={busy}
          className="resize-y rounded-lg border border-line bg-surface p-3 text-sm text-fg" />
        <span className={`self-end font-mono text-xs ${text.length > MAX ? 'text-danger' : 'text-muted'}`}>{text.length} / {MAX}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {d.channels.length === 0 && <p className="text-sm text-muted">Нет доступных каналов связи.</p>}
        {d.channels.map((c) => (
          <Button key={c} disabled={bad || busy} onClick={() => write(c)}>Написать · {CHANNEL_LABEL[c].title}</Button>
        ))}
      </div>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      {pending && (
        <div role="alertdialog" aria-label="Отправили?" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-muted">{pending.hint}</p>
          <p className="font-semibold">Отправили?</p>
          <div className="flex gap-2">
            <Button onClick={confirm}>Да</Button>
            <Button variant="ghost" onClick={() => setPending(null)}>Нет</Button>
          </div>
        </div>
      )}
    </div>
  )
}
