const COLORS = {
  none: 'text-red-400 border-red-400/40',
  social: 'text-amber-400 border-amber-400/40',
  template: 'text-sky-400 border-sky-400/40',
  own: 'text-emerald-400 border-emerald-400/40',
  neutral: 'text-muted border-line'
} as const

/** Метка: цвет только у статуса сайта (none/social/template/own). */
export function Tag({ kind = 'neutral', children }: { kind?: keyof typeof COLORS; children: React.ReactNode }): React.JSX.Element {
  return <span className={`inline-block rounded-md border px-2 py-0.5 font-mono text-xs ${COLORS[kind]}`}>{children}</span>
}
