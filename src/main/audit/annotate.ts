import type { Finding } from '../../shared/types'

/** Self-contained JS for executeJavaScript. All text is embedded via JSON.stringify and set with textContent. */
export function annotationScript(findings: Finding[]): string {
  const lines = findings.filter((f) => f.confirmed).map((f) => f.evidence)
  const codes = findings.map((f) => f.code)
  return `(() => {
  const lines = ${JSON.stringify(lines)};
  const codes = ${JSON.stringify(codes)};
  const RED = '3px solid #e5322d';
  if (codes.includes('h_scroll')) document.body.style.outline = RED;
  if (codes.includes('old_footer_year')) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let hit = null, n;
    while ((n = w.nextNode())) { if (/©|&copy;|\\(c\\)/i.test(n.nodeValue || '') && n.parentElement) hit = n.parentElement; }
    if (hit) { hit.style.outline = RED; hit.style.outlineOffset = '2px'; }
  }
  if (lines.length) {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#e5322d;color:#fff;font:600 14px/1.4 sans-serif;padding:8px 12px;box-sizing:border-box';
    for (const l of lines) { const d = document.createElement('div'); d.textContent = '• ' + l; b.appendChild(d); }
    document.body.appendChild(b);
  }
})()`
}
