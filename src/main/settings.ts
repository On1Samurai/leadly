import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings'
import type { Db } from './db/db'
import { getSetting, setSetting } from './db/repo'

const KEY = 'app'

export function loadSettings(db: Db): AppSettings {
  return { ...DEFAULT_SETTINGS, ...getSetting<Partial<AppSettings>>(db, KEY, {}) }
}

export function saveSettings(db: Db, patch: Partial<AppSettings>): void {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  setSetting(db, KEY, { ...loadSettings(db), ...clean })
}
