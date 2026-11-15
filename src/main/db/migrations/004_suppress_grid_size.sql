-- «Удалить навсегда»: sha256 идентификаторов удалённых мест ('g:'+google id, 'o:'+osm id, 'p:'+телефон), без открытых ПДн
CREATE TABLE suppressed (hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
-- размер квадрата, по которому построена сетка города; NULL — неизвестен (сетка перестроится при следующем проходе)
ALTER TABLE cities ADD COLUMN size_km REAL;
-- чьё это сгенерированное сообщение: удаляется вместе с местом
ALTER TABLE llm_cache ADD COLUMN place_id INTEGER;
CREATE INDEX idx_llm_cache_place ON llm_cache(place_id);
CREATE INDEX idx_audits_place ON audits(place_id);
CREATE INDEX idx_messages_place ON messages(place_id);
