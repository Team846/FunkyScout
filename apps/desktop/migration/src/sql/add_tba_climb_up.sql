-- Add tba_match_climb table for caching TBA score breakdown climb data
-- Desktop-only table, not synced to Supabase

CREATE TABLE IF NOT EXISTS tba_match_climb (
    event TEXT NOT NULL,
    match_key TEXT NOT NULL,
    team TEXT NOT NULL,
    auto_climb TEXT,      -- "L1", "L2", "L3", or NULL
    teleop_climb TEXT,    -- "L1", "L2", "L3", or NULL
    PRIMARY KEY (event, match_key, team)
);
