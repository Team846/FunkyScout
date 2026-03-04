-- Batch shift assignment patch as a single atomic UPDATE.
-- Replaces N sequential HTTP PATCH requests (one per row) with a single
-- set-based UPDATE joined against a JSONB array, completing in one round-trip.
--
-- Same number of postgres_changes events fire (one per changed row), but they
-- arrive atomically — mobile's 2s realtime debounce catches them all in one
-- batch instead of being re-triggered across 10+ seconds of trickling updates.

CREATE OR REPLACE FUNCTION patch_shift_assignments_batch(
    p_event       text,
    p_assignments jsonb  -- array of {match, team, uid, name}
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE event_schedule es
    SET
        uid           = (a->>'uid')::uuid,
        name          = (a->>'name'),
        last_modified = now()
    FROM jsonb_array_elements(p_assignments) AS a
    WHERE
        es.event = p_event
        AND es.match = (a->>'match')
        AND es.team  = (a->>'team');
$$;

-- Allow authenticated users (desktop app) to call this function.
GRANT EXECUTE ON FUNCTION patch_shift_assignments_batch(text, jsonb) TO authenticated;
