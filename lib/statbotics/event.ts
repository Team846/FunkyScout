import { fetchStatboticsData } from "./fetch";

/**
 * Fetch all matches for an event, including predictions.
 */
export async function fetchEventMatches(event: string): Promise<any[]> {
  try {
    const data = await fetchStatboticsData(`/matches?event=${event}`);
    return data || [];
  } catch (error) {
    console.error(`Failed to fetch matches for event ${event}:`, error);
    return [];
  }
}

/**
 * Fetch all team-year data for an event in one go.
 */
export async function fetchEventTeamYears(event: string): Promise<any[]> {
  try {
    const data = await fetchStatboticsData(`/team_years?event=${event}`);
    return data || [];
  } catch (error) {
    console.error(`Failed to fetch team-years for event ${event}:`, error);
    return [];
  }
}

/**
 * Fetch EPA for all teams at a specific event directly from Statbotics.
 * Returns a map of "frcXXXX" -> EPA object.
 */
export async function fetchStatboticsEventTeams(
  event: string
): Promise<Record<string, { total_points?: { mean?: number; sd?: number }; auto?: { mean?: number; sd?: number }; teleop?: { mean?: number; sd?: number }; endgame?: { mean?: number; sd?: number }; norm?: number } | null>> {
  try {
    const data: any[] = await fetchStatboticsData(
      `/team_events?event=${event}&limit=100`
    );
    if (!data || !Array.isArray(data)) return {};
    const result: Record<string, any> = {};
    for (const entry of data) {
      if (entry.team != null) {
        result[`frc${entry.team}`] = entry.epa ?? null;
      }
    }
    return result;
  } catch (error) {
    console.error(`[Statbotics] Failed to fetch event teams for ${event}:`, error);
    return {};
  }
}
