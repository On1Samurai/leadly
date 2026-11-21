import { app, clipboard, dialog, safeStorage, shell, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { navDecision } from './app-url'
import { AuditQueue } from './audit/queue'
import { runAudit } from './audit/runner'
import { openDb, type Db } from './db/db'
import { registerIpc } from './ipc'
import { makeAuditWorker } from './ipc/audit-worker'
import { backupNow } from './backup'
import { PRIORS } from './ipc/data'
import { desktopNotifier } from './notify'
import { createBotManager, type BotManager } from './bot/bot'
import { botNotifier } from './bot/notifier'
import { getSecret, getWorkerSecret } from './secrets'
import { getSetting } from './db/repo'
import type { WorkerConfig } from './demo/cloudflare'
import { syncDemoEvents } from './demo/events'
import { WorkerApi } from './demo/worker-api'
import { rescoreAll } from './core/logreg'
import { makeHandlers, noreplyRescore, Scheduler } from './scheduler'
import { loadSettings } from './settings'
import { createUpdater } from './updater'
import { realSleep } from './sources/http'
import { buildOverpassQuery, fetchOverpass, parseOverpass } from './sources/osm'

let db: Db | null = null
let auditQueue: AuditQueue | null = null
let scheduler: Scheduler | null = null
let bot: BotManager | null = null
let tray: Tray | null = null
let mainWin: BrowserWindow | null = null
let quitting = false
const hidden = process.argv.includes('--hidden')
let passRunning: () => boolean = () => false

function showWindow(): void {
  if (!mainWin || mainWin.isDestroyed()) { createWindow(true); return }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

function createWindow(show: boolean): void {
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

  mainWin = win
  win.on('ready-to-show', () => { if (show) win.show() })
  // закрытие сворачивает в трей, если нужна работа в фоне или работает бот
  win.on('close', (e) => {
    if (quitting || !tray || !db || !(loadSettings(db).runInBackground || bot?.running())) return
    e.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const appUrl = devUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  // ссылка (атрибуция карты) или брошенный в окно файл не должны увести окно с preload-API на чужую страницу
  const guard = (e: { preventDefault(): void }, url: string): void => {
    const d = navDecision(url, appUrl)
    if (d === 'allow') return
    e.preventDefault()
    if (d === 'external') shell.openExternal(url).catch(() => undefined)
  }
  win.webContents.on('will-navigate', (e, url) => guard(e, url))
  win.webContents.on('will-redirect', (e, url) => guard(e, url))

  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// одна копия программы: вторая запуск показывает окно первой
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', () => { if (app.isReady()) showWindow() })

const applyAutostart = (conn: Db): void => {
  if (!app.isPackaged) return // в dev иначе в автозапуск попадёт сам electron
  app.setLoginItemSettings({ openAtLogin: loadSettings(conn).autostart, args: ['--hidden'] })
}

/** HTML -> PDF через скрытое окно; файл и окно убираются и при ошибке. Через файл, а не data: URL (лимит ~2 МБ). */
async function printPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  const file = join(app.getPath('temp'), `leadly-print-${randomUUID()}.html`)
  try {
    writeFileSync(file, html)
    await win.loadFile(file)
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return
  const userDataDir = app.getPath('userData')
  const conn = openDb(join(userDataDir, 'leadly.db'))
  db = conn
  const secretEnv = { safeStorage, isDev: !app.isPackaged, env: process.env }
  const botMgr = createBotManager(conn, () => getSecret(conn, 'telegram', secretEnv))
  bot = botMgr
  botMgr.restart().catch((e) => console.error('bot restart failed', (e as Error).name))
  applyAutostart(conn)
  const queue = new AuditQueue(2, makeAuditWorker(conn, userDataDir, (url, opts) => runAudit(url, opts)))
  auditQueue = queue
  queue.onIdle = maybeQuit
  passRunning = registerIpc({
    db: conn,
    secretEnv,
    bot: botMgr,
    onSecretSet: (name) => { if (name === 'telegram') botMgr.restart().catch((e) => console.error('bot restart failed', (e as Error).name)) },
    onSettingsSet: () => applyAutostart(conn),
    userDataDir,
    appVersion: () => app.getVersion(),
    updater: createUpdater() ?? undefined,
    auditQueue: queue,
    onPassEnd: maybeQuit,
    now: Date.now,
    rng: Math.random,
    osm: (bbox, cat) => fetchOverpass(buildOverpassQuery(bbox, cat)).then(parseOverpass),
    saveDialog: async (defaultName, kind = 'db') => {
      const filters = kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'SQLite', extensions: ['db'] }]
      const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    fetch: (input, init) => fetch(input, init),
    sleep: realSleep,
    resizeImage: (b, maxWidth = 1200) => {
      const img = nativeImage.createFromBuffer(b)
      if (img.isEmpty()) throw new Error('bad_image')
      const { width } = img.getSize()
      const jpg = (width > maxWidth ? img.resize({ width: maxWidth }) : img).toJPEG(80)
      if (!jpg.length) throw new Error('bad_image')
      return jpg
    },
    printPdf,
    openDialog: async (kind) => {
      const filters = {
        folder: [], zip: [{ name: 'ZIP', extensions: ['zip'] }], html: [{ name: 'HTML', extensions: ['html', 'htm'] }],
        image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
      }[kind]
      const r = await dialog.showOpenDialog({ properties: kind === 'folder' ? ['openDirectory'] : ['openFile'], filters })
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
    },
    openExternal: (url) => shell.openExternal(url),
    writeClipboard: (text) => clipboard.writeText(text),
    anthropicFactory: (apiKey) => new Anthropic({ apiKey })
  }).isPassRunning
  const notifier = botNotifier({
    send: (html) => botMgr.send(html), bound: botMgr.bound, unlink: botMgr.unlink, desktop: desktopNotifier,
    log: (m, e) => console.error(m, e)
  })
  const sch = new Scheduler(conn, makeHandlers(conn, {
    notify: notifier,
    backup: (now) => backupNow(conn, join(userDataDir, 'backups'), now),
    noreply: (now) => noreplyRescore(conn, PRIORS, now),
    rescore: (now) => rescoreAll(conn, PRIORS, now),
    demoEvents: async (now) => {
      const cfg = getSetting<WorkerConfig | null>(conn, 'demo:worker', null)
      const secret = getWorkerSecret(conn, secretEnv)
      if (!cfg || !secret) return
      await syncDemoEvents(conn, new WorkerApi(fetch, cfg.url, secret), now, (e) => notifier.demo(e))
    }
  }), Date.now, () => ({ digestTime: loadSettings(conn).digestTime, latestCatchUp: '12:00' }))
  scheduler = sch
  sch.start()
  try {
    const t = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'resources/icon.png')))
    t.setToolTip('Leadly')
    t.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть', click: showWindow },
      { label: 'Выход', click: () => app.quit() }
    ]))
    t.on('click', showWindow)
    tray = t
  } catch (err) { console.error('tray failed', (err as Error).name) }
  createWindow(!hidden || !tray) // без трея скрытый запуск оставил бы приложение невидимым
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true)
  })
})

// Выходим, только когда окон нет, платформа не darwin и работа (проход, аудиты) закончилась. Окно в трее (hide) остаётся в списке окон, поэтому выход идёт через трей.
function maybeQuit(): void {
  if (process.platform === 'darwin' || BrowserWindow.getAllWindows().length > 0) return
  if (passRunning() || (auditQueue?.size() ?? 0) > 0) return
  app.quit()
}

app.on('window-all-closed', maybeQuit)

// закрываем БД только после того, как текущий тик планировщика закончился
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    const bounded = (p: Promise<unknown> | undefined): Promise<unknown> =>
      Promise.race([p ?? Promise.resolve(), new Promise((r) => setTimeout(r, 5000).unref())]).catch((err) => console.error('shutdown step failed', (err as Error).name))
    await bounded(scheduler?.stop())
    await bounded(bot?.stop())
    scheduler = null; bot = null; tray?.destroy(); tray = null
    try { db?.close() } catch (err) { console.error('db close failed', err) }
    db = null
    app.quit()
  })()
})
