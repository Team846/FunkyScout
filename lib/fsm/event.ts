import { fetchFSMData } from "./fetch";

export interface FSMTeamData {
  team_key: string;
  team_number: number;
  rank?: number;
  fsm: number;
  fuel?: number;
  climb?: number;
  auto?: number;
  penalty?: number;
  defense_score?: number | null;
  predicted?: boolean;
}

/**
 * Fetch FSM ratings for all teams at a specific event.
 * Returns a map of team key ("frcXXXX" and "XXXX") -> FSM score (number).
 */
export async function fetchFSMEventTeams(
  event: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchFSMData(`/events/${event}/teams`);
    console.log('FETCH FSM DATA:', data)
    if (!data || !Array.isArray(data.data.teams)) {
      console.log('HERE 1')
      return {};
    }

    const result: Record<string, number> = {};
    for (const team of data.data.teams) {
      console.log("TEAM", team)
      if (team.fsm != null && typeof team.fsm === "number") {
        const teamKey = team.team_key || (team.team_number ? `frc${team.team_number}` : null);
        if (teamKey) {
          result[teamKey] = team.fsm;
          const rawNum = teamKey.replace(/^frc/i, "");
          result[rawNum] = team.fsm;
        }
      }
    }
    console.log('HERE 2', result)
    return result;
  } catch (error) {
    console.error(`[FSM] Failed to fetch event teams for ${event}:`, error);
    return {};
  }
}

/**
 * Fetch single team profile from FSM API.
 * Accepts "846" or "frc846".
 */
export async function fetchFSMTeam(team: string): Promise<number | null> {
  try {
    const rawNum = team.replace(/^frc/i, "");
    const data = await fetchFSMData(`/teams/${rawNum}`);
    if (data && typeof data.fsm === "number") {
      return data.fsm;
    }
    return null;
  } catch (error) {
    return null;
  }
}
