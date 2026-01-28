import { fetchStatboticsData } from "./fetch";

export interface StatboticsTeamData {
  team: string;
  name: string;
  country: string;
  state: string;
  district: string | null;
  rookie_year: number;
  offseason: boolean;
  active: boolean;
  record: {
    season: {
      wins: number;
      losses: number;
      ties: number;
      count: number;
      winrate: number;
    };
    full: {
      wins: number;
      losses: number;
      ties: number;
      count: number;
      winrate: number;
    };
  };
  norm_epa: {
    current: number;
    recent: number;
    mean: number;
    max: number;
  };
}

export interface StatboticsTeamEPAs {
  team: string;
  year: number;
  name: string;
  country: string;
  state: string;
  district: string | null;
  offseason: boolean;
  epa: {
    total_points: {
      mean: number;
      sd: number;
    };
    unitless: number;
    norm: number;
    conf: number[];
    breakdown: Record<string, number>;
  };
  record: {
    season: {
      wins: number;
      losses: number;
      ties: number;
      count: number;
      winrate: number;
    };
    full: {
      wins: number;
      losses: number;
      ties: number;
      count: number;
      winrate: number;
    };
  };
}

/**
 * Fetch general team data from Statbotics
 */
export async function fetchStatboticsTeamData(
  team: string
): Promise<StatboticsTeamData | false> {
  const teamData = await fetchStatboticsData(`/team/${team}`);
  return teamData || false;
}

/**
 * Fetch team EPA data for a specific year
 */
export async function fetchStatboticsTeamEPA(
  team: string,
  event: string
): Promise<StatboticsTeamEPAs | false> {
  const year = event.substring(0, 4);
  const teamData = await fetchStatboticsData(`/team_year/${team}/${year}`);
  return teamData || false;
}
