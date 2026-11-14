/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../src/main/db/db'
import type { Finding, Place } from '../src/shared/types'
import {
  MessageRefused, MessageRejected, buildMessageInput, generateMessage, isTextReady, type MessageInput
} from '../src/main/llm/message'
import { checkMessage } from '../src/main/llm/check'

const place = (o: Partial<Place> = {}): Place => ({
  id: 1, name: 'Кофейня Уют', category: 'cafe', lat: 0, lon: 0, address: null, cityId: 1, cellId: null,
  phoneE164: null, phoneType: 'unknown', website: null, webClass: 'own', rating: 4.6, reviews: 212,
  googlePlaceId: null, osmId: null, googleFetchedAt: null, status: 'new', inBase: false, remindAt: null,
  score: 0, scoreReason: '', createdAt: 0, ...o
})
const f = (code: Finding['code'], confirmed = true): Finding => ({ code, confirmed, evidence: `ev ${code}` })
const S = { sells: 'сайты', tone: 'business' as const, lang: 'ru' as const, mode: 'local' as const }

const input = (o: Partial<MessageInput['place']> = {}): MessageInput => {
  const i = buildMessageInput(place(), 'Минск', [f('no_https')], S)
  return { ...i, place: { ...i.place, ...o } }
}
const reply = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: `  ${text} ` }] })
const mk = (...rs: unknown[]) => {
  const create = vi.fn()
  for (const r of rs) create.mockResolvedValueOnce(r)
  return { create, client: { beta: { messages: { create } } } as never }
}

describe('scenario selection', () => {
  it('own + findings -> site', () => {
    expect(buildMessageInput(place(), 'Минск', [f('no_https')], S).scenario).toBe('site')
  })
  it('none -> no_site', () => {
    expect(buildMessageInput(place({ webClass: 'none' }), 'Минск', [], S).scenario).toBe('no_site')
  })
  it('own without confirmed -> offer', () => {
    expect(buildMessageInput(place(), 'Минск', [f('cms', false)], S).scenario).toBe('offer')
  })
  it('b2b with none -> offer', () => {
    expect(buildMessageInput(place({ webClass: 'none' }), 'Минск', [], { ...S, mode: 'b2b' }).scenario).toBe('offer')
  })
  it('fills place fields', () => {
    const i = buildMessageInput(place(), 'Минск', [], S)
    expect(i.place).toEqual({ name: 'Кофейня Уют', category: 'cafe', city: 'Минск', rating: 4.6, reviews: 212, webClass: 'own' })
  })
})

describe('findings', () => {
  it('unconfirmed findings never sent', () => {
    const i = buildMessageInput(place(), 'Минск', [f('cms', false), f('no_https')], S)
    expect(i.findings.map((x) => x.code)).toEqual(['no_https'])
  })
  it('max two by priority', () => {
    const i = buildMessageInput(place(), 'Минск', [f('no_https'), f('slow_load'), f('no_viewport'), f('cms')], S)
    expect(i.findings.map((x) => x.code)).toEqual(['no_viewport', 'no_https'])
    expect(i.findings[0]).toEqual({ code: 'no_viewport', evidence: 'ev no_viewport' })
  })
})

