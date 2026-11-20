import type { DemoContent, DemoItem, DemoView, SetupState } from './types'

/** Чистые правки формы редактора демо: вход не меняется, возвращается новый DemoContent. */

export const setItem = (c: DemoContent, i: number, patch: Partial<DemoItem>): DemoContent =>
  ({ ...c, items: c.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })

export const addItem = (c: DemoContent): DemoContent => ({ ...c, items: [...c.items, { name: '', price: '' }] })

export const removeItem = (c: DemoContent, i: number): DemoContent => ({ ...c, items: c.items.filter((_, j) => j !== i) })

export const toggleReview = (c: DemoContent, i: number): DemoContent =>
  ({ ...c, reviews: c.reviews.map((r, j) => (j === i ? { ...r, on: !r.on } : r)) })

export function movePhoto(c: DemoContent, from: number, to: number): DemoContent {
  const n = c.photos.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return { ...c, photos: [...c.photos] }
  const photos = [...c.photos]
  const [p] = photos.splice(from, 1)
  photos.splice(to, 0, p)
  return { ...c, photos }
}

export const removePhoto = (c: DemoContent, i: number): DemoContent => ({ ...c, photos: c.photos.filter((_, j) => j !== i) })

export function canPublish(v: DemoView, s: SetupState, tg: string): { ok: true } | { ok: false; why: string } {
  if (!s.github.ok || !s.worker.ok) return { ok: false, why: 'Настройте GitHub и Worker в настройках' }
  if (!tg.trim()) return { ok: false, why: 'Укажите ник Telegram' }
  if (v.kind === 'template' && !v.content) return { ok: false, why: 'Сначала соберите демо' }
  return { ok: true }
}
