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
      .select("event, team, data, team_name")
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (error) throw error;

    if (data) {
      await cacheEventTeamData(
        data.map((d) => ({
          event: d.event,
          team: d.team,
          data: d.data,
          team_name: d.team_name,
        })),
      );
    }

    return data;
  } catch (e) {
    console.warn("[Teams] Supabase fetch failed, using local cache:", e);
    return cached;
  }
}
