process.env.TZ = 'Europe/Minsk'
import { describe, expect, it } from 'vitest'
import { buildDigest, escapeHtml, type DigestData } from '../src/main/bot/digest'
import { decide } from '../src/main/bot/auth'
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
  it('wrong code ignored', () => expect(c({ chatId: 9, bind, text: '/start 654321' })).toBe('ignore'))
  it('expired code ignored', () => expect(c({ chatId: 9, bind, now: 1001, text: '/start 123456' })).toBe('ignore'))
})

const place = { id: 1, name: 'Кафе' } as Place
const view = { goal: 6, written: 0, remindToday: [], replied: [], leftToday: 6 } as TodayView
const mk = (send: (t: string) => Promise<void>, bound = true) => {
  const log: string[] = []
  let isBound = bound
  const n = botNotifier({
    send, bound: () => isBound, unlink: () => { isBound = false; log.push('unlink') },
    desktop: { digest: async () => { log.push('d-digest') }, reminder: async () => { log.push('d-rem') } },
    log: () => log.push('log')
  })
  return { n, log }
}

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
  it('403 unlinks, logs, does not throw, falls back to desktop', async () => {
    const { n, log } = mk(async () => { throw Object.assign(new Error('Forbidden'), { error_code: 403 }) })
    await n.reminder(place)
    expect(log).toEqual(['log', 'unlink', 'd-rem'])
  })
  it('network error throws for scheduler retry', async () => {
    const { n } = mk(async () => { throw new Error('ECONNRESET') })
    await expect(n.reminder(place)).rejects.toThrow('ECONNRESET')
    await expect(n.digest(view)).rejects.toThrow('ECONNRESET')
  })
})
