/**
 * Team and Match Comparison Views
 *
 * Provides four comparison view types for desktop admin interface:
 * 1. Side-by-side team comparison (2-4 teams)
 * 2. Team match history breakdown (all matches for one team)
 * 3. Match comparison (same team across multiple matches)
 * 4. Match breakdown (all teams in one match)
 *
 * All views combine scouting data with TBA stats (EPA, OPR, rankings)
 */

import type { EventMatchData, EventTeamData, EventSchedule } from "@lib/data/schema";
import { calculateTeamStats, calculateSingleMatchStats, type TeamStats, type MatchStats } from "@lib/data/matchStats";
import { teamsMatch } from "@lib/data/shiftViews";
import { getMatchLabel } from "@lib/utils/match";

// ============== TYPE 1: Side-by-side Team Comparison ==============

/**
 * Team comparison entry (for 2-4 teams side-by-side)
 */
export interface TeamComparison {
  teamKey: string; // e.g., "frc846"
  teamNumber: number; // e.g., 846
  teamName: string; // e.g., "The Funky Monkeys"
  stats: TeamStats | null; // Calculated stats from match scouting
  epa: number | null; // TBA EPA (total_points.mean)
  opr: number | null; // TBA OPR
  rank: number | null; // Event rank
}

/**
 * Compare 2-4 teams side-by-side
 *
 * Combines scouting stats with TBA metrics for comprehensive comparison
 *
 * @param eventKey - Event key (e.g., "2026caav")
 * @param teamKeys - Array of 2-4 team keys to compare
 * @param matchData - All event match data
 * @param teamData - All event team data (includes EPA/OPR)
 * @returns Array of team comparisons
 *
 * @example
 * ```typescript
 * const comparison = await compareTeams(
 *   "2026caav",
 *   ["frc846", "frc254", "frc1678"],
 *   matchData,
 *   teamData
 * );
 * // Shows stats, EPA, OPR, rank for all 3 teams side-by-side
 * ```
 */
export async function compareTeams(
  _eventKey: string,
  teamKeys: string[],
  matchData: EventMatchData[],
  teamData: EventTeamData[]
): Promise<TeamComparison[]> {
  if (teamKeys.length < 2 || teamKeys.length > 4) {
    throw new Error("Must compare between 2 and 4 teams");
  }

  return teamKeys.map((teamKey) => {
    // Calculate stats from match scouting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = calculateTeamStats(teamKey, matchData as any);

    // Get TBA data
    const teamDataEntry = teamData.find((t) => teamsMatch(t.team, teamKey));
    const teamDataFields = teamDataEntry?.data as any;

    return {
      teamKey,
      teamNumber: parseInt(teamKey?.replace("frc", "")),
      teamName: teamDataEntry?.team_name || `Team ${teamKey}`,
      stats,
      epa: teamDataFields?.epa?.total_points?.mean ?? null,
      opr: teamDataFields?.opr ?? null,
      rank: teamDataFields?.rank ?? null,
    };
  });
}

// ============== TYPE 2: Team Match History ==============

/**
 * Single match entry in team history
 */
export interface MatchHistoryEntry {
  matchKey: string; // e.g., "2026caav_qm1"
  matchLabel: string; // e.g., "Qual 1"
  stats: MatchStats | null; // Calculated stats for this match
  estTime: number | null; // Estimated match time (Unix timestamp seconds)
}

/**
 * Complete match history for one team
 */
export interface TeamMatchHistory {
  teamKey: string;
  teamNumber: number;
  teamName: string;
  matches: MatchHistoryEntry[];
  aggregateStats: TeamStats | null; // Overall stats across all matches
}

