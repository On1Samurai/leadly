import { ipcMain } from 'electron'
import { createIpc } from './ipc/handlers'
import type { IpcDeps } from './ipc/define'

export type { IpcDeps } from './ipc/define'

/** По одному ipcMain.handle на канал. Возвращает признак «идёт проход» для жизненного цикла приложения. */
export function registerIpc(deps: IpcDeps): { isPassRunning(): boolean } {
  const { handlers, isPassRunning } = createIpc(deps)
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (e, ...args) => fn(e, ...args))
  }
  return { isPassRunning }
}
