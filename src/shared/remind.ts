export type RemindPreset = 'tomorrow' | 'days3' | 'week' | { date: string }

const DAYS = { tomorrow: 1, days3: 3, week: 7 } as const

/** Напоминание всегда на 10:00 местного времени. */
export function remindAt(now: number, preset: RemindPreset): number {
  if (typeof preset === 'object') {
    const [y, m, d] = preset.date.split('-').map(Number)
    return new Date(y, m - 1, d, 10, 0, 0, 0).getTime()
  }
  const n = new Date(now)
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + DAYS[preset], 10, 0, 0, 0).getTime()
}

/** Значение <input type="date"> -> пресет, либо null, если даты нет или она невозможная. */
export function parseDateInput(v: string): { date: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { date: v } : null
}
