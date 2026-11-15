import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UPDATE_EVENT, type UpdateEvent } from '../shared/ipc'

const HOUR = 3_600_000

/** Тонкая обёртка над electron-updater. В dev (!isPackaged) возвращает null: IPC отвечает { state: 'none', message: 'dev' }. */
export function createUpdater(): { check(): Promise<UpdateEvent>; download(): Promise<void>; install(): void; status(): UpdateEvent } | null {
  if (!app.isPackaged) return null
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  let last: UpdateEvent = { state: 'idle' }
  const emit = (e: UpdateEvent): void => {
    last = e
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send(UPDATE_EVENT, e) } catch { /* окно закрыто */ }
    }
  }
  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => emit({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => emit({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', version: last.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => emit({ state: 'downloaded', version: i.version }))
  autoUpdater.on('error', (e) => emit({ state: 'error', version: last.version, message: e.message.slice(0, 300) }))

  const check = async (): Promise<UpdateEvent> => {
    try { await autoUpdater.checkForUpdates() } catch { /* событие error уже отправлено */ }
    return last
  }
  setTimeout(() => void check(), 10_000).unref()
  setInterval(() => void check(), 6 * HOUR).unref()

  return {
    check,
    download: async () => { await autoUpdater.downloadUpdate() },
    // уходит через обычный before-quit (планировщик, бот, БД), затем app.quit() запускает установщик
    install: () => { autoUpdater.quitAndInstall() },
    status: () => last
  }
}
