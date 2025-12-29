PRAGMA journal_mode = WAL;

-- event list --

CREATE TABLE event_list (
    event_year INTEGER NOT NULL,
    event_code TEXT NOT NULL,
    alias TEXT NOT NULL,
    date TEXT NOT NULL,
    PRIMARY KEY (event_year, event_code)
);

-- team list --

CREATE TABLE team_list (
    event_year INTEGER NOT NULL,
    event_code TEXT NOT NULL,
    team_key TEXT NOT NULL,
    assigned_user_id TEXT NOT NULL,
    PRIMARY KEY (event_year, event_code, team_key)
);

-- team data --

CREATE TABLE team_data (
    id INTEGER PRIMARY KEY NOT NULL,
    event_year INTEGER NOT NULL,
    event_code TEXT NOT NULL,
    team_key TEXT NOT NULL,
    data TEXT NOT NULL,
    user_id TEXT NOT NULL,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (event_year, event_code, team_key)
        REFERENCES team_list (event_year, event_code, team_key)
);

CREATE INDEX idx_event_team
ON team_data (event_year, event_code, team_key);

CREATE TRIGGER upd_time_team_data AFTER UPDATE
ON team_data
FOR EACH ROW
BEGIN
    UPDATE team_data SET last_modified = CURRENT_TIMESTAMP WHERE id=OLD.id;
END;

-- event schedule --

CREATE TABLE match_list (
    event_year INTEGER NOT NULL,
    event_code TEXT NOT NULL,
    team_key TEXT NOT NULL,
    match_key TEXT NOT NULL,
    assigned_user_id TEXT NOT NULL,
    PRIMARY KEY (event_year, event_code, team_key, match_key)
);

-- scouting data --

CREATE TABLE match_data (
    id INTEGER PRIMARY KEY NOT NULL,
    event_year INTEGER NOT NULL,
    event_code TEXT NOT NULL,
    team_key TEXT NOT NULL,
    match_key TEXT NOT NULL,
    data TEXT NOT NULL,
    user_id TEXT NOT NULL,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (event_year, event_code)
        REFERENCES event_list(event_year, event_code),
    UNIQUE (event_year, event_code, team_key, match_key, user_id)
);

CREATE INDEX idx_event_team_match
ON match_data (event_year, event_code, team_key, match_key);

CREATE TRIGGER upd_time_match_data AFTER UPDATE
ON match_data
FOR EACH ROW
BEGIN
    UPDATE match_data SET last_modified = CURRENT_TIMESTAMP WHERE id=OLD.id;
END;

-- External SWR Cache --

CREATE TABLE external_store (
    source_type TEXT NOT NULL,
    request TEXT NOT NULL,
    data TEXT NOT NULL,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (source_type, request)
);

CREATE TRIGGER upd_time_external_store AFTER UPDATE
ON external_store
FOR EACH ROW
BEGIN
  UPDATE external_store SET last_modified = CURRENT_TIMESTAMP
  WHERE request=OLD.request AND source_type=OLD.source_type;
END;

-- Data sources --

CREATE TABLE source_list (
    source_url TEXT PRIMARY KEY NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL
);

-- Exclusions --

CREATE TABLE exclusions (
    id TEXT PRIMARY KEY NOT NULL,
    exclusion_type TEXT NOT NULL,
    exclusion_data TEXT NOT NULL
)

