import type { PassEvent, PassStatus } from '../../shared/ipc'

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

export interface PassCounters { cellsDone: number; cellsTotal: number; newCount: number; dupCount: number; googleUsed: number; budget: number }
export interface SearchState {
  running: boolean; paused: boolean; finished: boolean
  counters: PassCounters
  /** newCount квадратов, обновлённых событиями текущего прохода; остальные берутся из БД. */
  live: Record<string, number>
  /** Новый проход: квадраты без события — 0, а не накопленное из БД. */
  fresh: boolean
  warnings: string[]; error: string | null
}
export type SearchAction =
  | { type: 'reset'; budget?: number }
  | { type: 'start'; cellsTotal: number }
  | { type: 'restore'; status: PassStatus }
  | { type: 'event'; e: PassEvent }
  | { type: 'cellsTotal'; total: number }
  | { type: 'paused'; value: boolean }
  | { type: 'startFailed'; error: unknown }
  | { type: 'error'; error: unknown }

export const cellKey = (ix: number, iy: number): string => `${ix},${iy}`
export const initialState = (budget: number): SearchState => ({
  running: false, paused: false, finished: false, live: {}, fresh: false, warnings: [], error: null,
  counters: { cellsDone: 0, cellsTotal: 0, newCount: 0, dupCount: 0, googleUsed: 0, budget }
})
export const cellValue = (s: SearchState, c: { ix: number; iy: number; newCount: number }): number =>
  s.live[cellKey(c.ix, c.iy)] ?? (s.fresh ? 0 : c.newCount)

export function reduce(s: SearchState, a: SearchAction): SearchState {
  const budget = s.counters.budget
  switch (a.type) {
    case 'reset': return initialState(a.budget ?? budget)
    case 'start': return { ...initialState(budget), running: true, fresh: true, counters: { ...initialState(budget).counters, cellsTotal: a.cellsTotal } }
    case 'restore': return { ...initialState(budget), running: a.status.running, paused: a.status.paused, warnings: a.status.warnings, counters: { ...a.status.counters, budget } }
    case 'cellsTotal': return { ...s, counters: { ...s.counters, cellsTotal: a.total } }
    case 'paused': return { ...s, paused: a.value }
    case 'error': return { ...s, error: passErrorText(a.error) }
    case 'startFailed': {
      const already = String(a.error instanceof Error ? a.error.message : a.error).includes('pass_running')
      return { ...s, running: already, error: passErrorText(a.error) }
    }
    case 'event': {
      const e = a.e
      if (e.type === 'warning') {
        return e.text.includes('city_too_large') ? { ...s, error: passErrorText(new Error('city_too_large')) } : { ...s, warnings: [...s.warnings, e.text] }
      }
      if (e.type === 'cell') {
        return {
          ...s, live: { ...s.live, [cellKey(e.ix, e.iy)]: e.newCount },
          counters: {
            ...s.counters, cellsDone: s.counters.cellsDone + 1, newCount: s.counters.newCount + e.newCount,
            dupCount: s.counters.dupCount + e.dupCount, googleUsed: s.counters.googleUsed + e.googleRequests
          }
        }
      }
      // done: passId 0 — сбой, итогов нет
      if (e.summary.passId === 0) return { ...s, running: false, paused: false }
      const m = e.summary
      return { ...s, running: false, paused: false, finished: true, counters: { ...s.counters, cellsDone: m.cellsDone, newCount: m.newCount, dupCount: m.dupCount, googleUsed: m.googleUsed } }
    }
  }
}
