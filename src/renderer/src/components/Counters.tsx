export interface PassCounters { cellsDone: number; cellsTotal: number; newCount: number; dupCount: number; googleUsed: number; budget: number }

export function Counters({ c }: { c: PassCounters }): React.JSX.Element {
  const items: [string, string][] = [
    ['квадратов', `${c.cellsDone} / ${c.cellsTotal}`],
    ['новых', String(c.newCount)],
    ['уже было', String(c.dupCount)],
    ['Google', `${c.googleUsed} / ${c.budget}`]
  ]
  return (
    <dl className="flex flex-wrap gap-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-card border border-line bg-surface px-4 py-2">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-mono text-lg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
