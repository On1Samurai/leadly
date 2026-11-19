import type { DemoKind } from './demo/types'
export type WebClass = 'none' | 'social' | 'template' | 'own';
export type PhoneType = 'mobile' | 'fixed' | 'unknown';
export type Status = 'new' | 'written' | 'replied' | 'demo_opened' | 'call' | 'deal' | 'refused' | 'later';
export type Channel = 'telegram' | 'whatsapp' | 'viber' | 'instagram' | 'vk' | 'max' | 'call' | 'sms';
export type ContactKind = Channel | 'email';
export interface BBox { south: number; west: number; north: number; east: number }
export interface Contact { kind: ContactKind; value: string }
export interface RawPlace {
  source: 'osm' | 'google'; sourceId: string; name: string; lat: number; lon: number;
  address?: string; phones: string[]; website?: string; rating?: number; reviews?: number; hours?: string;
  contacts: Contact[];
}
export interface Place {
  id: number; name: string; category: string; lat: number; lon: number; address: string | null;
  cityId: number; cellId: number | null; phoneE164: string | null; phoneType: PhoneType;
  website: string | null; webClass: WebClass; rating: number | null; reviews: number | null;
  googlePlaceId: string | null; osmId: string | null; googleFetchedAt: number | null;
  status: Status; inBase: boolean; remindAt: number | null; score: number; scoreReason: string; createdAt: number; dealAmount: number | null; osmHours?: string | null;
}
export type FindingCode = 'no_https' | 'cert_invalid' | 'cert_expiring' | 'cms' | 'no_viewport' | 'h_scroll'
  | 'small_text' | 'old_footer_year' | 'slow_load' | 'broken_links' | 'no_menu_prices' | 'site_down';
export interface Finding { code: FindingCode; confirmed: boolean; evidence: string }
/**
 * osm: список альтернатив (OR); внутри альтернативы все теги должны совпасть (AND).
 * Значение "*" значит «ключ существует».
 * menu: true, если у категории бывает меню/прайс (проверка `no_menu_prices`).
 */
export interface Category {
  id: string; title: string; osm: Record<string, string>[]; googleType?: string;
  query: Record<'ru' | 'uk', string>; menu?: boolean; demoKind?: DemoKind;
}
