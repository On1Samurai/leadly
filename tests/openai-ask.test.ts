import { describe, expect, it, vi } from 'vitest'
import { openaiAsker, MessageRefused } from '../src/main/llm/message'

const cfg = { baseUrl: 'https://anymodel.org/v1/', apiKey: 'sk-secret-123', model: 'ds/deepseek-v4-flash' }
const ok = (content: string, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }), { status: 200 })

describe('openaiAsker', () => {
  it('sends chat.completions with bearer key, model, system + user', async () => {
    const f = vi.fn(async () => ok('Привет?'))
    const r = await openaiAsker(cfg, f as never)('SYS', 'USER')
    expect(r).toEqual({ text: 'Привет?', truncated: false })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://anymodel.org/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-123')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('ds/deepseek-v4-flash')
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }])
    expect(body.stream).toBe(false)
  })

  it('finish_reason length -> truncated', async () => {
    const r = await openaiAsker(cfg, (async () => ok('Обре', 'length')) as never)('s', 'u')
    expect(r.truncated).toBe(true)
  })

  it('content_filter -> MessageRefused', async () => {
    await expect(openaiAsker(cfg, (async () => ok('', 'content_filter')) as never)('s', 'u')).rejects.toBeInstanceOf(MessageRefused)
  })

  it('http error message has status but never the key', async () => {
    const f = async () => new Response('{"error":"bad key sk-secret-123"}', { status: 401 })
    const err = (await openaiAsker(cfg, f as never)('s', 'u').catch((e: Error) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('401')
    expect(err.message).not.toContain('sk-secret-123')
  })
})
