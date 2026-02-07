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
