-- Add change detection to merge_team_data_batch.
--
-- PROBLEM:
-- The previous version always ran `last_modified = now()` on every row,
-- even when the incoming TBA/Statbotics data was identical to what was
-- already stored. This meant:
--   1. All 29 team rows got `last_modified` bumped every 120s desktop sync.
--   2. Mobile's incremental sync (gte last_modified) re-fetched all 29 rows
--      every 5-min poll — downloading large JSONB blobs with no actual changes.
--   3. 29 postgres_changes realtime events fired every 120s for subscribers.
--
-- FIX:
-- Add a WHERE clause to the DO UPDATE so the update (and postgres_changes event)
-- is skipped entirely when the merged data equals what's already stored.
-- Only rows where EPA, OPR, rank, or team_name actually changed get updated.

CREATE OR REPLACE FUNCTION merge_team_data_batch(records jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO event_team_data (event, team, team_name, data, last_modified)
  SELECT
    (r->>'event')::text,
    (r->>'team')::text,
    (r->>'team_name')::text,
    COALESCE((r->'data')::jsonb, '{}'::jsonb),
    now()
  FROM jsonb_array_elements(records) AS r
  ON CONFLICT (event, team) DO UPDATE SET
    team_name     = COALESCE(EXCLUDED.team_name, event_team_data.team_name),
    -- Both sides COALESCEd: if either is null treat as {} so || never returns null.
    -- Pit scouting keys are never in the TBA payload → always survive.
    data          = COALESCE(event_team_data.data, '{}'::jsonb)
                 || COALESCE(EXCLUDED.data, '{}'::jsonb),
    last_modified = now()
  -- Only execute the UPDATE (and fire a postgres_changes event) when something
  -- actually changed. When the merged data equals the existing data and team_name
  -- is unchanged, the conflict is detected but the UPDATE is skipped entirely.
  WHERE
    (COALESCE(event_team_data.data, '{}'::jsonb) || COALESCE(EXCLUDED.data, '{}'::jsonb))
        IS DISTINCT FROM COALESCE(event_team_data.data, '{}'::jsonb)
    OR COALESCE(EXCLUDED.team_name, event_team_data.team_name)
        IS DISTINCT FROM event_team_data.team_name;
END;
$$;
