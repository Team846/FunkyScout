-- Add unique constraint to event_match_data table (safe - only if not exists)
-- One entry per team per match - editable by any scouter

DO $$
BEGIN
    -- Drop old constraint if it exists (from previous version)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_match_data_unique'
    ) THEN
        ALTER TABLE event_match_data
        DROP CONSTRAINT event_match_data_unique;
    END IF;

    -- Add correct constraint: one entry per (event, match, team)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_match_data_unique_v2'
    ) THEN
        ALTER TABLE event_match_data
        ADD CONSTRAINT event_match_data_unique_v2
        UNIQUE (event, match, team);
    END IF;
END $$;
