# Local Leads

Windows-приложение (Electron + React + TypeScript + SQLite): поиск локального бизнеса без сайта.

## Разработка

Нужен Node 22 (`.nvmrc`). Команды: `npm install`, `npm run dev`, `npm test`, `npm run build`.

`postinstall` пересобирает нативные модули под Electron (`electron-builder install-app-deps`), нужен компилятор C++.
На Linux-машине разработки без компилятора: `LL_SKIP_NATIVE_REBUILD=1 npm install`.
better-sqlite3 13 поставляется с готовыми N-API-бинарниками, для разработки и тестов этого достаточно.
Для релизной сборки используйте обычный `npm install` на Windows-машине с инструментами сборки.
