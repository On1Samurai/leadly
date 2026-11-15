import { describe, expect, it } from 'vitest'
import { genErrorText } from '../src/shared/genError'

describe('genErrorText', () => {
  it('маппит ошибки генерации', () => {
    const wrap = (m: string): Error => new Error(`Error invoking remote method 'message.generate': Error: ${m}`)
    expect(genErrorText(wrap('no_anthropic_key'))).toBe('Добавьте ключ Anthropic в настройках')
    expect(genErrorText(wrap('Модель отказалась отвечать'))).toBe('Нейросеть отказалась писать этот текст — напишите сами')
    expect(genErrorText(wrap('Текст не прошёл проверку: длина'))).toBe('Не удалось получить корректный текст — попробуйте ещё раз')
    expect(genErrorText(wrap('429 rate limit'))).toBe('Ошибка нейросети: 429 rate limit')
  })
})
