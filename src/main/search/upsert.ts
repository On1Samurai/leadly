import type { Db } from '../db/db'
import { addContacts, candidatesByKeys, candidatesNear, getPlace, insertPlace, updatePlace, type Candidate } from '../db/repo'
import { findDuplicate, mergePatch } from '../core/dedup'
import { contactFromUrl } from '../core/links'
import { parsePhone, splitPhones } from '../core/phones'
import { classifyWeb } from '../core/webclass'
import type { Contact, Place, RawPlace } from '../../shared/types'

export interface UpsertCtx { country: string; cityId: number; cellId: number | null; categoryId: string; now: number }

export function upsertRaw(db: Db, raw: RawPlace, ctx: UpsertCtx): 'new' | 'dup' {
  const phones = raw.phones.flatMap(splitPhones).map((x) => parsePhone(x, ctx.country)).filter((x) => x !== null)
  const first = phones[0] ?? null
  const contacts: Contact[] = [...raw.contacts, ...phones.slice(1).map((p) => ({ kind: 'call' as const, value: p.e164 }))]
  const webClass = classifyWeb(raw.website)
  if (raw.website && webClass === 'social') {
    const c = contactFromUrl(raw.website)
    if (c) contacts.push(c)
  }
  const googlePlaceId = raw.source === 'google' ? raw.sourceId : undefined
  const osmId = raw.source === 'osm' ? raw.sourceId : undefined

  const cands = new Map<number, Candidate>()
  for (const c of [
    ...candidatesByKeys(db, { googlePlaceId, osmId, phoneE164: first?.e164 }),
    ...candidatesNear(db, raw.lat, raw.lon, 100)
  ]) cands.set(c.id, c)
  const dupId = findDuplicate(
    { googlePlaceId, osmId, phoneE164: first?.e164, name: raw.name, lat: raw.lat, lon: raw.lon }, [...cands.values()]
  )

  const inc: Partial<Place> = {
    name: raw.name, category: ctx.categoryId, address: raw.address ?? null, cellId: ctx.cellId,
    phoneE164: first?.e164 ?? null, phoneType: first?.type ?? 'unknown', website: raw.website ?? null, webClass,
    rating: raw.rating ?? null, reviews: raw.reviews ?? null,
    googlePlaceId: googlePlaceId ?? null, osmId: osmId ?? null,
    googleFetchedAt: raw.source === 'google' ? ctx.now : null
  }

  if (dupId !== null) {
    const old = getPlace(db, dupId)!
    const patch = mergePatch(old, inc)
    if ('website' in patch) patch.webClass = classifyWeb(patch.website ?? undefined)
    updatePlace(db, dupId, patch)
    addContacts(db, dupId, contacts)
    return 'dup'
  }
  const id = insertPlace(db, {
    name: raw.name, category: ctx.categoryId, lat: raw.lat, lon: raw.lon, address: inc.address!, cityId: ctx.cityId,
    cellId: ctx.cellId, phoneE164: inc.phoneE164!, phoneType: inc.phoneType!, website: inc.website!, webClass,
    rating: inc.rating!, reviews: inc.reviews!, googlePlaceId: inc.googlePlaceId!, osmId: inc.osmId!,
    googleFetchedAt: inc.googleFetchedAt!, status: 'new', inBase: false, remindAt: null, score: 0, scoreReason: '',
    createdAt: ctx.now, dealAmount: null
  })
  addContacts(db, id, contacts)
  return 'new'
}
