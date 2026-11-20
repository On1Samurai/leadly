import { readFileSync } from 'node:fs'
import type { DemoContent, DemoPhoto, DemoSource, DemoStatus, DemoView, SetupState } from '../../shared/demo/types'
import type { Place } from '../../shared/types'
import { demoGoogleLeft, refundDemoGoogle, takeDemoGoogle } from '../core/daily'
import { getPlace, updatePlace } from '../db/repo'
import { CATEGORIES } from '../ipc/data'
import type { IpcDeps } from '../ipc/define'
import { askerFor } from '../llm/asker'
import { requireLicense } from '../license'
import { getSecret } from '../secrets'
import { loadSettings } from '../settings'
import { defaultCta, demoFiles, renderDemoHtml } from './build'
import { generateDemoCopy } from './copy'
import { nextPhotoNum, readDemoFile, readSite, removeDemoDir, writeDemoFile, writeSite } from './files'
import { GitHubError } from './github'
import { injectTracking, readImport, validateImport } from './import'
import { deployWorkerState, ghClient, githubState, setupGithub as setupGithubState, workerClient, workerState } from './setup'
import { makeSlug } from './slug'
import { cachedDetails, DEMO_GOOGLE_NEED, fetchGoogleDemo, GOOGLE_DEMO_COST_USD, matchGoogle, type SourceData } from './sources/google'
import { freeDemo } from './sources/free'

interface Row {
  id: number; place_id: number; slug: string; kind: 'template' | 'import'; source: DemoSource; content: string
  status: DemoStatus; url: string | null; commit_sha: string | null; published_at: number | null; error: string | null; badge: number
}
type RowPatch = Partial<Pick<Row, 'status' | 'url' | 'commit_sha' | 'published_at' | 'error'>>

