/**
 * Shift viewing functions for desktop admin interface
 * Phase 4 from enchanted-swinging-swing.md
 */

import { getEventSchedule } from "@lib/db";

export interface MatchAssignment {
  match: string;
  team: string;
  alliance: "red" | "blue" | null;
  scouterName: string | null;
  scouterUid: string | null;
  estTime: number | null;
}

export interface ScouterSchedule {
  uid: string;
  name: string;
  assignments: MatchAssignment[];
  totalMatches: number;
}

export interface CoverageGap {
  match: string;
  team: string;
  alliance: "red" | "blue" | null;
  estTime: number | null;
}

/**
 * View 1: Shifts grouped by match (all assignments per match)
 * Returns a map of match -> assignments
 */
export async function getShiftsByMatch(
  eventKey: string
): Promise<Map<string, MatchAssignment[]>> {
  const schedule = await getEventSchedule(eventKey);

  // Group by match
  const matchMap = new Map<string, MatchAssignment[]>();

  for (const entry of schedule) {
    const assignment: MatchAssignment = {
      match: entry.match,
      team: entry.team,
      alliance: entry.alliance,
      scouterName: entry.name || null,
      scouterUid: entry.uid || null,
      estTime: entry.est_time || null,
    };

    if (!matchMap.has(entry.match)) {
      matchMap.set(entry.match, []);
    }

    matchMap.get(entry.match)!.push(assignment);
  }

  return matchMap;
}

/**
 * View 2: Shifts grouped by scouter (all matches per scouter)
 * Returns array of scouters with their assignments
 */
export async function getShiftsByScouter(
  eventKey: string
): Promise<ScouterSchedule[]> {
  const schedule = await getEventSchedule(eventKey);

  // Get all unique scouters (only those with assignments)
  const scouterMap = new Map<string, MatchAssignment[]>();

  for (const entry of schedule) {
    // Skip unassigned entries
    if (!entry.uid || !entry.name) continue;

    const assignment: MatchAssignment = {
      match: entry.match,
      team: entry.team,
      alliance: entry.alliance,
      scouterName: entry.name,
      scouterUid: entry.uid,
      estTime: entry.est_time || null,
    };

    if (!scouterMap.has(entry.uid)) {
      scouterMap.set(entry.uid, []);
    }

    scouterMap.get(entry.uid)!.push(assignment);
  }

  // Convert to ScouterSchedule array
  const schedules: ScouterSchedule[] = [];

  for (const [uid, assignments] of scouterMap.entries()) {
    // Sort assignments by match
    assignments.sort((a, b) => a.match.localeCompare(b.match));

    schedules.push({
      uid,
      name: assignments[0].scouterName!,
      assignments,
      totalMatches: assignments.length,
    });
  }

  // Sort by name
  schedules.sort((a, b) => a.name.localeCompare(b.name));

  return schedules;
}

/**
 * View 3: Coverage gaps (unassigned matches/teams)
 * Returns array of unassigned positions
 */
export async function getCoverageGaps(
  eventKey: string
): Promise<CoverageGap[]> {
  const schedule = await getEventSchedule(eventKey);

  const gaps: CoverageGap[] = [];

  for (const entry of schedule) {
    // If no scouter assigned, it's a gap
    if (!entry.uid || !entry.name) {
      gaps.push({
        match: entry.match,
        team: entry.team,
        alliance: entry.alliance,
        estTime: entry.est_time || null,
      });
    }
  }

  // Sort by match
  gaps.sort((a, b) => a.match.localeCompare(b.match));

  return gaps;
}

/**
 * Bonus: Workload statistics
 * Returns array of scouters with their match counts
 */
export async function getScouterWorkload(
  eventKey: string
): Promise<{ uid: string; name: string; matchCount: number }[]> {
  const schedules = await getShiftsByScouter(eventKey);

  return schedules.map((schedule) => ({
    uid: schedule.uid,
    name: schedule.name,
    matchCount: schedule.totalMatches,
  }));
}
