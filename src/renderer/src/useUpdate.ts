import { useEffect, useState } from 'react'
import type { UpdateEvent } from '../../shared/ipc'
import { reduceUpdate } from '../../shared/update'

/** Текущее состояние автообновления: стартовое значение из main + push-события. */
export function useUpdate(): UpdateEvent {
  const [u, setU] = useState<UpdateEvent>({ state: 'idle' })
  useEffect(() => {
    window.api.update.status().then((s) => setU((p) => reduceUpdate(p, s))).catch(() => undefined)
    return window.api.update.onEvent((e) => setU((p) => reduceUpdate(p, e)))
  }, [])
  return u
}
