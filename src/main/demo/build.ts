import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DemoPage } from '../../shared/demo/DemoPage'
import type { DemoContent, DemoCta, DemoKind, DemoLinks } from '../../shared/demo/types'

export function renderDemoHtml(c: DemoContent, links: DemoLinks | null): string {
  return '<!doctype html>' + renderToStaticMarkup(createElement(DemoPage, { c, links }))
}

export function demoFiles(
  c: DemoContent, links: DemoLinks, readPhoto: (file: string) => Buffer
): { path: string; content: Buffer }[] {
  return [
    { path: 'index.html', content: Buffer.from(renderDemoHtml(c, links)) },
    ...c.photos.map((p) => ({ path: p.file, content: readPhoto(p.file) }))
  ]
}

export function defaultCta(kind: DemoKind, p: { phone: string | null; mapsUrl: string | null }): DemoCta {
  const tel = p.phone ? `tel:${p.phone}` : ''
  if (kind === 'food') return { kind: 'route', target: p.mapsUrl ?? '' }
  if (kind === 'beauty') return { kind: 'book', target: tel }
  return { kind: 'call', target: tel }
}
