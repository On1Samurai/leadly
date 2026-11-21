export type DemoKind = 'food' | 'beauty' | 'auto' | 'default'
export type DemoStatus = 'draft' | 'publishing' | 'published' | 'unpublished' | 'error'
export type DemoSource = 'google' | 'free' | 'import'
export interface DemoItem { name: string; price: string }
export interface DemoReview { author: string; text: string; rating: number | null; on: boolean }
export interface DemoPhoto { file: string; author: string | null; source: 'google' | 'user' } // file: 'img/1.jpg'
export interface DemoCta { kind: 'call' | 'route' | 'book'; target: string }
export interface DemoContent {
  name: string; demoKind: DemoKind; lang: 'ru' | 'uk'
  headline: string; subhead: string; about: string
  rating: number | null; reviewsCount: number | null
  hours: string[]; items: DemoItem[]; reviews: DemoReview[]; photos: DemoPhoto[]
  address: string | null; mapsUrl: string | null; phone: string | null
  cta: DemoCta; showBadge: boolean; fromGoogle: boolean
}
export interface DemoLinks { pixel: string; want: string; tg: string }
export interface DemoCounts { open: number; qr: number; want: number }
export interface DemoView {
  placeId: number; slug: string; kind: 'template' | 'import'; source: DemoSource
  content: DemoContent | null; status: DemoStatus; url: string | null
  publishedAt: number | null; error: string | null; counts: DemoCounts
  /** Подпись «Сайт сделал @ник» у импортированного сайта (по умолчанию выключена). */
  importBadge: boolean
}
export interface SetupState {
  github: { ok: boolean; owner?: string; repo?: string; pagesUrl?: string; error?: string; manualPages?: boolean }
  worker: { ok: boolean; url?: string; version?: string; error?: string; needSubdomain?: boolean }
}
