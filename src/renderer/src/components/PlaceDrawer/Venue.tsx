import { useEffect, useRef, useState } from 'react'
import type { PlaceDetails } from '../../../../shared/ipc'
import type { Factor } from '../../../../main/core/scoring'
import { percentLabel } from '../../../../shared/percent'
import { errText } from '../../lib'
import { WEB_LABEL } from '../../labels'
import { Button } from '../Button'

const GROUPS: [Factor['group'], string][] = [['need', 'Нужда'], ['reach', 'Досягаемость'], ['response', 'Отклик']]
const signed = (n: number): string => (n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : '0%')

const FINDING: Record<string, string> = {
  no_https: 'Нет HTTPS', cert_invalid: 'Сертификат недействителен', cert_expiring: 'Сертификат скоро истекает',
  cms: 'Шаблонная CMS', no_viewport: 'Не адаптирован под телефон', h_scroll: 'Горизонтальная прокрутка на телефоне',
  small_text: 'Мелкий текст', old_footer_year: 'Старый год в подвале', slow_load: 'Медленная загрузка',
  broken_links: 'Битые ссылки', no_menu_prices: 'Нет меню и цен', site_down: 'Сайт не открывается'
}

interface Props { d: PlaceDetails; onChanged: () => void; onRemoved: () => void }

export function Venue({ d, onChanged, onRemoved }: Props): React.JSX.Element {
  const [shot, setShot] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    let live = true
    setShot(null)
    window.api.audit.screenshot(d.id).then((s) => { if (live) setShot(s) }).catch(() => undefined)
    return () => { live = false }
  }, [d.id, d.findings])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const run = (fn: () => Promise<void>, ok?: string): void => {
    setMsg(null)
    fn().then(() => { if (ok) setMsg(ok) }).catch((e) => setMsg(errText(e)))
  }
  const recheck = (): void => run(async () => {
    await window.api.audit.run(d.id)
    onChanged()
    // проверка идёт в фоне: обновляем карточку, когда она успеет закончиться
    timers.current.push(window.setTimeout(onChanged, 5000), window.setTimeout(onChanged, 15000))
  }, 'Проверка запущена')
  const google = (): void => run(async () => { await window.api.places.refreshGoogle(d.id); onChanged() }, 'Обновлено из Google')
  const remove = (): void => {
    window.api.places.remove(d.id).then(onRemoved).catch((e) => { setConfirmDel(false); setMsg(errText(e)) })
  }
  const map = `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=18/${d.lat}/${d.lon}`

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section>
        <h3 className="mb-1 font-semibold">Почему {percentLabel(d.score.p * 100)}</h3>
        {GROUPS.map(([g, title]) => {
          const fs = d.score.factors.filter((f) => f.group === g)
          return fs.length === 0 ? null : (
            <div key={g} className="mb-2">
              <p className="text-xs uppercase text-muted">{title}</p>
              <ul>{fs.map((f) => (
                <li key={f.key} className="flex justify-between gap-3 py-0.5">
                  <span>{f.label}</span><span className="font-mono">{signed(f.deltaPp)}</span>
                </li>
              ))}</ul>
            </div>
          )
        })}
      </section>
      <section className="flex flex-col gap-1">
        <p>{WEB_LABEL[d.webClass]}{d.website ? ` · ${d.website}` : ''}</p>
        {d.address && <p>{d.address}</p>}
        {d.phoneE164 && <p className="font-mono">{d.phoneE164}</p>}
        {d.contacts.map((c) => <p key={`${c.kind}${c.value}`} className="text-muted">{c.kind}: {c.value}</p>)}
        <Button variant="ghost" className="mt-1 self-start" onClick={() => window.open(map, '_blank')}>Открыть на карте</Button>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Находки аудита</h3>
        {d.findings.length === 0 && <p className="text-muted">Аудита пока нет.</p>}
        <ul className="list-disc pl-5">{d.findings.map((f) => (
          <li key={f.code}>{FINDING[f.code] ?? f.code}{f.confirmed ? '' : ' (не подтверждено)'}{f.evidence ? ` — ${f.evidence}` : ''}</li>
        ))}</ul>
        {shot && (
          <button type="button" onClick={() => setZoom(true)} aria-label="Скриншот сайта во весь экран" className="cursor-zoom-in self-start">
            <img src={shot} alt="Скриншот сайта" className="max-h-48 rounded-lg border border-line" />
          </button>
        )}
        {d.website && <Button variant="ghost" className="self-start" onClick={recheck}>Проверить ещё раз</Button>}
      </section>
      {d.googlePlaceId && (
        <section className="flex flex-col gap-2">
          <Button variant="ghost" className="self-start" onClick={google}>Обновить из Google</Button>
          <p className="text-xs text-muted">Powered by Google</p>
        </section>
      )}
      {msg && <p role="status" className="text-muted">{msg}</p>}
      <Button variant="ghost" className="self-start text-danger" onClick={() => setConfirmDel(true)}>Удалить навсегда</Button>
      {zoom && shot && <ShotOverlay src={shot} onClose={() => setZoom(false)} />}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(false)} title="Удалить навсегда?">
          <p className="text-sm text-muted">Заведение «{d.name}» исчезнет из базы вместе со всеми данными: контактами, перепиской, заметками, аудитами и скриншотами. Это нельзя отменить.</p>
          <div className="flex gap-2">
            <Button className="!bg-danger" onClick={remove}>Удалить</Button>
            <Button variant="ghost" onClick={() => setConfirmDel(false)}>Отмена</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function useEsc(onClose: () => void): void {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
}

function ShotOverlay({ src, onClose }: { src: string; onClose: () => void }): React.JSX.Element {
  useEsc(onClose)
  return (
    <div data-overlay className="fixed inset-0 z-[60] flex items-center justify-center overflow-auto bg-black/90 p-6" onClick={onClose}>
      <img src={src} alt="Скриншот сайта" className="max-h-full max-w-full" />
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  useEsc(onClose)
  return (
    <div data-overlay className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <h3 className="text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}
