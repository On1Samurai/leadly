import { randomUUID } from 'node:crypto'
import type { ChannelName, CityHit } from '../../shared/ipc'
import { hasSecret, SECRET_NAMES, setSecret } from '../secrets'
import { loadSettings, saveSettings } from '../settings'
import { searchCity } from '../sources/nominatim'
import { define, stub, type Fn, type IpcDeps, type Table } from './define'
import { passHandlers } from './pass'
import { writeHandlers } from './write'
import { placesHandlers } from './places'
import type { TodayView } from '../../shared/ipc'
import { backupTo } from '../backup'
import { todayView } from '../today'
import { computeMission } from '../../shared/mission'

export type { IpcDeps } from './define'

export function createIpc(d: IpcDeps): { handlers: Record<ChannelName, Fn>; isPassRunning(): boolean } {
  const { db } = d
  const t: Table = {}

  define(t, 'settings.get', () => loadSettings(db))
  define(t, 'settings.set', (_e, patch) => saveSettings(db, patch))

  // секреты: только set и has(boolean). Метода get в IPC нет и быть не должно
  define(t, 'secrets.set', (_e, name, value) => setSecret(db, name, value, d.secretEnv))
  define(t, 'secrets.has', () => Object.fromEntries(SECRET_NAMES.map((n) => [n, hasSecret(db, n, d.secretEnv)])))

  // геометрию города renderer не присылает: хиты живут в main, save получает только id
  let hits = new Map<string, CityHit>()
  define(t, 'city.search', async (_e, q) => {
    const found = await searchCity(q, loadSettings(db).country)
    hits = new Map()
    return found.map((h) => { const hit: CityHit = { id: randomUUID(), ...h }; hits.set(hit.id, hit); return hit })
  })
  define(t, 'city.save', (_e, { id }) => {
    const hit = hits.get(id)
    if (!hit) throw new Error('unknown_city')
    return Number(db.prepare('INSERT INTO cities(name,country,bbox,polygon,created_at) VALUES (?,?,?,?,?)')
      .run(hit.name || hit.displayName, loadSettings(db).country, JSON.stringify(hit.bbox),
        hit.polygon ? JSON.stringify(hit.polygon) : null, d.now()).lastInsertRowid)
  })
  define(t, 'city.list', () => db.prepare('SELECT id, name FROM cities ORDER BY id').all())

  const pass = passHandlers(t, d)
  placesHandlers(t, d)
  writeHandlers(t, d)

  define(t, 'today.get', (): TodayView => todayView(db, d.now(), loadSettings(db).dailyGoal))

  define(t, 'mission.get', () => {
    const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    return computeMission({
      cities: n('SELECT COUNT(*) AS n FROM cities'),
      places: n('SELECT COUNT(*) AS n FROM places'),
      inBase: n('SELECT COUNT(*) AS n FROM places WHERE in_base=1'),
      written: n("SELECT COUNT(DISTINCT place_id) AS n FROM status_log WHERE to_status='written'")
    })
  })

  define(t, 'app.dataDir', () => d.userDataDir)

  define(t, 'backup.export', async () => {
    const dest = await d.saveDialog(`local-leads-${new Date(d.now()).toISOString().slice(0, 10)}.db`)
    if (!dest) return null
    await backupTo(db, dest)
    return dest
  })

  // заглушки: bot.* (Задача 18)
  for (const n of ['bot.bindCode', 'bot.status'] as const) stub(t, n)

  return { handlers: t as Record<ChannelName, Fn>, isPassRunning: pass.isRunning }
}

export const buildHandlers = (d: IpcDeps): Record<ChannelName, Fn> => createIpc(d).handlers
