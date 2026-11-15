import { memo } from 'react'
import type { PlaceView } from '../../../shared/ipc'
import { percentLabel } from '../../../shared/percent'
import type { WebClass } from '../../../shared/types'
import { CHANNEL_LABEL, WEB_LABEL } from '../labels'

// цвет в интерфейсе только у метки статуса сайта
const WEB_CLS: Record<WebClass, string> = {
  none: 'text-[#f87171] bg-[rgba(248,113,113,0.12)] border-[rgba(248,113,113,0.35)]',
  social: 'text-[#a78bfa] bg-[rgba(167,139,250,0.12)] border-[rgba(167,139,250,0.35)]',
  template: 'text-[#fbbf24] bg-[rgba(251,191,36,0.12)] border-[rgba(251,191,36,0.35)]',
  own: 'text-muted bg-white/5 border-line'
}

interface Props {
  place: PlaceView
  cityName: string
  categoryTitle: string
  onOpen: (id: number) => void
  onToggle: (id: number, inBase: boolean) => void
}

function PlaceCardImpl({ place: p, cityName, categoryTitle, onOpen, onToggle }: Props): React.JSX.Element {
  const meta = [cityName, categoryTitle].filter(Boolean).join(' · ')
  return (
    <article
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 transition-colors hover:border-muted [contain:layout_paint] [content-visibility:auto] [contain-intrinsic-size:auto_210px]"
    >
      <button type="button" onClick={() => onOpen(p.id)} aria-label={`Открыть: ${p.name}`}
        className="flex min-w-0 cursor-pointer flex-col gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-md border px-2 py-0.5 font-mono ${WEB_CLS[p.webClass]}`}>{WEB_LABEL[p.webClass]}</span>
          {p.status === 'new' && <span className="text-muted">новое</span>}
          <span className="font-mono text-fg">{percentLabel(p.score)}</span>
          {p.rating !== null && <span className="ml-auto font-mono text-muted">★ {p.rating}</span>}
        </div>
        <h3 className="truncate text-base font-semibold">{p.name}</h3>
        <p className="truncate text-xs text-muted">{meta}</p>
        <p className="line-clamp-1 text-sm text-muted">{p.scoreReason}</p>
      </button>
      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {p.channels.map((c) => (
          <span key={c} title={CHANNEL_LABEL[c].title} className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">{CHANNEL_LABEL[c].short}</span>
        ))}
        {p.textReady && <span className="ml-1 text-xs text-muted">текст готов</span>}
        <button type="button" onClick={() => onToggle(p.id, !p.inBase)} aria-pressed={p.inBase}
          className={`ml-auto cursor-pointer rounded-lg border px-3 py-1 text-xs transition-colors ${p.inBase ? 'border-line text-muted hover:text-fg' : 'border-accent text-fg hover:bg-accent hover:text-bg'}`}>
          {p.inBase ? 'В базе ✓' : '+ В базу'}
        </button>
      </div>
    </article>
  )
}

export const PlaceCard = memo(PlaceCardImpl)
