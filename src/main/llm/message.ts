import { createHash } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import type { Db } from '../db/db'
import type { Finding, FindingCode, Place, WebClass } from '../../shared/types'
import { checkMessage } from './check'
import promptFile from './prompts/first-message.md?raw'

export type Tone = 'business' | 'friendly' | 'short'
export type Scenario = 'site' | 'no_site' | 'offer'
export interface MessageInput {
  scenario: Scenario; sells: string; tone: Tone; lang: 'ru' | 'uk'
  place: { name: string; category: string; city: string; rating: number | null; reviews: number | null; webClass: WebClass }
  findings: { code: FindingCode; evidence: string }[]
}

export class MessageRefused extends Error {}
export class MessageRejected extends Error {}

const PRIORITY: FindingCode[] = ['site_down', 'no_viewport', 'h_scroll', 'no_https', 'cert_invalid', 'old_footer_year',
  'slow_load', 'no_menu_prices', 'broken_links', 'cms', 'small_text', 'cert_expiring']

const nl = promptFile.indexOf('\n')
const PROMPT_VERSION = /^version:\s*(\S+)/.exec(promptFile.slice(0, nl))?.[1] ?? '0'
const SYSTEM_PROMPT = promptFile.slice(nl + 1).trim()

export function buildMessageInput(
  place: Place, city: string, findings: Finding[],
  s: { sells: string; tone: Tone; lang: 'ru' | 'uk'; mode: 'local' | 'b2b' }
): MessageInput {
  const picked = findings
    .filter((x) => x.confirmed)
    .sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code))
    .slice(0, 2)
    .map((x) => ({ code: x.code, evidence: x.evidence }))
  let scenario: Scenario = 'offer'
  if (place.webClass === 'own' && picked.length > 0) scenario = 'site'
  else if (['none', 'social', 'template'].includes(place.webClass) && s.mode !== 'b2b') scenario = 'no_site'
  return {
    scenario, sells: s.sells, tone: s.tone, lang: s.lang,
    place: { name: place.name, category: place.category, city, rating: place.rating, reviews: place.reviews, webClass: place.webClass },
    findings: picked
  }
}

const cacheKey = (input: MessageInput): string =>
  createHash('sha256').update(PROMPT_VERSION + JSON.stringify(input)).digest('hex')

export function isTextReady(input: MessageInput, db: Db): boolean {
  return db.prepare('SELECT 1 FROM llm_cache WHERE key = ?').get(cacheKey(input)) !== undefined
}

const REASONS = { too_long: 'длиннее 300 символов', unknown_number: 'упомянуто число, которого нет во входных данных' }

async function ask(client: Pick<Anthropic, 'beta'>, content: string): Promise<string> {
  const res = await client.beta.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }]
  })
  if (res.stop_reason === 'refusal') throw new MessageRefused('Claude отказался отвечать')
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
}

export async function generateMessage(
  input: MessageInput, deps: { client: Pick<Anthropic, 'beta'>; db: Db }
): Promise<{ text: string; cached: boolean }> {
  const key = cacheKey(input)
  const hit = deps.db.prepare('SELECT response FROM llm_cache WHERE key = ?').get(key) as { response: string } | undefined
  if (hit) return { text: hit.response, cached: true }
  const base = JSON.stringify(input)
  let text = await ask(deps.client, base)
  let check = checkMessage(text, input)
  if (!check.ok) {
    text = await ask(deps.client, `${base}\n\nПредыдущий вариант отклонён: ${REASONS[check.reason]}. Исправь.`)
    check = checkMessage(text, input)
    if (!check.ok) throw new MessageRejected(`Текст не прошёл проверку: ${check.reason}`)
  }
  deps.db.prepare('INSERT OR REPLACE INTO llm_cache(key, response, created_at) VALUES (?, ?, ?)').run(key, text, Date.now())
  return { text, cached: false }
}
