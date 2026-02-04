import supabase from "../supabase/supabase";
import { fetchTBAEventTeams } from "../tba/event";

/**
 * Get all teams for an event from Supabase, enriched with rank data from TBA.
 */
export async function getTeams(eventKey: string) {
  const { data, error } = await supabase
    .from("event_team_data")
    .select("event, team, data, team_name")
    .eq("event", eventKey)
    .is("deleted_at", null);

  if (error) throw error;

  // Fetch rank data from TBA
  try {
    const tbaTeams = await fetchTBAEventTeams(eventKey);
    if (tbaTeams && data) {
      // Create a map of team key to rank
      const rankMap = new Map(tbaTeams.map(t => [t.key, t.rank]));
      
      // Enrich Supabase data with ranks
      return data.map(team => ({
        ...team,
        rank: rankMap.get(team.team) ?? 0,
      }));
    }
  } catch (e) {
    console.error("Failed to fetch TBA ranks:", e);
  }

  // Return data without ranks if TBA fetch fails
  return data?.map(team => ({ ...team, rank: 0 }));
}

/**
 * Submit pit scouting data for a team.
 * Updates the `data` column in event_team_data.
 */
export async function submitPitData(
  eventKey: string,
  team: string,
  pitData: object
) {
  const { error } = await supabase
    .from("event_team_data")
    .update({ data: pitData })
    .eq("event", eventKey)
    .eq("team", team);

  if (error) throw error;
}
