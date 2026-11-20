import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { labels } from '../../shared/demo/labels'
import type { DemoLinks } from '../../shared/demo/types'

export interface ImportedFile { path: string; content: Buffer }

const MAX_FILES = 200
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED = new Set([
  'html', 'css', 'js', 'json', 'txt', 'webmanifest', 'svg', 'ico',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'woff', 'woff2', 'ttf', 'otf'
])

const norm = (p: string): string => p.replace(/\\/g, '/')

const JUNK_DIRS = new Set(['__macosx', '.git'])
const JUNK_FILES = new Set(['.ds_store', 'thumbs.db'])
const isJunk = (p: string): boolean => {
  const segs = norm(p).split('/').map((x) => x.toLowerCase())
  return segs.some((x) => JUNK_DIRS.has(x)) || JUNK_FILES.has(segs[segs.length - 1])
}

// Win32 trims trailing space/dot, so "..␠" would act as ".."
const badPath = (p: string): boolean =>
  !p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || /[\u0000-\u001f]/.test(p) ||
  p.split('/').some((s) => s === '' || s === '.' || s === '..' || /[ .]$/.test(s))

async function walk(root: string, rel: string, out: ImportedFile[], acc: { total: number }): Promise<void> {
  for (const name of await readdir(join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name
    if (isJunk(r)) continue
    const full = join(root, r)
    const st = await lstat(full)
    if (st.isSymbolicLink()) throw new Error('import_bad_path')
    if (st.isDirectory()) await walk(root, r, out, acc)
    else if (st.isFile()) {
      if (out.length >= MAX_FILES) throw new Error('import_too_many')
      acc.total += st.size
      if (acc.total > MAX_BYTES) throw new Error('import_too_big')
      out.push({ path: r, content: await readFile(full) })
    }
  }
}

export async function readImport(src: { kind: 'folder' | 'zip' | 'html'; path: string }): Promise<ImportedFile[]> {
  if (src.kind === 'html') return [{ path: 'index.html', content: await readFile(src.path) }]
  if (src.kind === 'folder') {
    const out: ImportedFile[] = []
    await walk(src.path, '', out, { total: 0 })
    return out
  }
  let total = 0
  let count = 0
  const entries = unzipSync(new Uint8Array(await readFile(src.path)), {
    filter: (file) => {
      if (file.name.endsWith('/') || isJunk(file.name)) return false
      if (++count > MAX_FILES) throw new Error('import_too_many')
      total += file.originalSize
      if (total > MAX_BYTES) throw new Error('import_too_big')
      return true
    }
  })
  return Object.entries(entries).map(([path, c]) => ({ path, content: Buffer.from(c) }))
}

export function validateImport(files: ImportedFile[]): ImportedFile[] {
  let list = files.map((x) => ({ path: norm(x.path), content: x.content })).filter((x) => !isJunk(x.path))
  if (list.some((x) => badPath(x.path))) throw new Error('import_bad_path')
  const top = list[0]?.path.split('/')[0]
  if (list.length && list.every((x) => x.path.startsWith(top + '/')) &&
      !list.some((x) => x.path.toLowerCase() === 'index.html'))
    list = list.map((x) => ({ ...x, path: x.path.slice(top.length + 1) }))
  list = list.map((x) => (x.path.toLowerCase() === 'index.html' ? { ...x, path: 'index.html' } : x))
  if (list.some((x) => badPath(x.path)) || new Set(list.map((x) => x.path.toLowerCase())).size !== list.length)
    throw new Error('import_bad_path')
  if (list.length > MAX_FILES) throw new Error('import_too_many')
  if (list.reduce((s, x) => s + x.content.length, 0) > MAX_BYTES) throw new Error('import_too_big')
  for (const { path } of list) {
    const base = path.slice(path.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    if (dot < 0 || !ALLOWED.has(base.slice(dot + 1).toLowerCase())) throw new Error('import_bad_type')
  }
  if (!list.some((x) => x.path === 'index.html')) throw new Error('import_no_index')
  return list
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Works on bytes: markers are ASCII, so a latin1 view finds them in any ASCII-compatible encoding.
// shortcut: UTF-16 HTML is not handled, add if such sites show up.
function splice(buf: Buffer, at: number, snippet: string): Buffer {
  return Buffer.concat([buf.subarray(0, at), Buffer.from(snippet, 'utf8'), buf.subarray(at)])
}

const isUtf8 = (b: Buffer): boolean => {
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true } catch { return false }
}
// first declared charset (<meta charset> or http-equiv content); ASCII markers, so the latin1 view is enough
const declaresOther = (b: Buffer): boolean => {
  const m = /<meta[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(b.toString('latin1'))
  return !!m && !/^utf-?8$/i.test(m[1])
}
// numeric character references render the same in any charset
const ncr = (s: string): string => s.replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`)

export function injectTracking(files: ImportedFile[], links: DemoLinks, badge: boolean, lang: 'ru' | 'uk'): ImportedFile[] {
  const track =
    '<meta name="robots" content="noindex,nofollow">' +
    `<img src="${links.pixel}" width="1" height="1" alt="" referrerpolicy="unsafe-url" fetchpriority="low" style="position:absolute;left:-9999px">`
  const badgeHtml = `<a href="${links.want}">${labels[lang].badge} @${escHtml(links.tg)}</a>`
  return files.map((f) => {
    if (!/\.html$/i.test(f.path)) return f
    let buf = f.content
    const head = /<\/head>/i.exec(buf.toString('latin1'))
    const body = /<body[^>]*>/i.exec(buf.toString('latin1'))
    buf = splice(buf, head ? head.index : body ? body.index + body[0].length : 0, track)
    if (badge) {
      const end = /<\/body>/i.exec(buf.toString('latin1'))
      buf = splice(buf, end ? end.index : buf.length, isUtf8(f.content) && !declaresOther(f.content) ? badgeHtml : ncr(badgeHtml))
    }
    return { path: f.path, content: buf }
  })
}
