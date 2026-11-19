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

async function walk(root: string, rel: string, out: ImportedFile[]): Promise<void> {
  for (const name of await readdir(join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name
    const full = join(root, r)
    const st = await lstat(full)
    if (st.isSymbolicLink()) throw new Error('import_bad_path')
    if (st.isDirectory()) await walk(root, r, out)
    else if (st.isFile()) {
      if (out.length >= MAX_FILES + 1) throw new Error('import_too_many')
      out.push({ path: r, content: await readFile(full) })
    }
  }
}

export async function readImport(src: { kind: 'folder' | 'zip' | 'html'; path: string }): Promise<ImportedFile[]> {
  if (src.kind === 'html') return [{ path: 'index.html', content: await readFile(src.path) }]
  if (src.kind === 'folder') {
    const out: ImportedFile[] = []
    await walk(src.path, '', out)
    return out
  }
  let total = 0
  const entries = unzipSync(new Uint8Array(await readFile(src.path)), {
    filter: (file) => {
      if (file.name.endsWith('/')) return false
      total += file.originalSize
      if (total > MAX_BYTES) throw new Error('import_too_big')
      return true
    }
  })
  return Object.entries(entries).map(([path, c]) => ({ path, content: Buffer.from(c) }))
}

export function validateImport(files: ImportedFile[]): ImportedFile[] {
  let list = files.map((x) => ({ path: norm(x.path), content: x.content }))
  for (const { path } of list) {
    if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some((s) => s === '..'))
      throw new Error('import_bad_path')
  }
  const top = list[0]?.path.split('/')[0]
  if (list.length && list.every((x) => x.path.includes('/') && x.path.startsWith(top + '/')) &&
      !list.some((x) => x.path.toLowerCase() === 'index.html'))
    list = list.map((x) => ({ ...x, path: x.path.slice(top.length + 1) }))
  if (list.length > MAX_FILES) throw new Error('import_too_many')
  if (list.reduce((s, x) => s + x.content.length, 0) > MAX_BYTES) throw new Error('import_too_big')
  for (const { path } of list) {
    const base = path.slice(path.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    if (dot < 0 || !ALLOWED.has(base.slice(dot + 1).toLowerCase())) throw new Error('import_bad_type')
  }
  if (!list.some((x) => x.path.toLowerCase() === 'index.html')) throw new Error('import_no_index')
  return list
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function injectTracking(files: ImportedFile[], links: DemoLinks, badge: boolean, lang: 'ru' | 'uk'): ImportedFile[] {
  const track =
    '<meta name="robots" content="noindex,nofollow">' +
    `<img src="${links.pixel}" width="1" height="1" alt="" referrerpolicy="unsafe-url" fetchpriority="low" style="position:absolute;left:-9999px">`
  const badgeHtml = `<a href="${links.want}">${labels[lang].badge} @${escHtml(links.tg)}</a>`
  return files.map((f) => {
    if (!/\.html$/i.test(f.path)) return f
    let s = f.content.toString('utf8')
    if (/<\/head>/i.test(s)) s = s.replace(/<\/head>/i, (m) => track + m)
    else if (/<body[^>]*>/i.test(s)) s = s.replace(/<body[^>]*>/i, (m) => m + track)
    else s = track + s
    if (badge) s = /<\/body>/i.test(s) ? s.replace(/<\/body>/i, (m) => badgeHtml + m) : s + badgeHtml
    return { path: f.path, content: Buffer.from(s) }
  })
}
