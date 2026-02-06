import { fetchStatboticsData } from "./fetch";

export interface StatboticsMatch {
  key: string;
  year: number;
  event: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  status: string;
  video: string | null;
  red_1: string;
  red_2: string;
  red_3: string;
  blue_1: string;
  blue_2: string;
  blue_3: string;
  pred: {
    red_win_prob: number;
    red_score: number;
    blue_score: number;
  };
  result: {
    red_score: number;
    blue_score: number;
    winner: string;
  } | null;
}

/**
 * Fetch match prediction data from Statbotics
 */
export async function fetchStatboticsMatch(
  matchKey: string
): Promise<StatboticsMatch | false> {
  const matchData = await fetchStatboticsData(`/match/${matchKey}`);
  return matchData || false;
}