/**
 * Get team's complete match history breakdown
 *
 * Shows every match the team played with individual and aggregate stats
 *
 * @param eventKey - Event key
 * @param teamKey - Team to get history for
 * @param matchData - All event match data
 * @param teamData - All event team data
 * @param schedule - Event schedule
 * @returns Team match history
 *
 * @example
 * ```typescript
 * const history = await getTeamMatchHistory(
 *   "2026caav",
 *   "frc846",
 *   matchData,
 *   teamData,
 *   schedule
 * );
 * // Shows qm1, qm2, qm3... with stats for each
 * ```
 */
export async function getTeamMatchHistory(
  eventKey: string,
  teamKey: string,
  matchData: EventMatchData[],
  teamData: EventTeamData[],
  schedule: EventSchedule[]
): Promise<TeamMatchHistory> {
  const teamMatches = matchData.filter(
    (m) => m.team === teamKey && !m.deleted_at && m.event === eventKey
  );

  const matchesWithStats: MatchHistoryEntry[] = teamMatches.map((match) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = calculateSingleMatchStats(match as any);
    const scheduleEntry = schedule.find(
      (s) => s.match === match.match && s.team === teamKey && !s.deleted_at
    ) as any;

    return {
      matchKey: match.match,
      matchLabel: getMatchLabel(match.match),
      stats,
      estTime: scheduleEntry?.est_time || null,
    };
  });

  // Sort by match number
  matchesWithStats.sort((a, b) => {
    const aNum = parseInt(a.matchKey.replace(/\D/g, "")) || 0;
    const bNum = parseInt(b.matchKey.replace(/\D/g, "")) || 0;
    return aNum - bNum;
  });

  const teamDataEntry = teamData.find((t) => teamsMatch(t.team, teamKey));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aggregateStats = calculateTeamStats(teamKey, matchData as any);

  return {
    teamKey,
    teamNumber: parseInt(teamKey?.replace("frc", "")),
    teamName: teamDataEntry?.team_name || `Team ${teamKey}`,
    matches: matchesWithStats,
    aggregateStats,
  };
}

// ============== TYPE 3: Match Comparison (Same Team Across Matches) ==============

/**
 * Entry for comparing same team across multiple matches
 */
export interface MatchComparisonEntry {
  matchKey: string;
  matchLabel: string;
  stats: MatchStats | null;
  estTime: number | null;
}

/**
 * Compare same team's performance across multiple matches
 *
 * Useful for seeing progression or consistency
 *
 * @param eventKey - Event key
 * @param teamKey - Team to compare
 * @param matchKeys - Specific matches to compare
 * @param matchData - All event match data
 * @param schedule - Event schedule
 * @returns Array of match comparison entries
 *
 * @example
 * ```typescript
 * const progression = await compareTeamAcrossMatches(
 *   "2026caav",
 *   "frc846",
 *   ["2026caav_qm1", "2026caav_qm5", "2026caav_qm10"],
 *   matchData,
 *   schedule
 * );
 * // Compare frc846's performance in qm1, qm5, qm10
 * ```
 */
export async function compareTeamAcrossMatches(
  eventKey: string,
  teamKey: string,
  matchKeys: string[],
  matchData: EventMatchData[],
  schedule: EventSchedule[]
): Promise<MatchComparisonEntry[]> {
  return matchKeys.map((matchKey) => {
    const matchDataEntry = matchData.find(
      (m) =>
        m.team === teamKey &&
        m.match === matchKey &&
        !m.deleted_at &&
        m.event === eventKey
    );

    const stats = matchDataEntry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? calculateSingleMatchStats(matchDataEntry as any)
      : null;

    const scheduleEntry = schedule.find(
      (s) =>
        s.match === matchKey &&
        s.team === teamKey &&
        !s.deleted_at &&
        s.event === eventKey
    ) as any;

    return {
      matchKey,
      matchLabel: getMatchLabel(matchKey),
      stats,
      estTime: scheduleEntry?.est_time || null,
    };
  });
}

// ============== TYPE 4: Match Breakdown (All Teams in One Match) ==============

/**
 * Team entry in match breakdown
 */
