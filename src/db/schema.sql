-- Legacy tables (ask, prospect, territory, run) came from resources.yaml.
-- Watch tables (0.6.0) are defined here directly. CREATE IF NOT EXISTS only:
-- this file runs on every open against a database that already has data.

CREATE TABLE IF NOT EXISTS ask (
  url            TEXT PRIMARY KEY,
  post_id        TEXT,
  source         TEXT NOT NULL CHECK (source IN ('facebook')),
  author_name    TEXT,
  author_url     TEXT,
  area           TEXT,
  posted_at      TEXT NOT NULL,
  text           TEXT NOT NULL,
  reactions      INTEGER,
  matched_query  TEXT NOT NULL,
  service        TEXT,
  already_tagged INTEGER NOT NULL DEFAULT 0,
  follow_up      TEXT,
  score          REAL NOT NULL DEFAULT 0,
  draft_comment  TEXT,
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','drafted','posted','skipped')),
  touched_at     TEXT,
  found_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ask_status_idx   ON ask (status);
CREATE INDEX IF NOT EXISTS ask_found_at_idx ON ask (found_at);

CREATE TABLE IF NOT EXISTS prospect (
  place_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  category       TEXT,
  building       TEXT,
  website        TEXT,
  phone          TEXT,
  email          TEXT,
  contact_name   TEXT,
  contact_title  TEXT,
  services       TEXT,
  lead_score     REAL,
  excluded       TEXT,
  draft_email    TEXT,
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','drafted','emailed','replied','won','skipped')),
  touched_at     TEXT,
  found_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS prospect_status_idx ON prospect (status);

CREATE TABLE IF NOT EXISTS territory (
  name           TEXT PRIMARY KEY,
  fb_location    TEXT NOT NULL,
  maps_location  TEXT NOT NULL,
  radius_note    TEXT,
  active         INTEGER NOT NULL DEFAULT 0
);

-- Sensible default so the bundle works before Rudy sets anything.
INSERT OR IGNORE INTO territory (name, fb_location, maps_location, radius_note, active)
VALUES ('Spring / Klein', 'Spring, Texas', 'Spring, TX', 'Placeholder — confirm with Rudy', 1);

-- The run ledger. Claude Desktop kills a tool call at ~4 minutes and Apify's
-- run-sync endpoint 408s at 300s, so searches are started and collected later.
CREATE TABLE IF NOT EXISTS run (
  id           TEXT PRIMARY KEY,
  actor        TEXT NOT NULL,
  track        TEXT NOT NULL CHECK (track IN ('asks','commercial')),
  query        TEXT,
  dataset_id   TEXT,
  status       TEXT NOT NULL,
  ingested     INTEGER NOT NULL DEFAULT 0,
  item_count   INTEGER,
  error        TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS run_pending_idx ON run (ingested, started_at);

-- ---------------------------------------------------------------- 0.6.0 watch

CREATE TABLE IF NOT EXISTS profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  business_name    TEXT NOT NULL,
  owner_name       TEXT,
  website          TEXT,
  phone            TEXT,
  page_handle      TEXT,
  service_area     TEXT,
  reply_voice      TEXT,
  nextdoor_enabled INTEGER NOT NULL DEFAULT 1,
  cadence          TEXT NOT NULL DEFAULT '{}',
  signals          TEXT NOT NULL DEFAULT '[]',
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service (
  name     TEXT PRIMARY KEY,
  kind     TEXT NOT NULL CHECK (kind IN ('offered','considering')),
  keywords TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS source_group (
  url           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  privacy       TEXT,
  members       TEXT,
  posts_per_day REAL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS search_term (
  platform TEXT NOT NULL CHECK (platform IN ('facebook','nextdoor')),
  term     TEXT NOT NULL,
  purpose  TEXT NOT NULL CHECK (purpose IN ('lead','signal','competitor','opportunity')),
  PRIMARY KEY (platform, term)
);

CREATE TABLE IF NOT EXISTS competitor (
  name     TEXT PRIMARY KEY,
  page_url TEXT,
  notes    TEXT
);

CREATE TABLE IF NOT EXISTS sweep (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT NOT NULL CHECK (mode IN ('daily','weekly','manual')),
  sources     TEXT NOT NULL DEFAULT '[]',
  since       TEXT NOT NULL,
  searches    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done')),
  posts_seen  INTEGER,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- content_hash is added by the migration in client.js open() for any older
-- database whose finding table predates this column; its index is created
-- there too, only after the column is guaranteed to exist (never here).
CREATE TABLE IF NOT EXISTS finding (
  key          TEXT PRIMARY KEY,
  sweep_id     INTEGER,
  source       TEXT NOT NULL CHECK (source IN ('facebook','nextdoor')),
  place        TEXT,
  author       TEXT,
  excerpt      TEXT NOT NULL,
  link         TEXT,
  posted_at    TEXT,
  posted_label TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('lead','competitor','signal','opportunity','noise')),
  service      TEXT,
  topic        TEXT,
  note         TEXT,
  downgraded   TEXT,
  draft_reply  TEXT,
  content_hash TEXT,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','skipped','won','lost')),
  first_seen   TEXT NOT NULL,
  touched_at   TEXT
);

CREATE INDEX IF NOT EXISTS finding_kind_idx ON finding (kind, first_seen);

CREATE TABLE IF NOT EXISTS report (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sweep_id   INTEGER,
  markdown   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
