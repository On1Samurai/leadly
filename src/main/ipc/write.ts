import type { Channel, Place } from '../../shared/types'
import type { WriteOpen } from '../../shared/ipc'
import { countOpen, dailyGate } from '../core/daily'
import { buildLink } from '../core/links'
import { getPlace, setStatus } from '../db/repo'
import { loadSettings } from '../settings'
import { define, type IpcDeps, type Table } from './define'
import { rescorePlace } from './places'

const ALLOWED_SCHEMES = new Set(['https:', 'tel:', 'sms:', 'viber:'])

/** Ссылка только с разрешённой схемой: file:, javascript: и прочее в shell.openExternal не попадает. */
export function safeExternalUrl(url: string): string | null {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}

function targetOf(d: IpcDeps, p: Place, ch: Channel): { phoneE164?: string; handle?: string } {
  const kinds = d.db.prepare('SELECT kind, value FROM contacts WHERE place_id=?').all(p.id) as { kind: string; value: string }[]
  const own = kinds.find((c) => c.kind === ch)?.value
  const phone = p.phoneE164 ?? (own && own.startsWith('+') ? own : undefined)
  return { phoneE164: phone, handle: own && !own.startsWith('+') ? own : undefined }
}

export function writeHandlers(t: Table, d: IpcDeps): void {
  const { db } = d

  define(t, 'write.status', () => {
    const limit = loadSettings(db).dailyWriteLimit
    return { left: dailyGate(db, d.now(), limit).left, limit }
  })

  define(t, 'write.open', async (_e, id, ch, text): Promise<WriteOpen> => {
    const p = getPlace(db, id)
    if (!p) throw new Error('not_found')
    const now = d.now()
    const gate = dailyGate(db, now, loadSettings(db).dailyWriteLimit)
    const limit = loadSettings(db).dailyWriteLimit
    if (!gate.allowed) return { blocked: true, limit }
    const link = buildLink(ch, targetOf(d, p, ch), text)
    const url = link ? safeExternalUrl(link.url) : null
    d.writeClipboard(text)
    countOpen(db, now)
    const left = Math.max(0, gate.left - 1)
    if (!url) return { url: null, prefilled: false, left }
    try {
      await d.openExternal(url)
    } catch {
      return { url: null, prefilled: false, left } // нет обработчика ссылки: текст уже в буфере
    }
    return { url, prefilled: link?.prefilled ?? false, left }
  })

  define(t, 'write.confirm', (_e, id, ch, text) => {
    const p = getPlace(db, id)
    if (!p) throw new Error('not_found')
    const now = d.now()
    db.transaction(() => {
      if (p.status === 'new' || p.status === 'later') setStatus(db, id, 'written', now)
      db.prepare("INSERT INTO messages(place_id,direction,channel,text,created_at) VALUES (?,'out',?,?,?)").run(id, ch, text, now)
    })()
    rescorePlace(db, p, now)
  })
}
