import { contextBridge, ipcRenderer } from 'electron'
import { METHODS, PASS_EVENT, type Api, type PassEvent } from '../shared/ipc'

// window.api строится только из списка каналов METHODS: ничего сверх Api
const api: Record<string, Record<string, unknown>> = {}
for (const [group, methods] of Object.entries(METHODS)) {
  api[group] = {}
  for (const method of Object.keys(methods)) {
    api[group][method] = (...args: unknown[]) => ipcRenderer.invoke(`${group}.${method}`, ...args)
  }
}
api.pass.onEvent = (cb: (e: PassEvent) => void): (() => void) => {
  const l = (_: unknown, e: PassEvent): void => cb(e)
  ipcRenderer.on(PASS_EVENT, l)
  return () => { ipcRenderer.removeListener(PASS_EVENT, l) }
}

contextBridge.exposeInMainWorld('api', api as unknown as Api)
