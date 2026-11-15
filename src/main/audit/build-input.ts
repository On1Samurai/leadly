import type { AuditInput } from './detect'

export interface PageData {
  viewport: boolean; scrollWidth: number; innerWidth: number; smallTextShare: number; loadMs: number
  html: string; text: string; hrefs: string[]
}

export function buildInput(a: {
  finalUrl: string; contentType: string; headers: Record<string, string>
  cert: AuditInput['cert']; page: PageData | null; brokenLinks: string[]; checkMenu: boolean
}): AuditInput {
  const isHtml = a.contentType.toLowerCase().includes('text/html') && a.page !== null
  const p = a.page
  return {
    finalUrl: a.finalUrl, contentType: a.contentType, httpsOk: /^https:/i.test(a.finalUrl),
    cert: a.cert, headers: a.headers,
    html: isHtml ? p!.html : '', text: isHtml ? p!.text : '',
    metrics: isHtml
      ? { viewport: p!.viewport, scrollWidth: p!.scrollWidth, innerWidth: p!.innerWidth, smallTextShare: p!.smallTextShare, loadMs: p!.loadMs }
      : null,
    brokenLinks: isHtml ? a.brokenLinks : [], checkMenu: a.checkMenu
  }
}
