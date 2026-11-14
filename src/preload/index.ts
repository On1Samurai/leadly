import { contextBridge } from 'electron'

// IPC API добавляется в следующих задачах
const api = {}

contextBridge.exposeInMainWorld('api', api)
