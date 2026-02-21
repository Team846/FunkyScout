import supabase from "../supabase/supabase";
import { getEventTeamData, cacheEventTeamData, upsertEventTeamDataRows } from "../db";

const teamSyncKey = (event: string) => `lastTeamSync_${event}`;

/**
 * Get all teams for an event with incremental sync.
 *
 * First sync: full load (all rows, filtered to non-deleted).
 * Subsequent syncs: incremental (only rows modified since last sync).
 * Always returns the full local cache so the caller gets a complete data set.
 */
export async function getTeams(eventKey: string) {
  const lastSyncStr = localStorage.getItem(teamSyncKey(eventKey));
  const isIncremental = !!lastSyncStr;
  const cutoffISO = isIncremental
    ? new Date(new Date(lastSyncStr!).getTime() - 60_000).toISOString()
    : null;

  if (!navigator.onLine) {
    return getEventTeamData(eventKey);
  }

  try {
    let query = supabase
      .from("event_team_data")
      .select("event, team, data, team_name, name, uid, assigned, timestamp, last_modified, deleted_at")
      .eq("event", eventKey);

    if (isIncremental) {
      // Include soft-deleted rows so deletions propagate to local cache
      query = query.gte("last_modified", cutoffISO!);
    } else {
      query = query.is("deleted_at", null);
    }

    const { data, error } = await query;
    if (error) throw error;

    const converted = (data || []).map((d: any) => ({
      event: d.event,
      team: d.team,
      data: d.data,
      team_name: d.team_name,
      name: d.name,
      uid: d.uid,
      assigned: d.assigned,
      timestamp: d.timestamp ? new Date(d.timestamp).getTime() : undefined,
      last_modified: d.last_modified ? new Date(d.last_modified).getTime() : undefined,
      deleted_at: d.deleted_at ? new Date(d.deleted_at).getTime() : undefined,
    }));

    if (converted.length > 0) {
      if (isIncremental) {
        await upsertEventTeamDataRows(eventKey, converted);
        console.log(`[Teams] Incremental: ${converted.length} team(s) updated`);
      } else {
        await cacheEventTeamData(eventKey, converted);
        console.log(`[Teams] Full load: ${converted.length} teams cached`);
      }
    } else if (isIncremental) {
      console.log("[Teams] Incremental: no changes since last sync");
    }

    localStorage.setItem(teamSyncKey(eventKey), new Date().toISOString());

    // Always return full cached list so caller gets the complete data set
    return getEventTeamData(eventKey);
  } catch (e) {
    console.warn("[Teams] Supabase fetch failed, using local cache:", e);
    return getEventTeamData(eventKey);
  }
}
