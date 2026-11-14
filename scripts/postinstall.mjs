import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const skip = process.env.LL_SKIP_NATIVE_REBUILD === '1'
const require = createRequire(import.meta.url)

function fail(message) {
  if (skip) {
    console.warn(
      `\n[postinstall] WARNING: ${message}\nSkipped because LL_SKIP_NATIVE_REBUILD=1: better-sqlite3 prebuilt N-API binaries are used as is. Do not use this for release builds.\n`
    )
    process.exit(0)
  }
  console.error(`\n[postinstall] ${message}\nInstall a C++ toolchain, or set LL_SKIP_NATIVE_REBUILD=1 (dev only).`)
  process.exit(1)
}

// Запуск через process.execPath и JS-вход пакета: работает на Windows без shell и с любыми символами в пути.
const cli = require.resolve('electron-builder/cli.js')
const r = spawnSync(process.execPath, [cli, 'install-app-deps'], { stdio: 'inherit' })

if (r.error) fail(`could not start electron-builder: ${r.error.message}`)
if (r.status !== 0) fail(`native rebuild failed (exit code ${r.status}).`)
