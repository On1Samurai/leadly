process.env.TZ = 'Europe/Minsk'
import { describe, expect, it } from 'vitest'
import { buildDigest, escapeHtml, type DigestData } from '../src/main/bot/digest'
import { decide, MAX_TRIES } from '../src/main/bot/auth'
import { createBotManager, type BotHandle } from '../src/main/bot/bot'
import { openDb } from '../src/main/db/db'
import { botNotifier } from '../src/main/bot/notifier'
import type { Place } from '../src/shared/types'
import type { TodayView } from '../src/shared/ipc'

const base: DigestData = { date: '15 ноября', replied: [], remind: [], goal: 6, written: 2 }

describe('digest', () => {
  it('digest escapes names', () => {
    expect(escapeHtml('<b>Кафе & Ко</b>')).toBe('&lt;b&gt;Кафе &amp; Ко&lt;/b&gt;')
    expect(buildDigest({ ...base, replied: [{ name: '<b>Кафе & Ко</b>' }] })).toContain('&lt;b&gt;Кафе &amp; Ко&lt;/b&gt;')
  })
  it('digest skips empty sections', () => {
    const t = buildDigest(base)
    expect(t).not.toContain('Ответили')
    expect(t).not.toContain('Напомнить')
    expect(t.split('\n')[0]).toBe('Доброе утро. Сегодня 15 ноября')
  })
  it('digest lists sections in order', () => {
    const t = buildDigest({ ...base, replied: [{ name: 'А' }, { name: 'Б' }], remind: [{ name: 'В' }] })
    expect(t.split('\n')).toEqual(['Доброе утро. Сегодня 15 ноября', 'Ответили: А, Б', 'Напомнить: В', 'Цель: написать 6, уже 2'])
  })
  it('digest goal line', () => {
    expect(buildDigest(base)).toContain('Цель: написать 6, уже 2')
  })
})

describe('auth decide', () => {
  const bind = { code: '123456', exp: 1000 }
  const c = (o: Partial<Parameters<typeof decide>[0]>): ReturnType<typeof decide> =>
    decide({ chatId: 5, text: '/today', bound: 5, bind: null, now: 0, ...o })
  it('bound chat allowed', () => expect(c({})).toBe('allow'))
  it('foreign chat ignored', () => expect(c({ chatId: 9 })).toBe('ignore'))
  it('no chat ignored', () => expect(c({ chatId: undefined })).toBe('ignore'))
  it('unbound chat ignored without code', () => expect(c({ bound: null, text: '/start' })).toBe('ignore'))
  it('right code binds', () => expect(c({ bound: null, bind, text: '/start 123456' })).toBe('bind'))
  it('foreign chat can bind with code', () => expect(c({ chatId: 9, bind, text: '/start 123456' })).toBe('bind'))
  it('wrong code is badcode (no reply)', () => expect(c({ chatId: 9, bind, text: '/start 654321' })).toBe('badcode'))
  it('expired code ignored', () => expect(c({ chatId: 9, bind, now: 1001, text: '/start 123456' })).toBe('ignore'))
})

const place = { id: 1, name: 'Кафе', remindAt: 5 } as Place
const view = { goal: 6, written: 0, remindToday: [], replied: [], leftToday: 6 } as TodayView
const TOKEN = '123:SECRET-TOKEN'
const mk = (send: (t: string) => Promise<void>, bound = true) => {
  const log: string[] = []
  let isBound = bound
  const n = botNotifier({
    send, bound: () => isBound, unlink: () => { isBound = false; log.push('unlink') },
    desktop: { digest: async () => { log.push('d-digest') }, reminder: async () => { log.push('d-rem') } },
    log: (_m, e) => log.push('log:' + String(e))
  })
  return { n, log }
}
const netErr = (): Error => Object.assign(new Error(`Network request failed https://api.telegram.org/bot${TOKEN}/sendMessage`), { name: 'HttpError' })

describe('botNotifier', () => {
  it('reminder goes to bot and desktop', async () => {
    const sent: string[] = []
    const { n, log } = mk(async (t) => { sent.push(t) })
    await n.reminder(place)
    expect(sent).toEqual(['Пора напомнить: Кафе'])
    expect(log).toEqual(['d-rem'])
  })
  it('digest via bot when bound, desktop otherwise', async () => {
    const sent: string[] = []
    const a = mk(async (t) => { sent.push(t) })
    await a.n.digest(view)
    expect(sent).toHaveLength(1); expect(a.log).toEqual([])
    const b = mk(async () => { throw new Error('no') }, false)
    await b.n.digest(view)
    expect(b.log).toEqual(['d-digest'])
  })
  it('403 unlinks, does not throw, falls back to desktop', async () => {
    const { n, log } = mk(async () => { throw Object.assign(new Error('Forbidden'), { error_code: 403 }) })
    await n.reminder(place)
    expect(log).toEqual(['d-rem', 'log:bot_send_failed:403', 'unlink'])
  })
  it('offline reminder: desktop once across retries, bot error rethrown without token', async () => {
    const { n, log } = mk(async () => { throw netErr() })
    for (let i = 0; i < 3; i++) {
      const e = await n.reminder(place).catch((x: Error) => x)
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('bot_send_failed:HttpError')
    }
    expect(log.filter((l) => l === 'd-rem')).toHaveLength(1)
    expect(log.join('|')).not.toContain(TOKEN)
  })
  it('offline digest: desktop fallback once per day, no throw', async () => {
    const { n, log } = mk(async () => { throw netErr() })
    await n.digest(view); await n.digest(view)
    expect(log.filter((l) => l === 'd-digest')).toHaveLength(1)
    expect(log.join('|')).not.toContain(TOKEN)
  })
})

describe('digest and auth extras', () => {
  it('digest truncated to 4000', () => {
    expect(buildDigest({ ...base, replied: [{ name: 'я'.repeat(5000) }] }).length).toBeLessThanOrEqual(4000)
  })
  it('code dead after MAX_TRIES wrong attempts', () => {
    const a = { chatId: 9, bound: null, now: 0, text: '/start 123456' }
    expect(decide({ ...a, bind: { code: '123456', exp: 10, tries: MAX_TRIES - 1 } })).toBe('bind')
    expect(decide({ ...a, bind: { code: '123456', exp: 10, tries: MAX_TRIES } })).toBe('ignore')
    expect(decide({ ...a, text: '/start 000000', bind: { code: '123456', exp: 10 } })).toBe('badcode')
  })
})

describe('bot manager', () => {
  it('rapid restarts: only the last bot runs, earlier stopped', async () => {
    const db = openDb(':memory:')
    const bots: { stopped: boolean }[] = []
    const start = (): BotHandle => {
      const b = { stopped: false }; bots.push(b)
      return { running: () => !b.stopped, send: async () => undefined, stop: async () => { await new Promise((r) => setTimeout(r, 5)); b.stopped = true } }
    }
    const m = createBotManager(db, () => 'tok', start)
    await Promise.all([m.restart(), m.restart(), m.restart()])
    expect(bots.map((b) => b.stopped)).toEqual([true, true, false])
    expect(m.running()).toBe(true)
    await m.stop()
    expect(bots.every((b) => b.stopped)).toBe(true)
    db.close()
  })
})
