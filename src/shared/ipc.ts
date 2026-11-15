import type { Score } from '../main/core/scoring'
import type { GeoMultiPolygon, GeoPolygon } from '../main/core/geo'
import type { AppSettings, Tone } from './settings'
import type { MissionStep } from './mission'
import type { BBox, Channel, Contact, Finding, Place, Status, WebClass } from './types'

export type SecretName = 'anthropic' | 'google' | 'telegram'

export interface CityHit { id: string; name: string; displayName: string; bbox: BBox; polygon: GeoPolygon | GeoMultiPolygon | null }
export interface PassSummary { passId: number; cellsDone: number; newCount: number; dupCount: number; googleUsed: number; stopped: boolean }
export type PassEvent =
  | { type: 'cell'; cellId: number; ix: number; iy: number; newCount: number; dupCount: number; googleRequests: number }
  | { type: 'warning'; text: string }
  | { type: 'done'; summary: PassSummary }
export interface PlaceFilter {
  cityId?: number; inBase?: boolean; webClass?: WebClass[]; status?: Status[]; category?: string
  sort: 'score' | 'new'; limit: number; offset: number
}

export interface CellView { ix: number; iy: number; bbox: BBox; newCount: number; googleRequests: number }
export interface PlaceView extends Place { textReady: boolean }
export interface PlaceDetails extends Omit<Place, 'score'> {
  contacts: Contact[]
  findings: Finding[]
  messages: { direction: 'out' | 'in' | 'note'; channel: Channel | null; text: string; createdAt: number }[]
  statusLog: { from: Status | null; to: Status; at: number }[]
  score: Score
  channels: Channel[]
}
export interface TodayView { goal: number; written: number; remindToday: PlaceView[]; replied: PlaceView[]; leftToday: number }

export type WriteOpen = { url: string | null; prefilled: boolean; left: number } | { blocked: true }

export interface Api {
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<void> }
  secrets: { set(name: SecretName, value: string): Promise<void>; has(): Promise<Record<SecretName, boolean>> }
  city: { search(q: string): Promise<CityHit[]>; save(hit: { id: string }): Promise<number>; list(): Promise<{ id: number; name: string }[]> }
  pass: {
    start(p: { cityId: number; categoryId: string }): Promise<void>; pause(): Promise<void>; resume(): Promise<void>
    stop(): Promise<void>; status(): Promise<{ running: boolean; cityId: number | null }>; cells(cityId: number): Promise<CellView[]>; onEvent(cb: (e: PassEvent) => void): () => void
  }
  places: {
    list(f: PlaceFilter): Promise<PlaceView[]>; get(id: number): Promise<PlaceDetails>
    toBase(id: number, v: boolean): Promise<void>; setStatus(id: number, s: Status): Promise<void>
    remind(id: number, at: number): Promise<void>; note(id: number, dir: 'in' | 'note', text: string): Promise<void>
    refreshGoogle(id: number): Promise<void>; remove(id: number): Promise<void>
  }
  message: { generate(id: number, tone: Tone): Promise<{ text: string; cached: boolean }> }
  write: { open(id: number, ch: Channel, text: string): Promise<WriteOpen>; confirm(id: number, ch: Channel, text: string): Promise<void> }
  audit: { run(id: number): Promise<void>; screenshot(id: number): Promise<string | null> }
  today: { get(): Promise<TodayView> }
  mission: { get(): Promise<MissionStep> }
  app: { dataDir(): Promise<string> }
  bot: { bindCode(): Promise<string>; status(): Promise<{ linked: boolean; running: boolean }> }
  backup: { export(): Promise<string | null> }
}

/** Единственный источник каналов: preload строит window.api из него, main регистрирует ровно их. */
type MethodMap = { [G in keyof Api]: Record<Exclude<keyof Api[G], 'onEvent'>, true> }
export const METHODS: MethodMap = {
  settings: { get: true, set: true },
  secrets: { set: true, has: true },
  city: { search: true, save: true, list: true },
  pass: { start: true, pause: true, resume: true, stop: true, status: true, cells: true },
  places: { list: true, get: true, toBase: true, setStatus: true, remind: true, note: true, refreshGoogle: true, remove: true },
  message: { generate: true },
  write: { open: true, confirm: true },
  audit: { run: true, screenshot: true },
  today: { get: true },
  mission: { get: true },
  app: { dataDir: true },
  bot: { bindCode: true, status: true },
  backup: { export: true }
}
export type ChannelName = { [G in keyof MethodMap]: `${G}.${keyof MethodMap[G] & string}` }[keyof MethodMap]
export const PASS_EVENT = 'pass.event'