describe('checkMessage', () => {
  it('too long', () => {
    expect(checkMessage('а'.repeat(301), input())).toEqual({ ok: false, reason: 'too_long' })
    expect(checkMessage('а'.repeat(300), input())).toEqual({ ok: true })
  })
  it('unknown number', () => {
    expect(checkMessage('У вас 300 отзывов', input())).toEqual({ ok: false, reason: 'unknown_number' })
    expect(checkMessage('У вас 212 отзывов', input())).toEqual({ ok: true })
    expect(checkMessage('Рейтинг 4,6', input())).toEqual({ ok: true })
    expect(checkMessage('Рейтинг 4.6', input())).toEqual({ ok: true })
    for (const t of ['2 отзыва', '1 отзыв', '4 года', '6 лет']) expect(checkMessage(t, input())).toEqual({ ok: false, reason: 'unknown_number' })
  })
  it('year from evidence ok, spaced numbers collapse', () => {
    const i = { ...input(), findings: [{ code: 'old_footer_year' as const, evidence: '© 2017' }] }
    expect(checkMessage('Внизу сайта 2017 год', i)).toEqual({ ok: true })
    expect(checkMessage('Нужно 1 200', { ...i, place: { ...i.place, reviews: 1200 } })).toEqual({ ok: true })
  })
  it('empty and link', () => {
    expect(checkMessage('  ', input())).toEqual({ ok: false, reason: 'empty' })
    expect(checkMessage('Смотрите www.x.by', input())).toEqual({ ok: false, reason: 'link' })
    expect(checkMessage('Смотрите https://x.by', input())).toEqual({ ok: false, reason: 'link' })
  })
})

describe('generateMessage', () => {
  it('retry once then ok', async () => {
    const { create, client } = mk(reply('а'.repeat(400)), reply('Хорошо ли вам?'))
    const r = await generateMessage(input(), { client, db: openDb(':memory:') })
    expect(r).toEqual({ text: 'Хорошо ли вам?', cached: false })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].messages[0].content).toContain('Предыдущий вариант отклонён: длиннее 300 символов. Исправь.')
  })
  it('empty first response is retried and not cached', async () => {
    const db = openDb(':memory:')
    const { create, client } = mk(reply(''), reply('Привет?'))
    const r = await generateMessage(input(), { client, db })
    expect(r).toEqual({ text: 'Привет?', cached: false })
    expect(create.mock.calls[1][0].messages[0].content).toContain('пустой или обрезанный ответ')
    expect(isTextReady(input(), db)).toBe(true)
  })
  it('max_tokens is retried', async () => {
    const { create, client } = mk(reply('Обрезан', 'max_tokens'), reply('Привет?'))
    expect((await generateMessage(input(), { client, db: openDb(':memory:') })).text).toBe('Привет?')
    expect(create).toHaveBeenCalledTimes(2)
  })
  it('link rejected and never cached', async () => {
    const db = openDb(':memory:')
    const { client } = mk(reply('Зайдите на https://x.by'), reply('Смотрите www.x.by'))
    await expect(generateMessage(input(), { client, db })).rejects.toBeInstanceOf(MessageRejected)
    expect(isTextReady(input(), db)).toBe(false)
  })
  it('rejected after second failure', async () => {
    const { client } = mk(reply('а'.repeat(400)), reply('б'.repeat(400)))
    await expect(generateMessage(input(), { client, db: openDb(':memory:') })).rejects.toBeInstanceOf(MessageRejected)
  })
  it('refusal throws', async () => {
    const { client } = mk({ stop_reason: 'refusal', content: [] })
    await expect(generateMessage(input(), { client, db: openDb(':memory:') })).rejects.toBeInstanceOf(MessageRefused)
  })
  it('cache hit skips API', async () => {
    const db = openDb(':memory:')
    const { create, client } = mk(reply('Привет?'))
    expect(isTextReady(input(), db)).toBe(false)
    await generateMessage(input(), { client, db })
    expect(isTextReady(input(), db)).toBe(true)
    const r = await generateMessage(input(), { client, db })
    expect(create).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ text: 'Привет?', cached: true })
  })
  it('request shape', async () => {
    const { create, client } = mk(reply('Привет?'))
    await generateMessage(input(), { client, db: openDb(':memory:') })
    const req = create.mock.calls[0][0]
    expect(req.model).toBe('claude-sonnet-5-5')
    expect(req.fallbacks).toBe('default')
    expect(req.betas).toContain('server-side-fallback-2026-07-01')
    expect(req.output_config.effort).toBe('low')
    expect(req.thinking).toBeUndefined()
    expect(req.messages).toEqual([{ role: 'user', content: JSON.stringify(input()) }])
    expect(req.system).not.toMatch(/^version:/)
  })
})
