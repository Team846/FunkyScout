/**
 * Shift Viewing Functions
 *
 * Provides three modes for viewing scouter shift assignments:
 * 1. By Match: Show all scouters assigned to each match
 * 2. By Scouter: Show all matches assigned to each scouter
 * 3. Coverage Gaps: Show unassigned matches/teams
 *
 * Used by desktop admin interface for shift management and planning
 */

import { getEventSchedule } from "@lib/db";
import type { EventSchedule } from "@lib/data/schema";
import { getUserProfiles } from "@lib/data/scouterRatings";

/**
 * Single match assignment entry
 */
export interface MatchAssignment {
  match: string; // e.g., "qm1", "sf1m1"
  team: string; // e.g., "frc846"
  alliance: "red" | "blue" | null;
  scouterName: string | null; // Assigned scouter name
  scouterUid: string | null; // Assigned scouter UID
  estTime: number | null; // Estimated match time (Unix timestamp seconds)
}

/**
 * Scouter's complete schedule
 */
export interface ScouterSchedule {
  uid: string;
  name: string;
  assignments: MatchAssignment[];
  totalMatches: number;
}

/**
 * Coverage gap (unassigned match/team)
 */
export interface CoverageGap {
  match: string;
  team: string;
  alliance: "red" | "blue" | null;
  estTime: number | null;
}

/**
 * VIEW 1: Get shifts grouped by match (all assignments per match)
 *
 * Returns Map of match key → array of assignments
 * Useful for viewing who's scouting each match
 *
 * @param eventKey - Event key (e.g., "2026caav")
 * @returns Map of match → assignments
 *
 * @example
 * ```typescript
 * const byMatch = await getShiftsByMatch("2026caav");
 * const qm1Assignments = byMatch.get("qm1"); // All scouters for qm1
 * ```
 */
export async function getShiftsByMatch(
  eventKey: string
): Promise<Map<string, MatchAssignment[]>> {
  const schedule = await getEventSchedule(eventKey);

  // Group by match
  const byMatch = new Map<string, MatchAssignment[]>();

  for (const entry of schedule) {
    if (entry.deleted_at) continue; // Skip deleted assignments

    if (!byMatch.has(entry.match)) {
      byMatch.set(entry.match, []);
    }

    byMatch.get(entry.match)!.push({
      match: entry.match,
      team: entry.team,
      alliance: entry.alliance,
      scouterName: entry.name || null,
      scouterUid: entry.uid || null,
      estTime: entry.est_time || null,
    });
  }

  return byMatch;
}

/**
 * VIEW 2: Get shifts grouped by scouter (all matches per scouter)
 *
 * Returns array of scouter schedules
 * Useful for viewing each scouter's workload
 *
 * @param eventKey - Event key (e.g., "2026caav")
 * @returns Array of scouter schedules
 *
 * @example
 * ```typescript
 * const byScouter = await getShiftsByScouter("2026caav");
 * const johnSchedule = byScouter.find(s => s.name === "John");
 * console.log(`John has ${johnSchedule.totalMatches} matches`);
 * ```
 */
