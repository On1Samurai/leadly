CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  bbox TEXT NOT NULL,
  polygon TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  ix INTEGER NOT NULL,
  iy INTEGER NOT NULL,
  bbox TEXT NOT NULL,
  osm_count INTEGER NOT NULL DEFAULT 0,
  google_yield REAL,
  last_google_at INTEGER
);

CREATE TABLE passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  category TEXT NOT NULL,
  mode TEXT NOT NULL,
  budget INTEGER NOT NULL DEFAULT 0,
  google_used INTEGER NOT NULL DEFAULT 0,
  cells_done INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  dup_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE pass_cells (
  pass_id INTEGER NOT NULL REFERENCES passes(id),
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  state TEXT NOT NULL,
  new_count INTEGER NOT NULL DEFAULT 0,
  dup_count INTEGER NOT NULL DEFAULT 0,
  google_requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pass_id, cell_id)
);

CREATE TABLE places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  address TEXT,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  cell_id INTEGER REFERENCES cells(id),
  phone_e164 TEXT,
  phone_type TEXT NOT NULL DEFAULT 'unknown',
  website TEXT,
  web_class TEXT NOT NULL DEFAULT 'none',
  rating REAL,
  reviews INTEGER,
  google_place_id TEXT,
  osm_id TEXT,
  google_fetched_at INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  in_base INTEGER NOT NULL DEFAULT 0,
  remind_at INTEGER,
  score REAL NOT NULL DEFAULT 0,
  score_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_places_lat_lon ON places(lat, lon);
CREATE INDEX idx_places_phone ON places(phone_e164);
CREATE UNIQUE INDEX idx_places_google ON places(google_place_id);
CREATE UNIQUE INDEX idx_places_osm ON places(osm_id);

CREATE TABLE contacts (
  place_id INTEGER NOT NULL REFERENCES places(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (place_id, kind, value)
);

CREATE TABLE audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id),
  url TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  findings TEXT NOT NULL DEFAULT '[]',
  screenshot TEXT,
  error TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id),
  direction TEXT NOT NULL,
  channel TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE status_log (
  place_id INTEGER NOT NULL REFERENCES places(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_status_log_place ON status_log(place_id);

CREATE TABLE llm_cache (key TEXT PRIMARY KEY, response TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE daily (date TEXT PRIMARY KEY, links_opened INTEGER NOT NULL DEFAULT 0, goal INTEGER);
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  payload TEXT,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE osm_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL);
