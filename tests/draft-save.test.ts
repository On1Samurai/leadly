import { describe, expect, it } from 'vitest'
import { draftQueue } from '../src/renderer/src/draft-save'

const deferred = () => {
  let resolve!: () => void, reject!: (e: Error) => void
  const p = new Promise<void>((a, b) => { resolve = a; reject = b })
  return { p, resolve, reject }
}

describe('draftQueue', () => {
  it('flush waits for the save already in flight, then saves the newer draft', async () => {
    const order: string[] = []
    const first = deferred()
    const q = draftQueue<string>(async (c) => { order.push(`start ${c}`); if (c === 'a') await first.p; order.push(`end ${c}`) },
      { ok: () => undefined, fail: () => undefined })
    q.put('a')
    const timer = q.flush() // сохранение по таймеру
    await Promise.resolve(); await Promise.resolve()
    expect(order).toEqual(['start a'])
    q.put('b') // правка, пока сохранение 'a' в пути
    let done = false
    const before = q.flush().then((ok) => { done = true; return ok }) // «Опубликовать»
    await Promise.resolve(); await Promise.resolve()
    expect(done).toBe(false)
    expect(order).toEqual(['start a'])
    first.resolve()
    expect(await before).toBe(true)
    expect(await timer).toBe(true)
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('earlier save failed: flush does not report success until the draft is saved', async () => {
    const first = deferred()
    let calls = 0
    const errs: unknown[] = []
    const q = draftQueue<string>(async () => { if (++calls === 1) await first.p; else throw new Error('bad_args') },
      { ok: () => undefined, fail: (e) => errs.push(e) })
    q.put('a')
    const timer = q.flush()
    const action = q.flush()
    first.reject(new Error('offline'))
    expect(await timer).toBe(false)
    expect(await action).toBe(false) // повтор того же черновика тоже не прошёл — действие не выполняется
    expect(errs).toHaveLength(2)
  })

  it('nothing pending -> true without saving; ok() says whether a newer draft arrived', async () => {
    const seen: boolean[] = []
    const q = draftQueue<string>(async () => undefined, { ok: (idle) => seen.push(idle), fail: () => undefined })
    expect(await q.flush()).toBe(true)
    q.put('a')
    expect(await q.flush()).toBe(true)
    expect(seen).toEqual([true])
  })
})
