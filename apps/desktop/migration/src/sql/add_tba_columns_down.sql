-- Rollback: Remove TBA match data columns from event_schedule

-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
-- This is the rollback script (rarely needed in development)

PRAGMA foreign_keys=off;

-- Create temp table with original schema
CREATE TABLE event_schedule_backup (
    event TEXT NOT NULL,
    match TEXT NOT NULL,
    team TEXT NOT NULL,
    alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
    name TEXT,
    uid TEXT,
    last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at INTEGER,
    inflight BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (event, match, team),
    FOREIGN KEY (event) REFERENCES event_list(event)
);

-- Copy data (without TBA columns)
INSERT INTO event_schedule_backup (event, match, team, alliance, name, uid, last_modified, deleted_at, inflight)
SELECT event, match, team, alliance, name, uid, last_modified, deleted_at, inflight
FROM event_schedule;

-- Drop old table
DROP TABLE event_schedule;

-- Rename backup to original
ALTER TABLE event_schedule_backup RENAME TO event_schedule;

-- Recreate indexes
CREATE INDEX idx_event_schedule_event ON event_schedule (event);
CREATE INDEX idx_event_schedule_match ON event_schedule (event, match);
CREATE INDEX idx_event_schedule_scouter ON event_schedule (event, name);

-- Recreate trigger
CREATE TRIGGER upd_time_event_schedule AFTER UPDATE ON event_schedule
FOR EACH ROW
BEGIN
    UPDATE event_schedule SET last_modified = strftime('%s','now') * 1000
    WHERE event=OLD.event AND match=OLD.match AND team=OLD.team;
END;

PRAGMA foreign_keys=on;
