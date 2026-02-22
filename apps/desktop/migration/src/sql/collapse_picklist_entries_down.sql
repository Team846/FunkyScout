-- Recreate the empty entries table for rollback (no data restoration possible)
CREATE TABLE IF NOT EXISTS event_picklist_entries (
    event TEXT NOT NULL,
    id TEXT NOT NULL,
    team TEXT NOT NULL,
    rank INTEGER NOT NULL,
    flags TEXT,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, id, team),
    FOREIGN KEY (event) REFERENCES event_list(event),
    FOREIGN KEY (id) REFERENCES event_picklist(id)
);
