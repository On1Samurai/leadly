import type { NextAction as NA } from '../../../shared/nextAction'
import { Button } from './Button'

export function NextAction({ action, onAct }: { action: NA; onAct: (a: NonNullable<NA>) => void }): React.JSX.Element | null {
  if (!action) return null
  return (
    <section aria-label="Что дальше" className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface px-4 py-3">
      <span className="text-xs text-muted">Что дальше</span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{action.line}</span>
      <Button onClick={() => onAct(action)}>{action.button}</Button>
    </section>
  )
}
