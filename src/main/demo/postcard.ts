import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import QRCode from 'qrcode'
import { Postcard, type PostcardCard } from '../../shared/demo/Postcard'

/** A4, сетка 2x2 карточек 105x74 мм с метками реза; cover — data: URL или null. */
export async function postcardHtml(cards: PostcardCard[], lang: 'ru' | 'uk' = 'ru'): Promise<string> {
  const svgs = await Promise.all(cards.map((c) =>
    QRCode.toString(c.qrUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000', light: '#fff' } })))
  return '<!doctype html>' + renderToStaticMarkup(createElement(Postcard, { cards, svgs, lang }))
}
