import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { injectTracking, readImport, validateImport, type ImportedFile } from '../src/main/demo/import'

const f = (path: string, s = 'x'): ImportedFile => ({ path, content: Buffer.from(s) })
const err = (fn: () => unknown): string => { try { fn() } catch (e) { return (e as Error).message } return 'no error' }
const links = { pixel: 'https://p/x.gif', want: 'https://w/', tg: 'nick<' }
const tmp = (): string => mkdtempSync(join(tmpdir(), 'imp-'))

describe('validateImport', () => {
  it('strips single top folder', () => {
    const r = validateImport([f('site/index.html'), f('site/a.css')])
    expect(r.map((x) => x.path)).toEqual(['index.html', 'a.css'])
  })
  it('rejects traversal / absolute / drive', () => {
    for (const p of ['../x.html', '/etc/x', 'C:\\x', 'a/../../x.html'])
      expect(err(() => validateImport([f('index.html'), f(p)]))).toBe('import_bad_path')
  })
  it('no index', () => expect(err(() => validateImport([f('a.html')]))).toBe('import_no_index'))
  it('too many', () =>
    expect(err(() => validateImport([f('index.html'), ...Array.from({ length: 200 }, (_, i) => f(`${i}.css`))]))).toBe('import_too_many'))
  it('200 ok', () =>
    expect(validateImport([f('index.html'), ...Array.from({ length: 199 }, (_, i) => f(`${i}.css`))])).toHaveLength(200))
  it('too big', () =>
    expect(err(() => validateImport([f('index.html'), f('a.js', 'x'.repeat(20 * 1024 * 1024))]))).toBe('import_too_big'))
  it('bad types', () => {
    expect(err(() => validateImport([f('index.html'), f('x.exe')]))).toBe('import_bad_type')
    expect(err(() => validateImport([f('index.html'), f('x.php')]))).toBe('import_bad_type')
    expect(err(() => validateImport([f('index.html'), f('noext')]))).toBe('import_bad_type')
  })
  it('extensions case-insensitive', () => expect(validateImport([f('index.HTML'), f('A.PNG')])).toHaveLength(2))
})

describe('injectTracking', () => {
  const pix = '<img src="https://p/x.gif" width="1" height="1" alt="" referrerpolicy="unsafe-url" fetchpriority="low" style="position:absolute;left:-9999px">'
  const meta = '<meta name="robots" content="noindex,nofollow">'
  it('before </head>', () => {
    const [r] = injectTracking([f('index.html', '<html><HEAD></HEAD><body>hi</body></html>')], links, false, 'ru')
    expect(r.content.toString()).toBe(`<html><HEAD>${meta}${pix}</HEAD><body>hi</body></html>`)
  })
  it('no head: after body tag', () => {
    const [r] = injectTracking([f('index.html', '<body class="a">hi</body>')], links, false, 'ru')
    expect(r.content.toString()).toBe(`<body class="a">${meta}${pix}hi</body>`)
  })
  it('no head no body: at start', () => {
    const [r] = injectTracking([f('index.html', 'hi')], links, false, 'ru')
    expect(r.content.toString()).toBe(`${meta}${pix}hi`)
  })
  it('badge off: no @; non-html untouched', () => {
    const out = injectTracking([f('index.html', '<head></head>'), f('a.css', 'b')], links, false, 'ru')
    expect(out[0].content.toString()).not.toContain('@')
    expect(out[1].content.toString()).toBe('b')
  })
  it('badge on: escaped, before </body>', () => {
    const [r] = injectTracking([f('index.html', '<head></head><body>hi</body>')], links, true, 'uk')
    expect(r.content.toString()).toContain('hi<a href="https://w/">Сайт зробив @nick&lt;</a></body>')
  })
  it('badge without body: at end', () => {
    const [r] = injectTracking([f('index.html', 'hi')], links, true, 'ru')
    expect(r.content.toString().endsWith('Сайт сделал @nick&lt;</a>')).toBe(true)
  })
})

describe('readImport', () => {
  it('html -> index.html', async () => {
    const d = tmp(); writeFileSync(join(d, 'my.html'), 'hi')
    const r = await readImport({ kind: 'html', path: join(d, 'my.html') })
    expect(r.map((x) => x.path)).toEqual(['index.html'])
  })
  it('zip', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.zip'), zipSync({ 'site/index.html': Buffer.from('hi'), 'site/sub/a.css': Buffer.from('b') }))
    const r = await readImport({ kind: 'zip', path: join(d, 'a.zip') })
    expect(r.map((x) => x.path).sort()).toEqual(['site/index.html', 'site/sub/a.css'])
  })
  it('zip bomb rejected', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.zip'), zipSync({ 'index.html': Buffer.alloc(21 * 1024 * 1024) }))
    await expect(readImport({ kind: 'zip', path: join(d, 'a.zip') })).rejects.toThrow('import_too_big')
  })
  it('folder recursive', async () => {
    const d = tmp(); mkdirSync(join(d, 's'))
    writeFileSync(join(d, 'index.html'), 'hi'); writeFileSync(join(d, 's', 'a.css'), 'b')
    const r = await readImport({ kind: 'folder', path: d })
    expect(r.map((x) => x.path).sort()).toEqual(['index.html', 's/a.css'])
  })
  it('folder symlink skipped -> bad path', async () => {
    const d = tmp(); writeFileSync(join(d, 'index.html'), 'hi')
    symlinkSync(join(d, 'index.html'), join(d, 'l.html'))
    await expect(readImport({ kind: 'folder', path: d })).rejects.toThrow('import_bad_path')
  })
})
