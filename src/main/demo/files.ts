import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { readImport, type ImportedFile } from './import'
import { SLUG_RE } from './slug'

/** Папка демо `${userDataDir}/demos/<slug>`; slug проверяется, чтобы не выйти из demos/. */
export function demoDir(root: string, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error('bad_path')
  return resolve(root, 'demos', slug)
}

/** Абсолютный путь файла внутри папки демо; всё, что выходит наружу, — ошибка. */
export function demoPath(root: string, slug: string, rel: string): string {
  const dir = demoDir(root, slug)
  const p = resolve(dir, rel)
  if (!p.startsWith(dir + sep)) throw new Error('bad_path')
  return p
}

export function writeDemoFile(root: string, slug: string, rel: string, content: Buffer): void {
  const p = demoPath(root, slug, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}

export const readDemoFile = (root: string, slug: string, rel: string): Buffer => readFileSync(demoPath(root, slug, rel))

/** Следующий свободный номер фото img/<n>.jpg. */
export function nextPhotoNum(root: string, slug: string): number {
  let names: string[] = []
  try { names = readdirSync(demoPath(root, slug, 'img')) } catch { /* папки ещё нет */ }
  return Math.max(0, ...names.map((f) => Number(/^(\d+)\.jpg$/.exec(f)?.[1] ?? 0))) + 1
}

/** site/ хранит проверенный импорт целиком: старое содержимое удаляется. */
export function writeSite(root: string, slug: string, files: ImportedFile[]): void {
  rmSync(demoPath(root, slug, 'site'), { recursive: true, force: true })
  for (const f of files) writeDemoFile(root, slug, `site/${f.path}`, f.content)
}

export const readSite = (root: string, slug: string): Promise<ImportedFile[]> =>
  readImport({ kind: 'folder', path: demoPath(root, slug, 'site') })

export const removeDemoDir = (root: string, slug: string): void => rmSync(demoDir(root, slug), { recursive: true, force: true })
