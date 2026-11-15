export interface CellStyle { fillOpacity: number; weight: number; color: string; opacity: number }

/** Стиль квадрата: заливка белым пропорциональна newCount/max, верхние 10% — толстый контур. */
export function cellStyle(newCount: number, max: number, isTop: boolean): CellStyle {
  if (newCount <= 0) return { fillOpacity: 0, weight: 0.5, color: '#ffffff', opacity: 0.25 }
  const fillOpacity = 0.08 + 0.5 * (max > 0 ? newCount / max : 0)
  return isTop ? { fillOpacity, weight: 2.5, color: '#ffffff', opacity: 1 } : { fillOpacity, weight: 1, color: '#ffffff', opacity: 0.6 }
}

/** Порог верхних 10% по newCount среди квадратов с newCount > 0 (минимум один). Нет положительных — Infinity. */
export function topThreshold(counts: number[]): number {
  const pos = counts.filter((n) => n > 0).sort((a, b) => b - a)
  if (pos.length === 0) return Infinity
  return pos[Math.max(1, Math.ceil(pos.length * 0.1)) - 1]
}

export function passErrorText(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
  if (m.includes('pass_running')) return 'Поиск уже идёт'
  if (m.includes('city_too_large')) return 'Слишком большая территория — выберите город, а не область или страну'
  return `Ошибка: ${m}`
}
