import type { z } from 'zod'
import type { Anthropic } from '@anthropic-ai/sdk'
import type { ChannelName, UpdateEvent } from '../../shared/ipc'
import type { AuditQueue } from '../audit/queue'
import type { Db } from '../db/db'
import type { SecretEnv } from '../secrets'
import type { BBox, Category, RawPlace } from '../../shared/types'
import { ARGS } from './schemas'

export interface Ev { sender: { send(channel: string, ...a: unknown[]): void } }
export type Fn = (e: Ev, ...args: unknown[]) => Promise<unknown>
export type Table = Partial<Record<ChannelName, Fn>>

export interface IpcDeps {
  db: Db
  secretEnv: SecretEnv
  userDataDir: string
  auditQueue: AuditQueue
  /** Проход закончился (успешно или с ошибкой). */
  onPassEnd?: () => void
  now: () => number
  rng: () => number
  osm: (bbox: BBox, cat: Category) => Promise<RawPlace[]>
  saveDialog: (defaultName: string) => Promise<string | null>
  /** shell.openExternal; в тестах подменяется. */
  openExternal: (url: string) => Promise<void>
  /** clipboard.writeText */
  writeClipboard: (text: string) => void
  /** Telegram-бот (Задача 18); без него bot.* отвечают not_implemented. */
  bot?: { status(): { linked: boolean; running: boolean }; bindCode(): string; unlink(): void }
  /** Сменился секрет (токен бота) или настройка (автозапуск, фон). */
  onSecretSet?: (name: string) => void
  onSettingsSet?: () => void
  appVersion?: () => string
  /** Автообновление; в dev и тестах отсутствует. */
  updater?: { check(): Promise<UpdateEvent>; download(): Promise<void>; install(): void; status(): UpdateEvent }
  /** Публичный ключ проверки лицензий; в тестах подменяется. */
  licensePublicKey?: string
  anthropicFactory: (apiKey: string) => Pick<Anthropic, 'beta'>
}

/** Регистрирует обработчик: аргументы проверяются zod-схемой канала, ошибка схемы -> Error('bad_args'). */
export function define<K extends ChannelName>(
  t: Table, name: K, fn: (e: Ev, ...a: z.output<(typeof ARGS)[K]> & unknown[]) => unknown
): void {
  t[name] = async (e, ...args) => {
    const r = ARGS[name].safeParse(args)
    if (!r.success) throw new Error('bad_args')
    return (fn as (e: Ev, ...a: unknown[]) => unknown)(e, ...(r.data as unknown[]))
  }
}

export const stub = (t: Table, name: ChannelName): void => {
  t[name] = async () => { throw new Error('not_implemented') }
}
