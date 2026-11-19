import type { DemoContent, DemoKind, DemoLinks } from './types'
import { labels } from './labels'

const GRADIENT: Record<DemoKind, string> = {
  food: 'linear-gradient(135deg,#3a1c12,#7a3b1d)',
  beauty: 'linear-gradient(135deg,#2a1633,#6b2f5c)',
  auto: 'linear-gradient(135deg,#10202e,#2f5470)',
  default: 'linear-gradient(135deg,#1b1b22,#3d3d52)'
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#eee;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:560px;margin:0 auto;padding:16px}header{padding:8px 0 16px}h1{font-size:22px;margin:0}.meta{color:#aaa;font-size:14px}
.cover{border-radius:16px;overflow:hidden;background-size:cover;background-position:center;padding:140px 20px 20px;margin-bottom:24px}
.cover h2{font-size:30px;line-height:1.15;margin:0 0 8px;text-shadow:0 1px 8px rgba(0,0,0,.6)}.cover p{margin:0;color:#ddd;text-shadow:0 1px 6px rgba(0,0,0,.6)}
section{margin-bottom:24px}h3{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:0 0 8px}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #222}.rev{padding:10px 0;border-bottom:1px solid #222}
.rev strong{display:block}.note{color:#888;font-size:12px;margin-top:6px}a{color:#eee}
.btn{display:block;text-align:center;background:#f2f2f2;color:#0b0b0d;text-decoration:none;font-weight:600;padding:14px;border-radius:12px;margin:8px 0}
.btn.alt{background:transparent;color:#eee;border:1px solid #444}.badge{text-align:center;color:#888;font-size:13px;margin-top:20px}
.photos{display:flex;gap:8px;overflow-x:auto}.photos img{height:120px;border-radius:8px}`

export function DemoPage({ c, links }: { c: DemoContent; links: DemoLinks | null }) {
  const L = labels[c.lang]
  const cover = c.photos[0]
  const reviews = c.reviews.filter((r) => r.on).slice(0, 3)
  const sub = c.photos.slice(1)
  const credits = [...new Set(c.photos.map((p) => p.author).filter(Boolean))]
  const ctaText = L[c.cta.kind]
  const kindList = c.demoKind === 'food' ? L.menu : L.services
  return (
    <html lang={c.lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>{c.name}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <div className="w">
          <header>
            <h1>{c.name}</h1>
            <div className="meta">
              {c.rating != null && <>★ {c.rating}</>}
              {c.reviewsCount != null && <> · {c.reviewsCount} {L.reviewsWord}</>}
              {c.hours[0] && <> · {c.hours[0]}</>}
            </div>
          </header>
          <div className="cover" style={{ backgroundImage: cover ? `linear-gradient(transparent,rgba(0,0,0,.7)),url(${cover.file})` : GRADIENT[c.demoKind] }}>
            <h2>{c.headline}</h2>
            <p>{c.subhead}</p>
          </div>
          {sub.length > 0 && (
            <section className="photos">{sub.map((p) => <img key={p.file} src={p.file} alt="" loading="lazy" />)}</section>
          )}
          {c.items.length > 0 && (
            <section>
              <h3>{kindList}</h3>
              {c.items.map((it, i) => <div className="row" key={i}><span>{it.name}</span><span>{it.price}</span></div>)}
            </section>
          )}
          {c.hours.length > 0 && (
            <section>
              <h3>{L.hours}</h3>
              {c.hours.map((h, i) => <div key={i}>{h}</div>)}
            </section>
          )}
          {reviews.length > 0 && (
            <section>
              <h3>{L.reviews}</h3>
              {reviews.map((r, i) => (
                <div className="rev" key={i}><strong>{r.author}{r.rating != null && ` · ★ ${r.rating}`}</strong>{r.text}</div>
              ))}
              {c.fromGoogle && <div className="note">{L.fromGoogle}</div>}
            </section>
          )}
          {c.about && <section><h3>{L.about}</h3><p>{c.about}</p></section>}
          {c.fromGoogle && credits.length > 0 && <div className="note">{L.photoBy}: {credits.join(', ')}</div>}
          {c.address && (
            <section>
              <h3>{L.address}</h3>
              {c.mapsUrl ? <a href={c.mapsUrl}>{c.address}</a> : c.address}
            </section>
          )}
          <a className="btn" href={c.cta.target || undefined}>{ctaText}</a>
          {c.showBadge && (
            <div className="badge">
              <a href={links?.want}>{L.badge} @{links ? links.tg : L.nick}</a>
              <a className="btn alt" href={links?.want}>{L.want}</a>
            </div>
          )}
          {links && <img src={links.pixel} width={1} height={1} alt="" loading="lazy" {...{ referrerpolicy: "unsafe-url" }} />}
        </div>
      </body>
    </html>
  )
}
