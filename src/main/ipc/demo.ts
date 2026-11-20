import type { DemoService } from '../demo/service'
import { define, stub, type Table } from './define'

export function demoHandlers(t: Table, svc: DemoService): void {
  define(t, 'demo.get', (_e, id) => svc.get(id))
  define(t, 'demo.list', () => svc.list())
  define(t, 'demo.match', (_e, id) => svc.match(id))
  define(t, 'demo.build', (_e, id, o) => svc.build(id, o))
  define(t, 'demo.save', (_e, id, c) => svc.save(id, c))
  define(t, 'demo.rewrite', (_e, id) => svc.rewrite(id))
  define(t, 'demo.preview', (_e, id, c) => svc.preview(id, c))
  define(t, 'demo.photoAdd', (_e, id) => svc.photoAdd(id))
  define(t, 'demo.importSite', (_e, id, kind) => svc.importSite(id, kind))
  define(t, 'demo.publish', (_e, id) => svc.publish(id))
  define(t, 'demo.unpublish', (_e, id) => svc.unpublish(id))
  define(t, 'demo.openLive', (_e, id) => svc.openLive(id))
  stub(t, 'demo.postcard') // Задача 13
  define(t, 'demo.setup', () => svc.setup())
  define(t, 'demo.setupGithub', (_e, repo?: string) => svc.setupGithub(repo))
  define(t, 'demo.setupWorker', () => svc.setupWorker())
  define(t, 'demo.budget', () => svc.budget())
}
