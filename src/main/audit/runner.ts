import { BrowserWindow, session } from 'electron'
import type { Contact, Finding } from '../../shared/types'
import { contactFromUrl } from '../core/links'
import { annotationScript } from './annotate'
import { buildInput, type PageData } from './build-input'
import { checkCert } from './cert'
import { detect } from './detect'
import { checkLinks } from './links-check'
import type { AuditResult } from './runner-types'

export type { AuditResult } from './runner-types'

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const PARTITION = 'audit'
const MAX_SHOT_HEIGHT = 6000

interface MainFrameInfo { url: string; contentType: string; headers: Record<string, string> }
const listeners = new Map<number, (i: MainFrameInfo) => void>()
let sessionReady = false

// One session-wide handler multiplexed per webContents: concurrent audits share the 'audit' partition.
function setupSession(): void {
  if (sessionReady) return
  sessionReady = true
  const ses = session.fromPartition(PARTITION)
  ses.on('will-download', (e) => e.preventDefault())
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (d.resourceType === 'mainFrame' && d.webContentsId !== undefined) {
      const l = listeners.get(d.webContentsId)
      if (l) {
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(d.responseHeaders ?? {})) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
        l({ url: d.url, contentType: headers['content-type'] ?? '', headers })
      }
    }
    cb({})
  })
}

const PAGE_SCRIPT = `(() => {
  const vp = !!document.querySelector('meta[name="viewport" i]');
  let total = 0, small = 0;
  const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t || !n.parentElement) continue;
    const cs = getComputedStyle(n.parentElement);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    total += t.length;
    if (parseFloat(cs.fontSize) < 12) small += t.length;
  }
  const nav = performance.getEntriesByType('navigation')[0];
  let loadMs = nav && nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : 0;
  if (!loadMs && performance.timing && performance.timing.loadEventEnd > 0) loadMs = performance.timing.loadEventEnd - performance.timing.navigationStart;
  return {
    viewport: vp,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    smallTextShare: total ? small / total : 0,
    loadMs: loadMs,
    html: document.documentElement.outerHTML,
    text: document.body ? document.body.innerText : '',
    hrefs: Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '')
  };
})()`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms) })]).finally(() => clearTimeout(t))
}

function candidates(url: string): string[] {
  const u = url.trim()
  return /^https?:\/\//i.test(u) ? [u] : [`https://${u}`, `http://${u}`]
}

export async function runAudit(url: string, opts: { timeoutMs?: number; checkMenu?: boolean } = {}): Promise<AuditResult> {
  const timeoutMs = opts.timeoutMs ?? 30000
  setupSession()
  const win = new BrowserWindow({
    show: false, width: 390, height: 844,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  const wc = win.webContents
  let frame: MainFrameInfo | null = null
  listeners.set(wc.id, (i) => { frame = i })
  let attached = false
  try {
    wc.setUserAgent(UA)
    wc.setBackgroundThrottling(false) // hidden window: otherwise captureScreenshot may wait for a frame forever
    await wc.loadURL('about:blank').catch(() => undefined) // CDP commands hang on a window that never navigated
    wc.debugger.attach('1.3')
    attached = true
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: UA })

    const c = candidates(url)
    const attempts = c.length > 1 ? c : [c[0], c[0]]
    let loaded = false
    for (const target of attempts) {
      frame = null
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          wc.loadURL(target, { userAgent: UA }),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs) })
        ])
        loaded = true
      } catch {
        // ERR_ABORTED on a prevented download: headers arrived, document is simply not a page.
        const f = frame as MainFrameInfo | null
        if (f && !f.contentType.toLowerCase().includes('text/html')) loaded = true
        else wc.stop()
      } finally { clearTimeout(timer) }
      if (loaded) break
    }
    if (!loaded) {
      return { findings: [{ code: 'site_down', confirmed: true, evidence: 'сайт не открывается' }], screenshot: null, contacts: [] }
    }

    const f = (frame as MainFrameInfo | null) ?? { url: wc.getURL(), contentType: 'text/html', headers: {} }
    const finalUrl = f.url || wc.getURL()
    const isHtml = f.contentType.toLowerCase().includes('text/html')
    let page: PageData | null = null
    if (isHtml) {
      await sleep(2000)
      page = (await wc.executeJavaScript(PAGE_SCRIPT)) as PageData
    }
    const https = /^https:/i.test(finalUrl)
    const [cert, brokenLinks] = await Promise.all([
      https ? checkCert(new URL(finalUrl).hostname) : Promise.resolve(null),
      page ? checkLinks(finalUrl, page.hrefs) : Promise.resolve([] as string[])
    ])
    const input = buildInput({ finalUrl, contentType: f.contentType, headers: f.headers, cert, page, brokenLinks, checkMenu: opts.checkMenu ?? false })
    const findings: Finding[] = detect(input, new Date())

    const contacts: Contact[] = []
    const seen = new Set<string>()
    for (const h of page?.hrefs ?? []) {
      const ct = contactFromUrl(h)
      if (ct && !seen.has(`${ct.kind}:${ct.value}`)) { seen.add(`${ct.kind}:${ct.value}`); contacts.push(ct) }
    }

    let screenshot: Buffer | null = null
    if (isHtml) {
      try {
        await wc.executeJavaScript(annotationScript(findings))
        const m = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as { cssContentSize?: { height: number } }
        const height = Math.min(Math.max(Math.ceil(m.cssContentSize?.height ?? 844), 844), MAX_SHOT_HEIGHT)
        let data: string | null = null
        try {
          const shot = (await withTimeout(wc.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height, scale: 1 }
          }), 15000)) as { data: string }
          data = shot.data
        } catch {
          // fallback: plain visible-viewport capture
          data = (await withTimeout(wc.capturePage(), 10000)).toPNG().toString('base64')
        }
        screenshot = Buffer.from(data, 'base64')
      } catch { screenshot = null }
    }
    return { findings, screenshot, contacts }
  } catch (e) {
    return { findings: [], screenshot: null, contacts: [], error: e instanceof Error ? e.message : String(e) }
  } finally {
    listeners.delete(wc.id)
    try { if (attached) wc.debugger.detach() } catch { /* ignore */ }
    if (!win.isDestroyed()) win.destroy()
  }
}
