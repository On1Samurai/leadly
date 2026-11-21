export interface PostcardCard { name: string; qrUrl: string; headline: string; cover: string | null }

const TEXT = { ru: 'Ваш новый сайт. Наведите камеру.', uk: 'Ваш новий сайт. Наведіть камеру.' }
const GRADIENT = 'linear-gradient(135deg,#1b1b22,#3d3d52)'

// Карточка 105x74 мм; сетка 2x2 по центру A4 (210x297): поля 0 / 74.5 мм по высоте
const CSS = `@page { size: A4; margin: 0 }
*{box-sizing:border-box}html,body{margin:0;background:#fff}
body{width:210mm;height:297mm;position:relative;font:12px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.grid{position:absolute;left:0;top:74.5mm;width:210mm;height:148mm}
.card{position:absolute;width:105mm;height:74mm;overflow:hidden;background:#0b0b0d;color:#eee}
.card:nth-child(1){left:0;top:0}.card:nth-child(2){left:105mm;top:0}.card:nth-child(3){left:0;top:74mm}.card:nth-child(4){left:105mm;top:74mm}
.top{display:flex;gap:4mm;padding:5mm 5mm 0;height:50mm}
.qr{flex:none;width:40mm;height:40mm;background:#fff;border-radius:2mm;padding:0}.qr svg{display:block;width:100%;height:100%}
.txt{flex:1;min-width:0}.txt h1{font-size:15px;line-height:1.15;margin:1mm 0 3mm;overflow-wrap:anywhere}.txt p{margin:0;color:#aaa;font-size:11px}
.cov{position:absolute;left:0;right:0;bottom:0;height:20mm;background-size:cover;background-position:center;padding:0 5mm;display:flex;align-items:flex-end}
.cov span{display:block;width:100%;padding-bottom:3mm;font-size:12px;font-weight:600;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.8)}
.m{position:absolute;background:#bbb}`

// shortcut: 4 карточки занимают всю ширину A4, поэтому метки реза только в верхнем и нижнем поле (по вертикальным границам), не по бокам
const MARKS = [0, 105, 210].flatMap((x) => [66.5, 222.5].map((y) => [x, y]))

export function Postcard({ cards, svgs, lang }: { cards: PostcardCard[]; svgs: string[]; lang: 'ru' | 'uk' }) {
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <title>Leadly</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        {MARKS.map(([x, y]) => (
          <div key={`${x}-${y}`} className="m" style={{ left: `${Math.min(Math.max(x - 0.1, 0), 209.8)}mm`, top: `${y}mm`, width: '0.2mm', height: '8mm' }} />
        ))}
        <div className="grid">
          {cards.map((c, i) => (
            <div className="card" key={i}>
              <div className="top">
                {/* svg целиком от qrcode, пользовательского текста в нём нет */}
                <div className="qr" dangerouslySetInnerHTML={{ __html: svgs[i] }} />
                <div className="txt"><h1>{c.name}</h1><p>{TEXT[lang]}</p></div>
              </div>
              <div className="cov" style={{ backgroundImage: c.cover ? `url(${c.cover})` : GRADIENT }}><span>{c.headline}</span></div>
            </div>
          ))}
        </div>
      </body>
    </html>
  )
}
