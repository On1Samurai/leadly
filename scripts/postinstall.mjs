import { spawnSync } from 'node:child_process'

const cmd = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
const bin = new URL(`../node_modules/.bin/${cmd}`, import.meta.url)
const r = spawnSync(bin.pathname.replace(/^\/([A-Za-z]:)/, '$1'), ['install-app-deps'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

if (r.status !== 0) {
  if (process.env.LL_SKIP_NATIVE_REBUILD === '1') {
    console.warn(
      '\n[postinstall] WARNING: native rebuild failed, skipped because LL_SKIP_NATIVE_REBUILD=1.\n' +
        'better-sqlite3 prebuilt N-API binaries are used as is. Do not use this for release builds.\n'
    )
  } else {
    console.error('\n[postinstall] native rebuild failed. Install a C++ toolchain, or set LL_SKIP_NATIVE_REBUILD=1 (dev only).')
    process.exit(r.status ?? 1)
  }
}
