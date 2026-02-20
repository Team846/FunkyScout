import { calculateSingleMatchStats } from "@lib/data/matchStats";
import type { EventMatchData } from "@lib/db";
import type { TbaClimbEntry } from "../contexts/DesktopCompetitionDataContext";

interface ClimbStats {
  L1Percentage: number;
  L2Percentage: number;
  L3Percentage: number;
  autoClimbPercentage: number;
  averageLevel: number;
}

/**
 * Recompute climb stats using TBA's authoritative climb levels.
 *
 * Conflict rules per match:
 * - TBA data available → TBA level is authoritative for level + hasAutoClimb
 * - TBA data not available → fall back to scouted level (from action toggles)
 *
 * Values are in 0-100 scale, matching calculateAllTeamStats output.
 */
export function computeClimbWithTba(
  teamKey: string,
  matchDataArray: EventMatchData[],
  tbaClimbMap: Record<string, Record<string, TbaClimbEntry>>
): ClimbStats {
  const teamMatches = matchDataArray.filter((m) => m.team === teamKey);

  if (teamMatches.length === 0) {
    return { L1Percentage: 0, L2Percentage: 0, L3Percentage: 0, autoClimbPercentage: 0, averageLevel: 0 };
  }

  let L1 = 0, L2 = 0, L3 = 0, autoCount = 0, levelSum = 0;

  for (const m of teamMatches) {
    const tba = tbaClimbMap[m.match]?.[teamKey];

    let effectiveLevel: "L1" | "L2" | "L3" | null;
    let effectiveAutoClimb: boolean;

    if (tba !== undefined) {
      // TBA data exists for this match — TBA is authoritative
      effectiveLevel = tba.teleop_climb;
      effectiveAutoClimb = tba.auto_climb !== null;
    } else {
      // No TBA data for this match — fall back to scouted action toggles
      const scouted = calculateSingleMatchStats(m);
      effectiveLevel = scouted?.climb.level ?? null;
      effectiveAutoClimb = scouted?.climb.hasAutoClimb ?? false;
    }

    if (effectiveLevel === "L1") { L1++; levelSum += 1; }
    else if (effectiveLevel === "L2") { L2++; levelSum += 2; }
    else if (effectiveLevel === "L3") { L3++; levelSum += 3; }
    if (effectiveAutoClimb) autoCount++;
  }

  const n = teamMatches.length;
  return {
    L1Percentage: (L1 / n) * 100,
    L2Percentage: (L2 / n) * 100,
    L3Percentage: (L3 / n) * 100,
    autoClimbPercentage: (autoCount / n) * 100,
    averageLevel: levelSum / n,
  };
}
