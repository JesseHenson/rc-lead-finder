-- Generated from resources.yaml -> resources[].fields
-- Do not edit. Change resources.yaml and rewrite this file.

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
