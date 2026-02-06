import { fetchTBAData } from "./fetch";

interface TeamRank {
  key: string;
  team: number;
  name: string;
  rank: number;
  record: {
    losses: number;
    ties: number;
    wins: number;
  };
  nextMatch: string | null;
  lastMatch: string | null;
  matches: number;
  orders: number[]; 
}

interface EventSchedule {
  [match_key: string]: {
    redTeams: string[];
    blueTeams: string[];
    est_time: number;
    redScore: number | null;
    blueScore: number | null;
  };
}

export interface EventScheduleEntry {
  matchKey: string;
  redTeams: string[];
  blueTeams: string[];
  estTime: number;
}

/**
 * Fetches teams from TBA and returns each team and their ranks
 */
async function fetchTBAEventTeams(event: string): Promise<TeamRank[] | undefined> {
  const teamsStatuses = await fetchTBAData(
    `/event/${event}/teams/statuses`,
    "GET"
  );
  const teamsData = await fetchTBAData(`/event/${event}/teams`, "GET");

  if (!teamsStatuses || !teamsData) {
    return;
  }

  const teams: TeamRank[] = [];

  // Check if event hasn't started yet (no rankings)
  if (teamsStatuses[teamsData[0].key] == null) {
    for (const team of teamsData) {
      teams.push({
        key: team.key,
        team: team.team_number,
        name: team.nickname,
        rank: 0,
        record: { losses: 0, ties: 0, wins: 0 },
        nextMatch: "",
        lastMatch: "",
        matches: 0,
        orders: [],
      });
    }
    return teams;
  }

  for (const team of teamsData) {
    const teamStatus = teamsStatuses[team.key];

    teams.push({
      key: team.key,
      team: team.team_number,
      name: team.nickname,
      rank: teamStatus.qual?.ranking?.rank ?? 0,
      record: teamStatus.qual?.ranking?.record ?? { losses: 0, ties: 0, wins: 0 },
      nextMatch: teamStatus.next_match_key ?? "",
      lastMatch: teamStatus.last_match_key ?? "",
      matches: teamStatus.qual?.ranking?.matches_played ?? 0,
      orders: teamStatus.qual?.ranking?.sort_orders ?? [],
    });
  }

  return teams;
}

async function fetchTBAMatchSchedule(
  eventKey: string
): Promise<EventSchedule | undefined> {
  const matchStatus = await fetchTBAData(
    `/event/${eventKey}/matches/simple`,
    "GET"
  );

  if (!matchStatus || matchStatus.length === 0) {
    return;
  }

  const matchSchedule: EventSchedule = {};

  for (const match of matchStatus) {
    matchSchedule[match.key] = {
      redTeams: [
        match.alliances.red.team_keys[0],
        match.alliances.red.team_keys[1],
        match.alliances.red.team_keys[2],
      ],
      blueTeams: [
        match.alliances.blue.team_keys[0],
        match.alliances.blue.team_keys[1],
        match.alliances.blue.team_keys[2],
      ],
      est_time: match.predicted_time,
      redScore: match.alliances.red.score ?? null,
      blueScore: match.alliances.blue.score ?? null,
    };
  }

  return matchSchedule;
}

async function fetchTeamEventCOPRs(
  eventKey: string
): Promise<Record<string, Record<string, number>> | undefined> {
  const OPRs = await fetchTBAData(`/event/${eventKey}/oprs`, "GET");
  const COPRs = await fetchTBAData(`/event/${eventKey}/coprs`, "GET");

  if (!OPRs || !COPRs) return;

  const returnObject: Record<string, Record<string, number>> = {};

  returnObject["Total Points"] = OPRs.oprs;

  for (const value in COPRs) {
    returnObject[value] = COPRs[value];
  }

  return returnObject;
}

export { fetchTBAEventTeams, fetchTBAMatchSchedule, fetchTeamEventCOPRs };
export type { EventSchedule, TeamRank };
