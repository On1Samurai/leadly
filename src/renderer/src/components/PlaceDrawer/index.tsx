import { useCallback, useEffect, useState } from 'react'
import type { PlaceDetails } from '../../../../shared/ipc'
import { DEFAULT_SETTINGS, type AppSettings, type Tone } from '../../../../shared/settings'
import { errText } from '../../lib'
import { Chat } from './Chat'
import { Now } from './Now'
import { Venue } from './Venue'
import { Work } from './Work'

const TABS = [['now', 'Сейчас'], ['chat', 'Переписка'], ['venue', 'Заведение'], ['work', 'Работа']] as const
type Tab = (typeof TABS)[number][0]

interface Props {
  id: number | null
  /** упорядоченные id загруженного списка: по ним листают стрелками */
  ids: number[]
  total: number
  onMove: (id: number) => void
  onClose: () => void
  /** карточка изменилась (статус, текст отправлен): Base обновляет строку */
  onChanged: (id: number) => void
  onRemoved: (id: number) => void
}

export function PlaceDrawer({ id, ids, total, onMove, onClose, onChanged, onRemoved }: Props): React.JSX.Element | null {
  const [d, setD] = useState<PlaceDetails | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [tone, setTone] = useState<Tone>(DEFAULT_SETTINGS.tone)
  const [tab, setTab] = useState<Tab>('now')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (id === null) return
    window.api.settings.get().then((s) => { setSettings(s); setTone(s.tone) }).catch(() => undefined)
  }, [id === null])

  const load = useCallback((pid: number): void => {
    window.api.places.get(pid).then(setD).catch((e) => setErr(errText(e)))
  }, [])

  useEffect(() => {
    if (id === null) { setD(null); return }
    setErr(null); setTab('now'); setD(null)
    load(id)
  }, [id, load])

  const idx = id === null ? -1 : ids.indexOf(id)
  const move = useCallback((delta: number) => {
    const next = ids[idx + delta]
    if (next !== undefined) onMove(next)
  }, [ids, idx, onMove])

  useEffect(() => {
    if (id === null) return
    const h = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || document.querySelector('[data-overlay]')) return
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return // Esc в поле ввода не закрывает панель
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [id, onClose, move])

  if (id === null) return null
  const changed = (): void => { load(id); onChanged(id) }

  return (
    <aside aria-label="Карточка заведения" className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-line bg-bg shadow-2xl">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" aria-label="Предыдущая" disabled={idx <= 0} onClick={() => move(-1)} className="cursor-pointer px-2 text-muted hover:text-fg disabled:opacity-30">←</button>
        <span className="font-mono text-xs text-muted">{idx >= 0 ? idx + 1 : '–'} / {Math.max(total, ids.length)}</span>
        <button type="button" aria-label="Следующая" disabled={idx < 0 || idx >= ids.length - 1} onClick={() => move(1)} className="cursor-pointer px-2 text-muted hover:text-fg disabled:opacity-30">→</button>
        <h2 className="min-w-0 flex-1 truncate text-center font-semibold">{d?.name ?? ''}</h2>
        <button type="button" aria-label="Закрыть" onClick={onClose} className="cursor-pointer px-2 text-muted hover:text-fg">✕</button>
      </header>
      <nav role="tablist" className="flex border-b border-line text-sm">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 cursor-pointer px-2 py-2 ${tab === k ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-fg'}`}>{l}</button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-4">
        {err && <p role="alert" className="text-danger">{err}</p>}
        {!d && !err && <p className="text-sm text-muted">Загрузка…</p>}
        {/* Now не размонтируем при смене вкладки: иначе потеряется правка текста */}
        {d && <div hidden={tab !== 'now'}><Now key={d.id} d={d} tone={tone} onTone={setTone} onWritten={changed} /></div>}
        {d && tab === 'chat' && <Chat d={d} onChanged={() => load(d.id)} />}
        {d && tab === 'venue' && <Venue d={d} onChanged={changed} onRemoved={() => onRemoved(d.id)} />}
        {d && tab === 'work' && <Work d={d} country={settings.country} onChanged={changed} />}
      </div>
    </aside>
  )
}
