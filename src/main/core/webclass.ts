import type { WebClass } from '../../shared/types'
import classes from '../../../resources/data/web-classes.json'

export function hostOf(url: string): string | null {
  const s = url.trim()
  if (!s) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
    const h = u.hostname.toLowerCase().replace(/^www\./, '')
    return h || null
  } catch {
    return null
  }
}

function matches(host: string, patterns: string[]): boolean {
  return patterns.some((p) =>
    p.includes('.') ? host === p || host.endsWith(`.${p}`) : host.includes(p)
  )
}

export function classifyWeb(url: string | undefined): WebClass {
  if (!url || !url.trim()) return 'none'
  const host = hostOf(url)
  if (!host) return /^[\w-]+(\.[\w-]+)+/.test(url.trim()) ? 'own' : 'none'
  if (matches(host, classes.social)) return 'social'
  if (matches(host, classes.template)) return 'template'
  return 'own'
}
