import type { Place } from '../../../shared/types'
import type { Db } from '../../db/db'
import { formatOsmHours } from '../../core/osm-hours'
import type { SourceData } from './google'

// shortcut: гибрид C, при переходе на A удалить free.ts и ветку в service.build
export function freeDemo(db: Db, place: Place, lang: 'ru' | 'uk'): SourceData {
  const raw = place.osmHours ?? (db.prepare('SELECT osm_hours AS h FROM places WHERE id=?').get(place.id) as { h: string | null } | undefined)?.h
  return {
    hours: raw ? formatOsmHours(raw, lang) : [], reviews: [], photos: [], summary: null,
    rating: place.rating, reviewsCount: place.reviews, mapsUrl: null, fromGoogle: false
  }
}
