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
