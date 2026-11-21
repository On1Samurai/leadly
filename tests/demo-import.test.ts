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
  it('rejects tricky paths, also after strip', () => {
    for (const p of ['site//etc/x.css', 'a/./b.css', '.. /x.css', 'a\\..\\b.css', '\\\\srv\\share\\x.css', 'a/b.css\u0000', 'a/b /c.css', 'a./b.css'])
      expect(err(() => validateImport([f('site/index.html'), f(p)])), p).toBe('import_bad_path')
  })
  it('rejects duplicates after normalization', () => {
    expect(err(() => validateImport([f('index.html'), f('a\\b.css'), f('a/b.css')]))).toBe('import_bad_path')
    expect(err(() => validateImport([f('index.html'), f('Index.html')]))).toBe('import_bad_path')
  })
  it('root Index.HTML renamed to index.html', () =>
    expect(validateImport([f('Index.HTML')]).map((x) => x.path)).toEqual(['index.html']))
  it('ignores junk entries', () => {
    const r = validateImport([f('index.html'), f('__MACOSX/._index.html'), f('.DS_Store'), f('a/Thumbs.db'), f('.git/config')])
    expect(r.map((x) => x.path)).toEqual(['index.html'])
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
  it('keeps non-UTF-8 bytes intact', () => {
    const cp = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
    const src = Buffer.concat([Buffer.from('<head></head><body>'), cp, Buffer.from('</body>')])
    const [r] = injectTracking([{ path: 'index.html', content: src }], links, true, 'ru')
    expect(r.content.includes(cp)).toBe(true)
    expect(r.content.toString('latin1')).toContain('noindex')
  })
  it('non-UTF-8 page: badge as numeric character references', () => {
    const cp = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]) // «Привет» в cp1251
    const src = Buffer.concat([Buffer.from('<head></head><body>'), cp, Buffer.from('</body>')])
    const [r] = injectTracking([{ path: 'index.html', content: src }], links, true, 'ru')
    const out = r.content.toString('latin1')
    expect(out).toContain('<a href="https://w/">&#1057;&#1072;&#1081;&#1090; ')
    expect(out).toContain('@nick&lt;</a></body>')
    expect(r.content.every((b) => b < 0x80 || cp.includes(b))).toBe(true)
  })
  it('declared non-UTF-8 charset on an ASCII page: badge as numeric character references', () => {
    for (const head of ['<meta charset="windows-1251">', "<META CHARSET='KOI8-R'>", '<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">']) {
      const [r] = injectTracking([f('index.html', `<head>${head}</head><body>hi</body>`)], links, true, 'ru')
      const out = r.content.toString('latin1')
      expect(out, head).toContain('<a href="https://w/">&#1057;&#1072;&#1081;&#1090; ')
      expect(r.content.every((b) => b < 0x80), head).toBe(true)
    }
  })
  it('declared UTF-8 charset: badge stays UTF-8', () => {
    for (const head of ['<meta charset="UTF-8">', '<meta charset=utf8>', '<meta http-equiv="content-type" content="text/html; charset=utf-8">']) {
      const [r] = injectTracking([f('index.html', `<head>${head}</head><body>hi</body>`)], links, true, 'ru')
      expect(r.content.toString(), head).toContain('hi<a href="https://w/">Сайт сделал @nick&lt;</a></body>')
    }
  })
  it('no head: after body tag', () => {
    const [r] = injectTracking([f('index.html', '<body class="a">hi</body>')], links, false, 'ru')
    expect(r.content.toString()).toBe(`<body class="a">${meta}${pix}hi</body>`)
  })
  it('no head no body: at start', () => {
    const [r] = injectTracking([f('index.html', 'hi')], links, false, 'ru')
    expect(r.content.toString()).toBe(`${meta}${pix}hi`)
  })
  it('no head no body: after <!doctype> and <html> so the doctype stays first', () => {
    const [r] = injectTracking([f('index.html', '<!DOCTYPE html><title>x</title><p>y')], links, false, 'ru')
    expect(r.content.toString()).toBe(`<!DOCTYPE html>${meta}${pix}<title>x</title><p>y`)
    const [r2] = injectTracking([f('index.html', '<!doctype html>\n<HTML lang="ru"><title>x</title>')], links, false, 'ru')
    expect(r2.content.toString()).toBe(`<!doctype html>\n<HTML lang="ru">${meta}${pix}<title>x</title>`)
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
  it('folder: too many files early', async () => {
    const d = tmp()
    for (let i = 0; i < 201; i++) writeFileSync(join(d, `${i}.css`), '')
    await expect(readImport({ kind: 'folder', path: d })).rejects.toThrow('import_too_many')
  })
  it('folder: too big', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.js'), Buffer.alloc(21 * 1024 * 1024))
    await expect(readImport({ kind: 'folder', path: d })).rejects.toThrow('import_too_big')
  })
  it('folder: skips junk (.git, .DS_Store)', async () => {
    const d = tmp(); mkdirSync(join(d, '.git')); writeFileSync(join(d, '.git', 'x'), 'a')
    writeFileSync(join(d, 'index.html'), 'hi'); writeFileSync(join(d, '.DS_Store'), 'a')
    expect((await readImport({ kind: 'folder', path: d })).map((x) => x.path)).toEqual(['index.html'])
  })
  it('zip: too many entries', async () => {
    const d = tmp()
    const o: Record<string, Uint8Array> = {}
    for (let i = 0; i < 201; i++) o[`${i}.css`] = new Uint8Array(1)
    writeFileSync(join(d, 'a.zip'), zipSync(o))
    await expect(readImport({ kind: 'zip', path: join(d, 'a.zip') })).rejects.toThrow('import_too_many')
  })
  it('folder symlink skipped -> bad path', async () => {
    const d = tmp(); writeFileSync(join(d, 'index.html'), 'hi')
    symlinkSync(join(d, 'index.html'), join(d, 'l.html'))
    await expect(readImport({ kind: 'folder', path: d })).rejects.toThrow('import_bad_path')
  })
})
