-- Safe JSONB-merge upsert for event_team_data.
--
-- WHY THIS EXISTS:
-- The previous approach fetched existing rows in Rust, merged in application code,
-- then upserted the merged result. If the SELECT returned an empty array for any
-- reason (JWT expiry, transient auth issue, serde_json parse failure via
-- unwrap_or_default), the merge produced {} for every team and the upsert
-- silently wiped all pit scouting data from the `data` column.
--
-- This function moves the merge to the database using PostgreSQL's JSONB ||
-- operator, which concatenates two JSONB objects (right-side keys win on
-- collision, left-side keys not present on the right are preserved).
-- No matter what the Rust caller sends, existing pit scouting keys
-- (movement, intake, fuel, autoClimb, teleopClimb, images, autos, priority, …)
-- survive as long as the incoming `data` payload does not contain those keys.
-- TBA/Statbotics keys (epa, opr, rank, record, …) are always in the incoming
-- payload and thus get updated as expected.
--
-- NULL SAFETY:
-- PostgreSQL's || operator returns NULL if either operand is NULL.
-- COALESCE is applied to BOTH sides so a null `data` in the incoming record
-- (missing key, explicit null, serde edge case) is treated as {} rather than
-- wiping the existing column value.

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
    last_modified = now();
END;
$$;

-- Grant execute to authenticated role (the JWT the desktop uses)
GRANT EXECUTE ON FUNCTION merge_team_data_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION merge_team_data_batch(jsonb) TO service_role;
