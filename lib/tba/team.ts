import { fetchTBAData } from "./fetch";

interface TeamEventStatus {
  key: string;
  team: number;
  rank: number;
  record: {
    losses: number;
    ties: number;
    wins: number;
  };
  nextMatch: string | null;
  lastMatch: string | null;
  matches: number;
  orders: number[]; // This is the "sort_orders" from TBA's API
}

async function fetchTeamEventStatus(
  event_key: string,
  team_key: string
): Promise<TeamEventStatus | false> {
  const teamData = await fetchTBAData(
    `/team/${team_key}/event/${event_key}/status`,
    "GET"
  );

  if (!teamData) {
    return false;
  }

  return {
    key: team_key,
    team: Number(team_key.substring(3)),
    rank: teamData.qual.ranking.rank,
    record: teamData.qual.ranking.record,
    nextMatch: teamData.next_match_key,
    lastMatch: teamData.last_match_key,
    matches: teamData.qual.ranking.matches_played,
    orders: teamData.qual.ranking.sort_orders,
  };
}

export { fetchTeamEventStatus };
export type { TeamEventStatus };
