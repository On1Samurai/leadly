import { app, dialog, safeStorage, shell, BrowserWindow } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { join } from 'path'
import { AuditQueue } from './audit/queue'
import { runAudit } from './audit/runner'
import { openDb, type Db } from './db/db'
import { registerIpc } from './ipc'
import { makeAuditWorker } from './ipc/audit-worker'
import { buildOverpassQuery, fetchOverpass, parseOverpass } from './sources/osm'

let db: Db | null = null
let auditQueue: AuditQueue | null = null
let passRunning: () => boolean = () => false

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  const conn = openDb(join(userDataDir, 'local-leads.db'))
  db = conn
  const queue = new AuditQueue(2, makeAuditWorker(conn, userDataDir, (url, opts) => runAudit(url, opts)))
  auditQueue = queue
  passRunning = registerIpc({
    db: conn,
    secretEnv: { safeStorage, isDev: !app.isPackaged, env: process.env },
    userDataDir,
    auditQueue: queue,
    now: Date.now,
    rng: Math.random,
    osm: (bbox, cat) => fetchOverpass(buildOverpassQuery(bbox, cat)).then(parseOverpass),
    saveDialog: async (defaultName) => {
      const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'SQLite', extensions: ['db'] }] })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    anthropicFactory: (apiKey) => new Anthropic({ apiKey })
  }).isPassRunning
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // проход или аудиты ещё идут: не выходим (трей добавит Задача 18); выйдем, когда всё закончится
  if (passRunning() || (auditQueue?.size() ?? 0) > 0) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { db?.close(); db = null })
