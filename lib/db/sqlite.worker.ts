/// <reference lib="webworker" />
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let db: any = null;

function mustDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

function execAll(sql: string, bind: any[] = []) {
  const database = mustDb();
  const rows: any[] = [];
  database.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row: any) => rows.push(row),
  });
  return rows;
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  const reply = (msg: any) => (self as any).postMessage({ id, ...msg });

  try {
    if (type === "init") {
      const sqlite3 = await sqlite3InitModule({
        print: () => {},
        printErr: console.error,
      });

      // In a worker, OPFS becomes possible (still may require crossOriginIsolated).
      if (sqlite3.oo1.OpfsDb) {
        db = new sqlite3.oo1.OpfsDb("/strata.db");
        console.log("[LocalDB] Worker using OPFS");
      } else {
        // fallback if OpfsDb not present
        db = new sqlite3.oo1.DB("file:local?vfs=kvvfs", "c");
        console.log("[LocalDB] Worker using kvvfs localStorage fallback");
      }

      // Create tables (same schema you already have)
      db.exec(`
-- =========================
-- SUPABASE-MIRROR TABLES
-- =========================

CREATE TABLE IF NOT EXISTS event_team_data (
  event TEXT NOT NULL,
  team TEXT NOT NULL,

  data TEXT,              -- JSON
  team_name TEXT,
  name TEXT,
  uid TEXT,
  assigned TEXT,
  timestamp INTEGER,
  last_modified INTEGER,
  deleted_at INTEGER,

  PRIMARY KEY (event, team)
);

CREATE INDEX IF NOT EXISTS idx_event_team_data_event
  ON event_team_data(event);

CREATE TABLE IF NOT EXISTS event_list (
  event TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  date TEXT NOT NULL,
  deleted_at INTEGER
);


CREATE TABLE IF NOT EXISTS event_schedule (
  event TEXT NOT NULL,
  match TEXT NOT NULL,
  team TEXT NOT NULL,
  alliance TEXT NOT NULL, -- "red" | "blue"

  name TEXT,
  uid TEXT,
  last_modified INTEGER,
  deleted_at INTEGER,

  -- Match data synced from desktop
  est_time INTEGER,
  red_score INTEGER,
  blue_score INTEGER,
  red_win_prob REAL,
  predicted_red_score INTEGER,
  predicted_blue_score INTEGER,

  PRIMARY KEY (event, match, team)
);

CREATE INDEX IF NOT EXISTS idx_event_schedule_event
  ON event_schedule(event);

CREATE INDEX IF NOT EXISTS idx_event_schedule_match
  ON event_schedule(event, match);

CREATE INDEX IF NOT EXISTS idx_event_schedule_team
  ON event_schedule(event, team);
`);

      // Migration: Add columns to existing event_schedule tables
      // These columns were added for TBA match data and Statbotics predictions
      const scheduleColumns = [
        'est_time INTEGER',
        'red_score INTEGER',
        'blue_score INTEGER',
        'red_win_prob REAL',
        'predicted_red_score INTEGER',
        'predicted_blue_score INTEGER',
      ];

      for (const column of scheduleColumns) {
        try {
          db.exec(`ALTER TABLE event_schedule ADD COLUMN ${column}`);
        } catch (e: any) {
          // Ignore "duplicate column" errors - column already exists
          if (!e.message?.includes('duplicate column')) {
            console.warn(`[LocalDB] Migration warning for ${column}:`, e.message);
          }
        }
      }

      db.exec(`
CREATE TABLE IF NOT EXISTS event_match_data (
  event TEXT NOT NULL,
  match TEXT NOT NULL,
  team TEXT NOT NULL,

  alliance TEXT,
  data_raw TEXT,          -- JSON
  data TEXT,              -- JSON
  name TEXT,

  uid TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  last_modified INTEGER,
  deleted_at INTEGER,

  PRIMARY KEY (event, match, team, uid, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_event_match_data_lookup
  ON event_match_data(event, match, team);


CREATE TABLE IF NOT EXISTS event_picklist (
  id TEXT PRIMARY KEY,    -- Supabase UUID
  event TEXT NOT NULL,

  title TEXT,
  picklist TEXT,          -- JSON
  uname TEXT,
  uid TEXT,
  type TEXT,
  timestamp INTEGER,
  last_modified INTEGER,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_event_picklist_event
  ON event_picklist(event);


CREATE TABLE IF NOT EXISTS event_picklist_entries (
  event TEXT NOT NULL,
  id TEXT NOT NULL,
  team TEXT NOT NULL,

  rank INTEGER,
  flags TEXT,             -- JSON
  last_modified INTEGER,
  deleted_at INTEGER,

  PRIMARY KEY (event, id, team)
);

CREATE INDEX IF NOT EXISTS idx_picklist_entries_event_id
  ON event_picklist_entries(event, id);

-- =========================
-- TBA CACHE TABLES
-- =========================

CREATE TABLE IF NOT EXISTS tba_event_teams (
  event TEXT NOT NULL,
  team_key TEXT NOT NULL,     -- "frc846"
  team_number INTEGER NOT NULL,
  name TEXT,

  rank INTEGER,
  wins INTEGER,
  losses INTEGER,
  ties INTEGER,
  next_match TEXT,
  last_match TEXT,

  last_synced INTEGER,

  PRIMARY KEY (event, team_key)
);

CREATE TABLE IF NOT EXISTS tba_event_matches (
  event TEXT NOT NULL,
  match_key TEXT NOT NULL,    -- "2025cacc_qm1"

  comp_level TEXT,
  match_number INTEGER,
  est_time INTEGER,

  red_teams TEXT,             -- JSON array
  blue_teams TEXT,            -- JSON array
  red_score INTEGER,
  blue_score INTEGER,

  last_synced INTEGER,

  PRIMARY KEY (event, match_key)
);

CREATE INDEX IF NOT EXISTS idx_tba_matches_event_time
  ON tba_event_matches(event, est_time);

-- =========================
-- STATBOTICS CACHE TABLES
-- =========================

CREATE TABLE IF NOT EXISTS statbotics_event_team_epa (
  event TEXT NOT NULL,
  team TEXT NOT NULL,
  epa TEXT NOT NULL,          -- JSON
  last_synced INTEGER,
  PRIMARY KEY (event, team)
);

CREATE TABLE IF NOT EXISTS statbotics_event_match_pred (
  event TEXT NOT NULL,
  match TEXT NOT NULL,
  pred TEXT NOT NULL,         -- JSON
  last_synced INTEGER,
  PRIMARY KEY (event, match)
);

-- =========================
-- SYNC QUEUE
-- =========================

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,      -- JSON
  created_at INTEGER DEFAULT (strftime('%s','now')),
  retries INTEGER DEFAULT 0,
  last_error TEXT
);



CREATE INDEX IF NOT EXISTS idx_sync_queue_created
  ON sync_queue(created_at);
      `);

      reply({ ok: true });
      return;
    }

    if (type === "exec") {
      const { sql, bind } = payload;
      const rows = execAll(sql, bind ?? []);
      reply({ ok: true, rows });
      return;
    }

    throw new Error(`Unknown message type: ${type}`);
  } catch (err: any) {
    reply({ ok: false, error: String(err?.message ?? err) });
  }
};
