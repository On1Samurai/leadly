/**
 * Сохранения черновика по очереди: flush ждёт сохранение, начатое раньше (по таймеру), и только потом
 * отправляет последний черновик. Так публикация и открытка не уходят раньше незаконченного сохранения.
 * false — черновик не сохранён (он остаётся в очереди: повторит «Сохранить» или следующая правка).
 */
export function draftQueue<T>(save: (c: T) => Promise<void>, on: { ok(idle: boolean): void; fail(e: unknown): void }) {
  let pending: T | null = null
  let chain: Promise<boolean> = Promise.resolve(true)
  return {
    put(c: T): void { pending = c },
    flush(): Promise<boolean> {
      chain = chain.then(async () => {
        const next = pending
        if (next === null) return true // упавшее раньше сохранение вернуло черновик в очередь, сюда не попадает
        pending = null
        try {
          await save(next)
        } catch (e) {
          pending ??= next
          on.fail(e)
          return false
        }
        on.ok(pending === null) // пока ждали, могла прийти новая правка
        return true
      })
      return chain
    }
  }
}
