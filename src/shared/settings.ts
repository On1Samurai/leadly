export type Tone = 'business' | 'friendly' | 'short'

/** Настройки спеки §9 (без ключей: они живут в main, см. secrets.ts). */
export interface AppSettings {
  sells: string[]; custom: string
  country: 'RU' | 'BY' | 'UA' | (string & {})
  lang: 'ru' | 'uk'; tone: Tone
  sizeKm: 0.5 | 1 | 2
  densityThreshold: number; nextPageThreshold: number; randomEvery: number; googleBudget: number
  dailyWriteLimit: number; dailyGoal: number; noReplyDays: number
  digestTime: string
  autostart: boolean; runInBackground: boolean; onboarded: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  sells: [], custom: '', country: 'RU', lang: 'ru', tone: 'business', sizeKm: 1,
  densityThreshold: 3, nextPageThreshold: 10, randomEvery: 5, googleBudget: 50,
  dailyWriteLimit: 30, dailyGoal: 6, noReplyDays: 7, digestTime: '09:00',
  autostart: false, runInBackground: false, onboarded: false
}

export type NumKey = 'densityThreshold' | 'nextPageThreshold' | 'randomEvery' | 'googleBudget' | 'dailyWriteLimit' | 'dailyGoal' | 'noReplyDays'
/** Единый источник диапазонов числовых настроек: zod-схема в main и поля в Settings. */
export const NUM_LIMITS: Record<NumKey, { min: number; max: number }> = {
  densityThreshold: { min: 0, max: 1_000_000 },
  nextPageThreshold: { min: 0, max: 1_000_000 },
  randomEvery: { min: 1, max: 1_000_000 },
  googleBudget: { min: 0, max: 1_000_000 },
  dailyWriteLimit: { min: 1, max: 1_000_000 },
  dailyGoal: { min: 1, max: 1_000_000 },
  noReplyDays: { min: 1, max: 1_000_000 }
}

/** Проверка черновика числа: целое в диапазоне, иначе null. */
export function parseNumDraft(draft: string, key: NumKey): number | null {
  const t = draft.trim()
  if (!/^\d+$/.test(t)) return null
  const v = Number(t)
  const { min, max } = NUM_LIMITS[key]
  return v >= min && v <= max ? v : null
}