export async function getShiftsByScouter(
  eventKey: string
): Promise<ScouterSchedule[]> {
  const schedule = await getEventSchedule(eventKey);

  // Get unique UIDs from schedule
  const allUids = [
    ...new Set(
      schedule
        .map((s) => s.uid)
        .filter((uid): uid is string => uid !== null && uid !== undefined)
    ),
  ];

  // Fetch user profiles to get names
  const profiles = await getUserProfiles(allUids);

  // Create map of uid → name
  const nameMap = new Map(profiles.map((p) => [p.uid, p.name]));

  // Group by scouter
  const byScouter = new Map<string, MatchAssignment[]>();

  for (const entry of schedule) {
    if (entry.deleted_at) continue; // Skip deleted assignments
    if (!entry.uid) continue; // Skip unassigned

    if (!byScouter.has(entry.uid)) {
      byScouter.set(entry.uid, []);
    }

    byScouter.get(entry.uid)!.push({
      match: entry.match,
      team: entry.team,
      alliance: entry.alliance,
      scouterName: entry.name || nameMap.get(entry.uid) || "Unknown",
      scouterUid: entry.uid,
      estTime: entry.est_time || null,
    });
  }

  // Convert to array and sort by name
  const schedules = Array.from(byScouter.entries())
    .map(([uid, assignments]) => ({
      uid,
      name: nameMap.get(uid) || "Unknown",
      assignments,
      totalMatches: assignments.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return schedules;
}

/**
 * VIEW 3: Get coverage gaps (unassigned matches/teams)
 *
 * Returns array of unassigned schedule entries
 * Useful for identifying what still needs to be assigned
 *
 * @param eventKey - Event key (e.g., "2026caav")
 * @returns Array of coverage gaps
 *
 * @example
 * ```typescript
 * const gaps = await getCoverageGaps("2026caav");
 * console.log(`${gaps.length} unassigned slots remaining`);
 * ```
 */
export async function getCoverageGaps(
  eventKey: string
): Promise<CoverageGap[]> {
  const schedule = await getEventSchedule(eventKey);

  return schedule
    .filter((entry) => !entry.deleted_at && (!entry.uid || !entry.name)) // No assignment
    .map((entry) => ({
      match: entry.match,
      team: entry.team,
      alliance: entry.alliance,
      estTime: entry.est_time || null,
    }))
    .sort((a, b) => {
      // Sort by match number
      const aMatch = parseInt(a.match.replace(/\D/g, "")) || 0;
      const bMatch = parseInt(b.match.replace(/\D/g, "")) || 0;
      return aMatch - bMatch;
    });
}

/**
 * BONUS: Get scouter workload statistics
 *
 * Returns summary of how many matches each scouter is assigned
 * Useful for balancing workload
 *
 * @param eventKey - Event key (e.g., "2026caav")
 * @returns Array of scouter workload summaries
 *
 * @example
 * ```typescript
 * const workload = await getScouterWorkload("2026caav");
 * const overloaded = workload.filter(w => w.matchCount > 10);
 * ```
 */
export async function getScouterWorkload(
  eventKey: string
): Promise<{ uid: string; name: string; matchCount: number }[]> {
  const scouterSchedules = await getShiftsByScouter(eventKey);

  return scouterSchedules
    .map((s) => ({
      uid: s.uid,
      name: s.name,
      matchCount: s.totalMatches,
    }))
    .sort((a, b) => b.matchCount - a.matchCount); // Sort by workload descending
}

/**
 * Get match type from match key
 * @internal
 */
function getMatchType(matchKey: string): "qm" | "sf" | "f" | "other" {
  const lower = matchKey.toLowerCase();
  if (lower.includes("qm")) return "qm";
  if (lower.includes("sf")) return "sf";
  if (lower.includes("f")) return "f";
  return "other";
}

/**
 * Get statistics about shift coverage
 *
 * Returns summary metrics about assignments
 *
 * @param eventKey - Event key
 * @returns Coverage statistics
 */
export async function getShiftCoverageStats(eventKey: string): Promise<{
  totalSlots: number;
  assignedSlots: number;
  unassignedSlots: number;
  coveragePercentage: number;
  uniqueScouters: number;
  qualMatches: { total: number; assigned: number; unassigned: number };
  playoffMatches: { total: number; assigned: number; unassigned: number };
}> {
  const schedule = await getEventSchedule(eventKey);
  const activeSchedule = schedule.filter((s) => !s.deleted_at);

  const assigned = activeSchedule.filter((s) => s.uid && s.name);
  const unassigned = activeSchedule.filter((s) => !s.uid || !s.name);

  const uniqueScouters = new Set(assigned.map((s) => s.uid)).size;

  // Breakdown by match type
  const qualSchedule = activeSchedule.filter(
    (s) => getMatchType(s.match) === "qm"
  );
  const playoffSchedule = activeSchedule.filter((s) => {
    const type = getMatchType(s.match);
    return type === "sf" || type === "f";
  });

  const qualAssigned = qualSchedule.filter((s) => s.uid && s.name).length;
  const playoffAssigned = playoffSchedule.filter((s) => s.uid && s.name).length;

  return {
    totalSlots: activeSchedule.length,
    assignedSlots: assigned.length,
    unassignedSlots: unassigned.length,
    coveragePercentage:
      activeSchedule.length > 0
        ? (assigned.length / activeSchedule.length) * 100
        : 0,
    uniqueScouters,
    qualMatches: {
      total: qualSchedule.length,
      assigned: qualAssigned,
      unassigned: qualSchedule.length - qualAssigned,
    },
    playoffMatches: {
      total: playoffSchedule.length,
      assigned: playoffAssigned,
      unassigned: playoffSchedule.length - playoffAssigned,
    },
  };
}
