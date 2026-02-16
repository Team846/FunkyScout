import supabase from "../supabase/supabase";
import { getEventTeamData, cacheEventTeamData } from "../db";

/**
 * Get all teams for an event with local cache fallback.
 */
export async function getTeams(eventKey: string) {
  const cached = await getEventTeamData(eventKey);

  if (!navigator.onLine) {
    // Transform EventTeamData to the format expected by consumption (context)
    return cached.map((c) => ({
      event: c.event,
      team: c.team,
      data: c.data,
      team_name: c.team_name,
      rank: 0, // Rank comes from TBA cache separately in context
    }));
  }

  try {
    const { data, error } = await supabase
      .from("event_team_data")
      .select("event, team, data, team_name, name, uid, assigned, timestamp, last_modified, deleted_at")
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (error) throw error;

    if (data) {
      await cacheEventTeamData(
        eventKey,
        data.map((d) => ({
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
        })),
      );
    }

    return data;
  } catch (e) {
    console.warn("[Teams] Supabase fetch failed, using local cache:", e);
    return cached;
  }
}
