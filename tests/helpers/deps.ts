import type { IpcDeps } from '../../src/main/ipc/define'

/** Фейки зависимостей этапа 2 для сборки IpcDeps в тестах. */
export const stage2Deps: Pick<IpcDeps, 'fetch' | 'sleep' | 'resizeImage' | 'printPdf' | 'openDialog'> = {
  fetch: async () => { throw new Error('unused') },
  sleep: async () => undefined,
  resizeImage: (b) => b,
  printPdf: async () => Buffer.alloc(0),
  openDialog: async () => null
}
