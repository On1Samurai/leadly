import { app, clipboard, dialog, safeStorage, shell, BrowserWindow } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { join } from 'path'
import { AuditQueue } from './audit/queue'
import { runAudit } from './audit/runner'
import { openDb, type Db } from './db/db'
import { registerIpc } from './ipc'
import { makeAuditWorker } from './ipc/audit-worker'
import { backupNow } from './backup'
import { PRIORS } from './ipc/data'
import { desktopNotifier } from './notify'
import { makeHandlers, noreplyRescore, Scheduler } from './scheduler'
import { loadSettings } from './settings'
import { buildOverpassQuery, fetchOverpass, parseOverpass } from './sources/osm'

let db: Db | null = null
let auditQueue: AuditQueue | null = null
let scheduler: Scheduler | null = null
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
  queue.onIdle = maybeQuit
  passRunning = registerIpc({
    db: conn,
    secretEnv: { safeStorage, isDev: !app.isPackaged, env: process.env },
    userDataDir,
    auditQueue: queue,
    onPassEnd: maybeQuit,
    now: Date.now,
    rng: Math.random,
    osm: (bbox, cat) => fetchOverpass(buildOverpassQuery(bbox, cat)).then(parseOverpass),
    saveDialog: async (defaultName) => {
      const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'SQLite', extensions: ['db'] }] })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    openExternal: (url) => shell.openExternal(url),
    writeClipboard: (text) => clipboard.writeText(text),
    anthropicFactory: (apiKey) => new Anthropic({ apiKey })
  }).isPassRunning
  const sch = new Scheduler(conn, makeHandlers(conn, {
    notify: desktopNotifier, // Задача 18 заменит на уведомитель с ботом
    backup: (now) => backupNow(conn, join(userDataDir, 'backups'), now),
    noreply: (now) => noreplyRescore(conn, PRIORS, now)
  }), Date.now, () => ({ digestTime: loadSettings(conn).digestTime, latestCatchUp: '12:00' }))
  scheduler = sch
  sch.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Выходим, только когда окон нет, платформа не darwin и работа (проход, аудиты) закончилась. Трей добавит Задача 18.
function maybeQuit(): void {
  if (process.platform === 'darwin' || BrowserWindow.getAllWindows().length > 0) return
  if (passRunning() || (auditQueue?.size() ?? 0) > 0) return
  app.quit()
}

app.on('window-all-closed', maybeQuit)

// закрываем БД только после того, как текущий тик планировщика закончился
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (scheduler?.stop() ?? Promise.resolve()).finally(() => { scheduler = null; db?.close(); db = null; app.quit() })
})
