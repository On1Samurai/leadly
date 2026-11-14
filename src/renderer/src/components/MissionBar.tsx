import type { MissionStep } from '../../../shared/mission'

const STEPS = ['Выбрать город', 'Найти 20 заведений', 'Выбрать лучшее', 'Отправить первое сообщение']

export function MissionBar({ step }: { step: MissionStep }): React.JSX.Element | null {
  if (step === 'done') return null
  return (
    <ol aria-label="Миссия" className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line bg-surface px-6 py-2 font-mono text-xs">
      {STEPS.map((t, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={t} aria-current={state === 'current' ? 'step' : undefined}
            className={state === 'current' ? 'font-bold text-fg' : state === 'done' ? 'text-muted line-through' : 'text-muted'}>
            {state === 'done' ? '✓' : n}. {t}
          </li>
        )
      })}
    </ol>
  )
}
