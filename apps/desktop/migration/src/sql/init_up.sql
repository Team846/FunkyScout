PRAGMA journal_mode = WAL;

-- ============================================================================
-- Desktop SQLite Schema - Matches Supabase Schema
-- ============================================================================
-- Key differences from Supabase:
-- - SQLite uses INTEGER for timestamps (epoch milliseconds)
-- - Supabase uses timestamp with time zone (strings)
-- - Desktop converts timestamps when syncing to/from Supabase
-- - Added 'inflight' flag for desktop sync queue
-- ============================================================================

-- event_list
-- Stores event metadata
CREATE TABLE event_list (
    event TEXT PRIMARY KEY NOT NULL,
    alias TEXT NOT NULL,
    date TEXT NOT NULL,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TRIGGER upd_time_event_list AFTER UPDATE ON event_list
FOR EACH ROW
BEGIN
    UPDATE event_list SET last_modified = strftime('%s','now') * 1000 WHERE event=OLD.event;
END;

-- event_team_data
-- Stores pit scouting data for teams at events
CREATE TABLE event_team_data (
    event TEXT NOT NULL,
    team TEXT NOT NULL,
    data TEXT, -- JSON string (pit scouting data)
    team_name TEXT,
    name TEXT, -- scouter name who submitted pit data
    uid TEXT, -- scouter uuid
    assigned TEXT, -- assigned scouter uuid
    timestamp INTEGER,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, team),
    FOREIGN KEY (event) REFERENCES event_list(event)
);

CREATE INDEX idx_event_team_data_event ON event_team_data (event);

CREATE TRIGGER upd_time_event_team_data AFTER UPDATE ON event_team_data
FOR EACH ROW
BEGIN
    UPDATE event_team_data SET last_modified = strftime('%s','now') * 1000
    WHERE event=OLD.event AND team=OLD.team;
END;

-- event_schedule
-- Stores match schedule - one row per team per match
CREATE TABLE event_schedule (
    event TEXT NOT NULL,
    match TEXT NOT NULL,
    team TEXT NOT NULL,
    alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
    name TEXT, -- assigned scouter name
    uid TEXT, -- assigned scouter uuid
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, match, team),
    FOREIGN KEY (event) REFERENCES event_list(event)
);

CREATE INDEX idx_event_schedule_event ON event_schedule (event);
CREATE INDEX idx_event_schedule_match ON event_schedule (event, match);
CREATE INDEX idx_event_schedule_scouter ON event_schedule (event, name);

CREATE TRIGGER upd_time_event_schedule AFTER UPDATE ON event_schedule
FOR EACH ROW
BEGIN
    UPDATE event_schedule SET last_modified = strftime('%s','now') * 1000
    WHERE event=OLD.event AND match=OLD.match AND team=OLD.team;
END;

-- event_match_data
-- Stores match scouting data
CREATE TABLE event_match_data (
    event TEXT NOT NULL,
    match TEXT NOT NULL,
    team TEXT NOT NULL,
    alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
    data_raw TEXT, -- JSON string (raw scouting input) - PRIMARY DATA
    data TEXT, -- JSON string (UNUSED - kept for compatibility)
    name TEXT, -- scouter name
    uid TEXT, -- scouter uuid
    timestamp INTEGER,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, match, team),
    FOREIGN KEY (event) REFERENCES event_list(event)
);

CREATE INDEX idx_event_match_data_event ON event_match_data (event);
CREATE INDEX idx_event_match_data_match ON event_match_data (event, match);

CREATE TRIGGER upd_time_event_match_data AFTER UPDATE ON event_match_data
FOR EACH ROW
BEGIN
    UPDATE event_match_data SET last_modified = strftime('%s','now') * 1000
    WHERE event=OLD.event AND match=OLD.match AND team=OLD.team;
END;

-- event_picklist
-- Each row is one picklist for an event
CREATE TABLE event_picklist (
    id TEXT PRIMARY KEY NOT NULL,
    event TEXT NOT NULL,
    title TEXT NOT NULL,
    picklist TEXT, -- JSON string (DEPRECATED - use event_picklist_entries)
    uname TEXT NOT NULL, -- creator username
    uid TEXT NOT NULL, -- creator uuid
    type TEXT NOT NULL CHECK (type IN ('public', 'default', 'private')),
    timestamp INTEGER NOT NULL,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (event) REFERENCES event_list(event)
);

CREATE INDEX idx_event_picklist_event ON event_picklist (event);
CREATE INDEX idx_event_picklist_creator ON event_picklist (event, uid);

CREATE TRIGGER upd_time_event_picklist AFTER UPDATE ON event_picklist
FOR EACH ROW
BEGIN
    UPDATE event_picklist SET last_modified = strftime('%s','now') * 1000 WHERE id=OLD.id;
END;

-- event_picklist_entries
-- Each row is one team's position in a picklist
CREATE TABLE event_picklist_entries (
    event TEXT NOT NULL,
    id TEXT NOT NULL, -- FK to event_picklist.id
    team TEXT NOT NULL,
    rank INTEGER NOT NULL,
    flags TEXT, -- JSON string (custom flags)
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, id, team),
    FOREIGN KEY (event) REFERENCES event_list(event),
    FOREIGN KEY (id) REFERENCES event_picklist(id)
);

CREATE INDEX idx_event_picklist_entries_picklist ON event_picklist_entries (event, id);

CREATE TRIGGER upd_time_event_picklist_entries AFTER UPDATE ON event_picklist_entries
FOR EACH ROW
BEGIN
    UPDATE event_picklist_entries SET last_modified = strftime('%s','now') * 1000
    WHERE event=OLD.event AND id=OLD.id AND team=OLD.team;
END;

-- user_profiles
-- User profile data
CREATE TABLE user_profiles (
    uid TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'scouter', 'lead')),
    settings TEXT NOT NULL DEFAULT '{}', -- JSON string
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TRIGGER upd_time_user_profiles AFTER UPDATE ON user_profiles
FOR EACH ROW
BEGIN
    UPDATE user_profiles SET last_modified = strftime('%s','now') * 1000 WHERE uid=OLD.uid;
END;

-- user_roles
-- Maps roles to permissions
CREATE TABLE user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'scouter', 'lead')),
    permission TEXT NOT NULL
);

-- invite_codes
-- Invite codes for user promotion
CREATE TABLE invite_codes (
    code TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('promote.scouter', 'promote.admin')),
    expiry INTEGER NOT NULL, -- epoch milliseconds
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER
);

-- ============================================================================
-- External API Cache (Desktop-specific)
-- ============================================================================
-- Stores cached responses from TBA, Nexus, Statbotics
-- Used to reduce external API calls

CREATE TABLE external_cache (
    source TEXT NOT NULL, -- 'tba', 'nexus', 'statbotics'
    endpoint TEXT NOT NULL, -- API endpoint path
    data TEXT NOT NULL, -- JSON response
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (source, endpoint)
);

CREATE TRIGGER upd_time_external_cache AFTER UPDATE ON external_cache
FOR EACH ROW
BEGIN
    UPDATE external_cache SET last_modified = strftime('%s','now') * 1000
    WHERE source=OLD.source AND endpoint=OLD.endpoint;
END;
