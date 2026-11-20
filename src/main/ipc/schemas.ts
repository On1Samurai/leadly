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
  onboarded: bool,
  llmProvider: z.enum(['openai', 'anthropic']),
  llmBaseUrl: z.string().trim().max(300).url().refine((u) => u.startsWith('https://'), 'https only'),
  llmModel: z.string().trim().min(1).max(200),
  demoTg: z.string().trim().regex(/^[A-Za-z0-9_]{0,32}$/),
  demoGoogleDaily: num('demoGoogleDaily')
}).partial().strict()

const status = z.enum(STATUSES)
const channel = z.enum(CHANNEL_IDS)

const placeFilter = z.object({
  cityId: id.optional(), inBase: bool.optional(), webClass: z.array(z.enum(['none', 'social', 'template', 'own'])).max(4).optional(),
  status: z.array(status).max(8).optional(), category: z.string().max(64).optional()
})

const str = (max: number) => z.string().max(max)
// ссылки попадают в href опубликованной страницы: только https:, tel: или пусто (не javascript:)
const href = str(2000).regex(/^(?:$|https:\/\/|tel:)/)
/** Контент редактора: файлы фото только img/<n>.jpg внутри папки демо. */
export const DemoContentSchema = z.object({
  name: str(200), demoKind: z.enum(['food', 'beauty', 'auto', 'default']), lang: z.enum(['ru', 'uk']),
  headline: str(200), subhead: str(400), about: str(2000),
  rating: z.number().min(0).max(5).nullable(), reviewsCount: z.number().int().min(0).nullable(),
  hours: z.array(str(200)).max(14),
  items: z.array(z.object({ name: str(200), price: str(50) }).strict()).max(100),
  reviews: z.array(z.object({ author: str(200), text: str(3000), rating: z.number().min(0).max(5).nullable(), on: bool }).strict()).max(10),
  photos: z.array(z.object({
    file: z.string().regex(/^img\/\d{1,4}\.jpg$/), author: str(200).nullable(), source: z.enum(['google', 'user'])
  }).strict()).max(20),
  address: str(500).nullable(), mapsUrl: href.nullable(), phone: str(50).nullable(),
  cta: z.object({ kind: z.enum(['call', 'route', 'book']), target: href }).strict(),
  showBadge: bool, fromGoogle: bool
}).strict()

const none = z.tuple([])
export const ARGS = {
  'settings.get': none,
  'settings.set': z.tuple([SettingsPatchSchema]),
  'secrets.set': z.tuple([z.enum(['llm', 'anthropic', 'google', 'telegram', 'github', 'cloudflare']), z.string().max(2000)]),
  'secrets.has': none,
  'city.search': z.tuple([z.string().trim().min(1).max(200)]),
  'city.save': z.tuple([z.object({ id: z.string().min(1).max(100) }).strict()]),
  'city.list': none,
  'pass.start': z.tuple([z.object({ cityId: id, categoryId: z.string().min(1).max(64) })]),
  'pass.status': none, 'pass.pause': none, 'pass.resume': none, 'pass.stop': none,
  'pass.cells': z.tuple([id]),
  'places.list': z.tuple([placeFilter.extend({
    sort: z.enum(['score', 'new']), limit: z.number().int().min(1).max(500), offset: z.number().int().min(0)
  })]),
  'places.counts': z.tuple([placeFilter]),
  'places.nextCandidates': z.tuple([id.optional()]),
  'places.get': z.tuple([id]),
  'places.toBase': z.tuple([id, bool]),
  'places.setStatus': z.tuple([id, status]),
  'places.remind': z.tuple([id, z.number().int().min(0)]),
  'places.setDeal': z.tuple([id, z.number().int().min(0).max(1_000_000_000_000).nullable()]),
  'places.note': z.tuple([id, z.enum(['in', 'note']), z.string().trim().min(1).max(5000)]),
  'places.refreshGoogle': z.tuple([id]),
  'places.remove': z.tuple([id]),
  'message.generate': z.tuple([id, z.enum(['business', 'friendly', 'short'])]),
  'write.status': none,
  'write.open': z.tuple([id, channel, z.string().min(1).max(1000)]),
  'write.confirm': z.tuple([id, channel, z.string().min(1).max(1000)]),
  'audit.run': z.tuple([id]),
  'audit.screenshot': z.tuple([id]),
  'today.get': none,
  'mission.get': none,
  'app.dataDir': none,
  'bot.bindCode': none,
  'bot.unlink': none,
  'bot.status': none,
  'backup.export': none,
  'license.get': none,
  'license.set': z.tuple([z.string().max(4000)]),
  'update.check': none, 'update.download': none, 'update.install': none, 'update.status': none,
  'app.version': none,
  'demo.get': z.tuple([id]),
  'demo.list': none,
  'demo.match': z.tuple([id]),
  'demo.build': z.tuple([id, z.object({ source: z.enum(['auto', 'free']), googleId: z.string().min(1).max(300).optional() }).strict()]),
  'demo.save': z.tuple([id, DemoContentSchema]),
  'demo.rewrite': z.tuple([id]),
  'demo.preview': z.tuple([id, DemoContentSchema]),
  'demo.photoAdd': z.tuple([id]),
  'demo.importSite': z.tuple([id, z.enum(['folder', 'zip', 'html'])]),
  'demo.publish': z.tuple([id]),
  'demo.unpublish': z.tuple([id]),
  'demo.openLive': z.tuple([id]),
  'demo.postcard': z.tuple([z.array(id).min(1).max(100)]),
  'demo.setup': none,
  'demo.setupGithub': z.tuple([z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional()]),
  'demo.setupWorker': none,
  'demo.budget': none
} satisfies Record<ChannelName, z.ZodType>