const MAX_PHOTOS = 20
const mapsFallback = (p: Place): string => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`

export class DemoService {
  /** placeId, по которым идёт сборка, импорт, публикация, снятие или удаление. */
  private busy = new Set<number>()
  constructor(private d: IpcDeps) {
    // публикация оборвалась вместе с программой: сайт мог успеть выйти, error снимается при удалении места
    d.db.prepare("UPDATE demos SET status='error', error='interrupted' WHERE status='publishing'").run()
  }

  private get root(): string { return this.d.userDataDir }
  private license(): void { requireLicense(this.d.db, this.d.now(), this.d.licensePublicKey) }

  private row(placeId: number): Row | undefined {
    return this.d.db.prepare('SELECT * FROM demos WHERE place_id=?').get(placeId) as Row | undefined
  }
  private need(placeId: number): Row {
    const r = this.row(placeId)
    if (!r) throw new Error('demo_not_found')
    return r
  }
  private content(r: Row): DemoContent {
    const c = JSON.parse(r.content) as DemoContent | null
    if (!c) throw new Error('demo_no_content')
    return c
  }
  private place(id: number): Place {
    const p = getPlace(this.d.db, id)
    if (!p) throw new Error('not_found')
    return p
  }
  private set(id: number, f: RowPatch): void {
    const keys = Object.keys(f) as (keyof RowPatch)[]
    this.d.db.prepare(`UPDATE demos SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`)
      .run(...keys.map((k) => f[k] ?? null), this.d.now(), id)
  }
  private newSlug(name: string): string {
    return makeSlug(name, this.d.rng, (s) => !!this.d.db.prepare('SELECT 1 FROM demos WHERE slug=?').get(s))
  }
  /** Вставка или смена вида; slug и статус существующего демо сохраняются. */
  private upsert(placeId: number, slug: string, kind: Row['kind'], source: DemoSource, content: DemoContent | null | undefined): void {
    const now = this.d.now()
    const old = this.row(placeId)
    if (old) {
      this.d.db.prepare('UPDATE demos SET kind=?, source=?, content=?, updated_at=? WHERE id=?')
        .run(kind, source, content === undefined ? old.content : JSON.stringify(content), now, old.id)
    } else {
      this.d.db.prepare("INSERT INTO demos(place_id,slug,kind,source,content,status,created_at,updated_at) VALUES (?,?,?,?,?,'draft',?,?)")
        .run(placeId, slug, kind, source, JSON.stringify(content ?? null), now, now)
    }
  }

  private view(r: Row): DemoView {
    const counts = { open: 0, qr: 0, want: 0 }
    for (const x of this.d.db.prepare('SELECT kind, COUNT(*) AS n FROM demo_events WHERE demo_id=? GROUP BY kind').all(r.id) as { kind: keyof typeof counts; n: number }[]) {
      if (x.kind in counts) counts[x.kind] = x.n
    }
    return {
      placeId: r.place_id, slug: r.slug, kind: r.kind, source: r.source, content: JSON.parse(r.content), status: r.status,
      url: r.url, publishedAt: r.published_at, error: r.error, counts, importBadge: r.badge === 1
    }
  }

  get(placeId: number): DemoView | null {
    const r = this.row(placeId)
    return r ? this.view(r) : null
  }

  list(): (DemoView & { placeName: string })[] {
    const rows = this.d.db.prepare('SELECT d.*, p.name AS place_name FROM demos d JOIN places p ON p.id=d.place_id ORDER BY d.updated_at DESC')
      .all() as (Row & { place_name: string })[]
    return rows.map((r) => ({ ...this.view(r), placeName: r.place_name }))
  }

  budget(): { left: number; limit: number; costUsd: number; need: number } {
    const limit = loadSettings(this.d.db).demoGoogleDaily
    return { left: demoGoogleLeft(this.d.db, this.d.now(), limit), limit, costUsd: GOOGLE_DEMO_COST_USD, need: DEMO_GOOGLE_NEED }
  }

  /** Один платный Text Search: пользователь подтверждает найденное место до Details. */
  async match(placeId: number): Promise<{ googleId: string; name: string; address: string | null; distanceM: number } | null> {
    this.license()
    const p = this.place(placeId)
    const key = getSecret(this.d.db, 'google', this.d.secretEnv)
    if (!key) throw new Error('no_google_key')
    const s = loadSettings(this.d.db)
    if (!takeDemoGoogle(this.d.db, this.d.now(), 1, s.demoGoogleDaily)) throw new Error('demo_google_limit') // резерв до запроса
    return matchGoogle(p, key, this.d.fetch, s.lang)
  }

  private async copyFor(placeId: number, c: Pick<DemoContent, 'name' | 'demoKind' | 'lang' | 'rating' | 'reviewsCount' | 'reviews'>, category: string, summary: string | null, fresh = false) {
    const { copy } = await generateDemoCopy(
      { name: c.name, category, demoKind: c.demoKind, lang: c.lang, rating: c.rating, reviewsCount: c.reviewsCount,
        reviews: c.reviews.filter((r) => r.on).map((r) => r.text), summary },
      { ask: askerFor(this.d, loadSettings(this.d.db)), db: this.d.db, placeId, fresh }
    )
    return copy
  }

  async build(placeId: number, o: { source: 'auto' | 'free'; googleId?: string }): Promise<DemoView> {
    this.license()
    this.place(placeId)
    await this.exclusive(placeId, () => this.doBuild(placeId, o))
    return this.view(this.need(placeId))
  }

  private async doBuild(placeId: number, o: { source: 'auto' | 'free'; googleId?: string }): Promise<void> {
    const { db } = this.d
    const p = this.place(placeId)
    const s = loadSettings(db)
    const now = this.d.now()
    const key = o.source === 'auto' ? getSecret(db, 'google', this.d.secretEnv) : null
    const cached = key ? cachedDetails(db, placeId, now) : null
    let fetched: Awaited<ReturnType<typeof fetchGoogleDemo>> | null = null
    let src: SourceData
    if (cached) src = cached
    else if (key) {
      const gid = o.googleId ?? p.googlePlaceId
      if (!gid) throw new Error('no_google_id')
      // резерв на всю сборку до запроса: параллельные сборки не превысят лимит; упавшая сборка резерв не возвращает
      if (!takeDemoGoogle(db, now, DEMO_GOOGLE_NEED, s.demoGoogleDaily)) throw new Error('demo_google_limit')
      fetched = await fetchGoogleDemo(gid, key, this.d.fetch, s.lang)
      refundDemoGoogle(db, now, DEMO_GOOGLE_NEED - fetched.requests)
      src = fetched
    } else src = freeDemo(db, p, s.lang)

    const cat = CATEGORIES.find((c) => c.id === p.category)
    const demoKind = cat?.demoKind ?? 'default'
    const mapsUrl = src.mapsUrl ?? mapsFallback(p)
    const base = { name: p.name, demoKind, lang: s.lang, rating: src.rating ?? p.rating, reviewsCount: src.reviewsCount ?? p.reviews, reviews: src.reviews }
    const copy = await this.copyFor(placeId, base, cat?.title ?? p.category, src.summary)

    // дальше без await: место могли удалить, пока ждали Google и ИИ — тогда ни строк, ни файлов
    const cur = this.place(placeId)
    const old = this.row(placeId)
    const slug = old?.slug ?? this.newSlug(cur.name)
    let photos: DemoPhoto[] = cached ? cached.photoFiles.map((f) => ({ ...f, source: 'google' })) : []
    if (fetched) {
      let n = nextPhotoNum(this.root, slug)
      photos = fetched.photos.map((ph) => {
        const file = `img/${n++}.jpg`
        writeDemoFile(this.root, slug, file, this.d.resizeImage(ph.bytes))
        return { file, author: ph.author, source: 'google' }
      })
      db.prepare('INSERT OR REPLACE INTO place_details(place_id,hours,reviews,photos,summary,fetched_at) VALUES (?,?,?,?,?,?)')
        .run(placeId, JSON.stringify(fetched.hours), JSON.stringify(fetched.reviews), JSON.stringify(photos.map(({ file, author }) => ({ file, author }))), fetched.summary, now)
      // подтверждённое совпадение: следующие сборки обойдутся без Text Search; google_place_id уникален
      if (o.googleId && !cur.googlePlaceId && !db.prepare('SELECT 1 FROM places WHERE google_place_id=?').get(o.googleId)) {
        updatePlace(db, placeId, { googlePlaceId: o.googleId })
      }
    }
    // пункты с ценами и свои фото вводил пользователь: пересборка их не стирает
    const prev = old ? (JSON.parse(old.content) as DemoContent | null) : null
    const userPhotos = prev?.photos.filter((x) => x.source === 'user') ?? []
    const content: DemoContent = {
      ...base, ...copy, hours: src.hours, items: prev?.items ?? [], photos: [...userPhotos, ...photos].slice(0, MAX_PHOTOS),
      address: p.address, mapsUrl, phone: p.phoneE164, cta: defaultCta(demoKind, { phone: p.phoneE164, mapsUrl }),
      showBadge: true, fromGoogle: src.fromGoogle
    }
    this.upsert(placeId, slug, 'template', src.fromGoogle ? 'google' : 'free', content)
  }

  save(placeId: number, c: DemoContent): void {
    this.d.db.prepare('UPDATE demos SET content=?, updated_at=? WHERE id=?').run(JSON.stringify(c), this.d.now(), this.need(placeId).id)
  }

  async rewrite(placeId: number): Promise<DemoContent> {
    this.license()
    const c = this.content(this.need(placeId))
    const p = this.place(placeId)
    const summary = (this.d.db.prepare('SELECT summary FROM place_details WHERE place_id=?').get(placeId) as { summary: string | null } | undefined)?.summary ?? null
    const copy = await this.copyFor(placeId, c, CATEGORIES.find((x) => x.id === p.category)?.title ?? p.category, summary, true)
    const next = { ...this.content(this.need(placeId)), ...copy } // черновик мог сохраниться, пока ждали ИИ
    this.save(placeId, next)
    return next
  }

  preview(placeId: number, c: DemoContent): string {
    const { slug } = this.need(placeId)
    const photos = c.photos.flatMap((ph) => {
      try { return [{ ...ph, file: `data:image/jpeg;base64,${readDemoFile(this.root, slug, ph.file).toString('base64')}` }] } catch { return [] }
    })
    return renderDemoHtml({ ...c, photos }, null) // без ссылок: превью не должно писать открытия в Worker
  }

  async photoAdd(placeId: number): Promise<DemoContent> {
    const f = await this.d.openDialog('image')
    const r = this.need(placeId) // после диалога: черновик мог сохраниться, пока он был открыт
    const c = this.content(r)
    if (!f) return c
    if (c.photos.length >= MAX_PHOTOS) throw new Error('demo_too_many_photos')
    const file = `img/${nextPhotoNum(this.root, r.slug)}.jpg`
    writeDemoFile(this.root, r.slug, file, this.d.resizeImage(readFileSync(f)))
    const next: DemoContent = { ...c, photos: [...c.photos, { file, author: null, source: 'user' }] }
    this.save(placeId, next)
    return next
  }

  async importSite(placeId: number, kind: 'folder' | 'zip' | 'html'): Promise<DemoView> {
    const path = await this.d.openDialog(kind)
    if (!path) {
      const old = this.row(placeId)
      if (old) return this.view(old)
      throw new Error('cancelled')
    }
    this.place(placeId)
    await this.exclusive(placeId, async () => {
      const files = validateImport(await readImport({ kind, path }))
      const p = this.place(placeId) // место могли удалить, пока читали файлы
      const slug = this.row(placeId)?.slug ?? this.newSlug(p.name)
      writeSite(this.root, slug, files)
      this.upsert(placeId, slug, 'import', 'import', undefined)
    })
    return this.view(this.need(placeId))
  }

  setImportBadge(placeId: number, on: boolean): DemoView {
    this.d.db.prepare('UPDATE demos SET badge=?, updated_at=? WHERE id=?').run(on ? 1 : 0, this.d.now(), this.need(placeId).id)
    return this.view(this.need(placeId))
  }

  private async exclusive<T>(placeId: number, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(placeId)) throw new Error('demo_busy')
    this.busy.add(placeId)
    try { return await fn() } finally { this.busy.delete(placeId) }
  }

  async publish(placeId: number): Promise<DemoView> {
    this.license()
    const s = loadSettings(this.d.db)
    const r = this.need(placeId)
    if (!s.demoTg) throw new Error('demo_no_tg')
    const gh = ghClient(this.d)
    const worker = workerClient(this.d)
    if (!gh || !worker) throw new Error('demo_not_setup')
    await this.exclusive(placeId, async () => {
      this.set(r.id, { status: 'publishing', error: null })
      try {
        const links = { pixel: `${worker.url}/o/${r.slug}`, want: `${worker.url}/w/${r.slug}`, tg: s.demoTg }
        const files = r.kind === 'import'
          ? injectTracking(await readSite(this.root, r.slug), links, r.badge === 1, s.lang)
          : demoFiles(this.content(r), links, (f) => readDemoFile(this.root, r.slug, f))
        const sha = await gh.publish(r.slug, files, `demo: ${r.slug}`)
        this.set(r.id, { commit_sha: sha })
        const built = await gh.waitBuild(sha, this.d.sleep)
        if (built !== 'built') throw new Error(built === 'errored' ? 'gh_build_failed' : 'gh_build_timeout')
        const url = gh.pagesUrl(r.slug)
        this.set(r.id, { url })
        await worker.api.putTarget(r.slug, url, s.demoTg)
        this.set(r.id, { status: 'published', published_at: this.d.now(), error: null })
      } catch (e) {
        this.set(r.id, { status: 'error', error: e instanceof GitHubError ? e.code : (e as Error).message })
      }
    })
    return this.view(this.need(placeId))
  }

  async unpublish(placeId: number): Promise<DemoView> {
    const r = this.need(placeId)
    const gh = ghClient(this.d)
    const worker = workerClient(this.d)
    if (!gh || !worker) throw new Error('demo_not_setup')
    await this.exclusive(placeId, async () => {
      await gh.unpublish(r.slug)
      await worker.api.deleteTarget(r.slug)
      this.set(r.id, { status: 'unpublished', url: null, error: null })
    })
    return this.view(this.need(placeId))
  }

  async openLive(placeId: number): Promise<void> {
    const r = this.need(placeId)
    if (r.status !== 'published' || !r.url) throw new Error('demo_not_published')
    await this.d.openExternal(r.url + '?me=1')
  }

  /** Перед удалением места: снять сайт и цель Worker; не вышло — бросает, место не удаляется. */
  async removeForPlace(placeId: number): Promise<void> {
    await this.exclusive(placeId, async () => { // и без демо: первая сборка может идти прямо сейчас
      const r = this.row(placeId)
      if (!r) return
      const live = r.status === 'published' || r.status === 'publishing' || r.status === 'error'
      const gh = ghClient(this.d)
      const worker = workerClient(this.d)
      if (live && !gh) throw new Error('demo_not_setup')
      try {
        if (live) await gh!.unpublish(r.slug)
        if (worker) await worker.api.deleteTarget(r.slug)
      } catch {
        throw new Error('demo_offline')
      }
      removeDemoDir(this.root, r.slug) // сначала файлы: если не удалились, строки целы и можно повторить
      this.d.db.transaction(() => {
        this.d.db.prepare('DELETE FROM demo_events WHERE demo_id=?').run(r.id)
        this.d.db.prepare('DELETE FROM demos WHERE id=?').run(r.id)
        this.d.db.prepare('DELETE FROM place_details WHERE place_id=?').run(placeId)
      })()
    })
  }

  async setup(): Promise<SetupState> {
    return { github: await githubState(this.d), worker: await workerState(this.d) }
  }

  async setupGithub(repo = 'leadly-demos'): Promise<SetupState> {
    return { github: await setupGithubState(this.d, repo), worker: await workerState(this.d) }
  }

  async setupWorker(): Promise<SetupState> {
    return { github: await githubState(this.d), worker: await deployWorkerState(this.d) }
  }
}