export interface MatchBreakdownTeam {
  teamKey: string;
  teamNumber: number;
  teamName: string;
  stats: MatchStats | null;
}

/**
 * Complete breakdown of one match (all 6 teams)
 */
export interface MatchBreakdown {
  matchKey: string;
  matchLabel: string; // e.g., "Qual 1"
  estTime: number | null;
  redAlliance: MatchBreakdownTeam[];
  blueAlliance: MatchBreakdownTeam[];
  redScore: number | null; // Actual match score from TBA
  blueScore: number | null; // Actual match score from TBA
}

/**
 * Get complete breakdown of one match (all teams)
 *
 * Shows all 6 teams' performance in a specific match
 *
 * @param eventKey - Event key
 * @param matchKey - Match to break down
 * @param matchData - All event match data
 * @param teamData - All event team data (for team names)
 * @param schedule - Event schedule
 * @returns Match breakdown
 *
 * @example
 * ```typescript
 * const breakdown = await getMatchBreakdown(
 *   "2026caav",
 *   "2026caav_qm1",
 *   matchData,
 *   teamData,
 *   schedule
 * );
 * // Shows all 6 teams' stats for qm1
 * ```
 */
export async function getMatchBreakdown(
  eventKey: string,
  matchKey: string,
  matchData: EventMatchData[],
  teamData: EventTeamData[],
  schedule: EventSchedule[]
): Promise<MatchBreakdown> {
  const matchSchedule = schedule.filter(
    (s) => s.match === matchKey && !s.deleted_at && s.event === eventKey
  );

  const redTeams = matchSchedule.filter((s) => s.alliance === "red");
  const blueTeams = matchSchedule.filter((s) => s.alliance === "blue");

  const createTeamEntry = (scheduleEntry: EventSchedule): MatchBreakdownTeam => {
    const teamDataEntry = teamData.find((t) => teamsMatch(t.team, scheduleEntry.team));
    const matchDataEntry = matchData.find(
      (m) =>
        m.team === scheduleEntry.team &&
        m.match === matchKey &&
        !m.deleted_at &&
        m.event === eventKey
    );

    return {
      teamKey: scheduleEntry.team,
      teamNumber: parseInt(scheduleEntry.team.replace("frc", "")),
      teamName: teamDataEntry?.team_name || `Team ${scheduleEntry.team}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stats: matchDataEntry ? calculateSingleMatchStats(matchDataEntry as any) : null,
    };
  };

  const redAlliance = redTeams.map(createTeamEntry);
  const blueAlliance = blueTeams.map(createTeamEntry);

  // Get match scores from schedule (TBA data)
  const scheduleEntry = matchSchedule[0] as any;

  return {
    matchKey,
    matchLabel: getMatchLabel(matchKey),
    estTime: scheduleEntry?.est_time || null,
    redAlliance,
    blueAlliance,
    redScore: scheduleEntry?.redScore || null,
    blueScore: scheduleEntry?.blueScore || null,
  };
}

// ============== HELPER FUNCTIONS ==============

/**
 * Get all matches for a team at an event
 *
 * Utility function for getting match keys
 */
export function getTeamMatches(
  eventKey: string,
  teamKey: string,
  schedule: EventSchedule[]
): string[] {
  return schedule
    .filter(
      (s) => s.team === teamKey && !s.deleted_at && s.event === eventKey
    )
    .map((s) => s.match)
    .sort((a, b) => {
      const aNum = parseInt(a.replace(/\D/g, "")) || 0;
      const bNum = parseInt(b.replace(/\D/g, "")) || 0;
      return aNum - bNum;
    });
}

/**
 * Get match type from match key
 */
export function getMatchType(matchKey: string): "qm" | "sf" | "f" | "other" {
  const lower = matchKey.toLowerCase();
  if (lower.includes("qm")) return "qm";
  if (lower.includes("sf")) return "sf";
  if (lower.includes("f")) return "f";
  return "other";
}
