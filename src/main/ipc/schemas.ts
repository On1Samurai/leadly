import { z } from 'zod'
import type { ChannelName } from '../../shared/ipc'
import { NUM_LIMITS, type NumKey } from '../../shared/settings'

export const STATUSES = ['new', 'written', 'replied', 'demo_opened', 'call', 'deal', 'refused', 'later'] as const
export const CHANNEL_IDS = ['telegram', 'whatsapp', 'viber', 'instagram', 'vk', 'max', 'call', 'sms'] as const

const id = z.number().int().positive()
const bool = z.boolean()
const num = (k: NumKey) => z.number().int().min(NUM_LIMITS[k].min).max(NUM_LIMITS[k].max)

// sizeKm строго из набора: иначе сетка города может стать бесконечной
export const SettingsPatchSchema = z.object({
  sells: z.array(z.string().max(200)).max(50),
  custom: z.string().max(1000),
  country: z.string().regex(/^[A-Z]{2}$/),
  lang: z.enum(['ru', 'uk']),
  tone: z.enum(['business', 'friendly', 'short']),
  sizeKm: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
  densityThreshold: num('densityThreshold'),
  nextPageThreshold: num('nextPageThreshold'),
  randomEvery: num('randomEvery'),
  googleBudget: num('googleBudget'),
  dailyWriteLimit: num('dailyWriteLimit'),
  dailyGoal: num('dailyGoal'),
  noReplyDays: num('noReplyDays'),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  autostart: bool,
  runInBackground: bool,
  onboarded: bool
}).partial().strict()

const status = z.enum(STATUSES)
const channel = z.enum(CHANNEL_IDS)

const none = z.tuple([])
export const ARGS = {
  'settings.get': none,
  'settings.set': z.tuple([SettingsPatchSchema]),
  'secrets.set': z.tuple([z.enum(['anthropic', 'google', 'telegram']), z.string().max(2000)]),
  'secrets.has': none,
  'city.search': z.tuple([z.string().trim().min(1).max(200)]),
  'city.save': z.tuple([z.object({ id: z.string().min(1).max(100) }).strict()]),
  'city.list': none,
  'pass.start': z.tuple([z.object({ cityId: id, categoryId: z.string().min(1).max(64) })]),
  'pass.status': none, 'pass.pause': none, 'pass.resume': none, 'pass.stop': none,
  'pass.cells': z.tuple([id]),
  'places.list': z.tuple([z.object({
    cityId: id.optional(), inBase: bool.optional(), webClass: z.array(z.enum(['none', 'social', 'template', 'own'])).max(4).optional(),
    status: z.array(status).max(8).optional(), category: z.string().max(64).optional(),
    sort: z.enum(['score', 'new']), limit: z.number().int().min(1).max(500), offset: z.number().int().min(0)
  })]),
  'places.get': z.tuple([id]),
  'places.toBase': z.tuple([id, bool]),
  'places.setStatus': z.tuple([id, status]),
  'places.remind': z.tuple([id, z.number().int().min(0)]),
  'places.note': z.tuple([id, z.enum(['in', 'note']), z.string().trim().min(1).max(5000)]),
  'places.refreshGoogle': z.tuple([id]),
  'places.remove': z.tuple([id]),
  'message.generate': z.tuple([id, z.enum(['business', 'friendly', 'short'])]),
  'write.open': z.tuple([id, channel, z.string().max(5000)]),
  'write.confirm': z.tuple([id, channel, z.string().max(5000)]),
  'audit.run': z.tuple([id]),
  'audit.screenshot': z.tuple([id]),
  'today.get': none,
  'mission.get': none,
  'app.dataDir': none,
  'bot.bindCode': none,
  'bot.status': none,
  'backup.export': none
} satisfies Record<ChannelName, z.ZodType>
