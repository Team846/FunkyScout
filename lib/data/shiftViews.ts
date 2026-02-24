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

  const scouterMap = new Map<string, MatchAssignment[]>();

  for (const entry of schedule) {
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

  const schedules: ScouterSchedule[] = [];

  for (const [uid, assignments] of scouterMap.entries()) {
    assignments.sort((a, b) => a.match.localeCompare(b.match));

    schedules.push({
      uid,
      name: assignments[0].scouterName!,
      assignments,
      totalMatches: assignments.length,
    });
  }

  schedules.sort((a, b) => a.name.localeCompare(b.name));

  return schedules;
}

/**
 * View 3: Coverage gaps (unassigned matches/teams)
 */
export async function getCoverageGaps(
  eventKey: string
): Promise<CoverageGap[]> {
  const schedule = await getEventSchedule(eventKey);

  const gaps: CoverageGap[] = [];

  for (const entry of schedule) {
    if (!entry.uid || !entry.name) {
      gaps.push({
        match: entry.match,
        team: entry.team,
        alliance: entry.alliance,
        estTime: entry.est_time || null,
      });
    }
  }

  gaps.sort((a, b) => a.match.localeCompare(b.match));

  return gaps;
}

/**
 * Bonus: Workload statistics
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

// ─────────────────────────────────────────────────────────────────────────────
// Redesigned Shifts page — pure build functions
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchCard {
  matchKey: string;
  matchDisplay: string;
  team: string;
  teamNumber: number;
  alliance: "red" | "blue";
  estTime: number | null;
  isCompleted: boolean;
  // Assignment info
  assignedScouterName?: string | null;
  assignedScouterUid?: string | null;
  // Scouting info (who actually scouted)
  scoutedByName?: string | null;
  scoutedByUid?: string | null;
  wasScouted?: boolean;
  scoutedClimbLevel?: "L1" | "L2" | "L3" | null;
  tbaClimbLevel?: "L1" | "L2" | "L3" | null;
  climbMatch?: boolean | null;
  // Team view
  redScore?: number | null;
  blueScore?: number | null;
  predictedRedScore?: number | null;
  predictedBlueScore?: number | null;
}

export interface ScouterViewRow {
  uid: string;
  name: string;
  rating: number | null;
  matchesAssigned: number;
  matchesScouted: number;
  climbAccuracy: number | null;
  pastMatches: MatchCard[];
  nextMatches: MatchCard[];
}

export interface TeamViewRow {
  teamKey: string;
  teamNumber: number;
  teamName: string;
  epa: number | null;
  matchesAssigned: number;
  matchesScouted: number;
  priority: number | null;
  pastMatches: MatchCard[];
  nextMatches: MatchCard[];
}

// ─── Loose input interfaces ──────────────────────────────────────────────────

interface ScheduleEntryInput {
  match: string;
  team: string;
  alliance: string;
  name?: string;
  uid?: string;
  est_time?: number | null;
  red_score?: number | null;
  blue_score?: number | null;
  predicted_red_score?: number | null;
  predicted_blue_score?: number | null;
}

interface MatchDataInput {
  match: string;
  team: string;
  uid?: string | null;
  name?: string | null;
  data_raw?: Record<string, unknown> | null;
}

interface ProfileInput {
  uid: string;
  name: string;
  settings?: Record<string, unknown> | null;
}

interface TbaClimbEntryInput {
  teleop_climb: "L1" | "L2" | "L3" | null;
}

interface TBATeamInput {
  key: string;
  team: number;
  name: string;
  epa?: { total_points?: { mean?: number } } | null;
}

interface PitDataInput {
  team: string;
  data?: Record<string, unknown> | null;
  team_name?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractScoutedClimbLevel(data_raw: unknown): "L1" | "L2" | "L3" | null {
  const toggles: any[] = (data_raw as any)?.teleopActions ?? [];
  for (const level of ["L3", "L2", "L1"] as const) {
    const actionId = `climb_${level}`;
    const relevant = toggles.filter((a: any) => a.actionId === actionId);
    if (relevant.length === 0) continue;
    const lastEnabled = [...relevant].reverse().find((a: any) => a.enabled === true);
    if (!lastEnabled) continue;
    const lastEnabledIdx = relevant.indexOf(lastEnabled);
    const disabledAfter = relevant
      .slice(lastEnabledIdx + 1)
      .some((a: any) => a.enabled === false);
    if (!disabledAfter) return level;
  }
  return null;
}

export function formatMatchKey(matchKey: string): string {
  const seg = matchKey.includes("_")
    ? matchKey.substring(matchKey.lastIndexOf("_") + 1)
    : matchKey;

  const qm = seg.match(/^qm(\d+)$/);
  if (qm) return `Q${qm[1]}`;

  const sf = seg.match(/^sf(\d+)m(\d+)$/);
  if (sf) return `SF${sf[1]}-${sf[2]}`;

  const f = seg.match(/^f1m(\d+)$/);
  if (f) return `F${f[1]}`;

  return seg.toUpperCase();
}

// ─── Build functions ──────────────────────────────────────────────────────────

/**
 * Build scouter view rows.
 *
 * Discovers scouters from the union of UIDs in `schedule` AND `matchData`
 * so anyone who has scouted (even as a substitute) or is assigned appears,
 * regardless of whether their profile is cached in `profiles`.
 * Profile data is used when available for the authoritative name and rating.
 */
export function buildScouterViewData(params: {
  schedule: ScheduleEntryInput[];
  matchData: MatchDataInput[];
  profiles: ProfileInput[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntryInput>>;
}): ScouterViewRow[] {
  const { schedule, matchData, profiles, tbaClimbData } = params;

  // ── Name resolution: schedule.name → matchData.name, overridden by profile.name
  const uidNames = new Map<string, string>(); // uid → best available name
  for (const s of schedule) {
    if (s.uid && s.name && !uidNames.has(s.uid)) uidNames.set(s.uid, s.name);
  }
  for (const m of matchData) {
    if (m.uid && m.name && !uidNames.has(m.uid)) uidNames.set(m.uid, m.name);
  }
  // Profile names are authoritative — override fallback names
  for (const p of profiles) {
    if (p.uid) uidNames.set(p.uid, p.name);
  }

  // ── Profile settings lookup (for rating)
  const profileMap = new Map<string, ProfileInput>();
  for (const p of profiles) profileMap.set(p.uid, p);

  // ── Scouted data index by match+team
  const scoutedByMatchTeam = new Map<string, MatchDataInput>();
  for (const m of matchData) {
    scoutedByMatchTeam.set(`${m.match}|${m.team}`, m);
  }

  const rows: ScouterViewRow[] = [];

  // Build schedule lookup by match+team
  const scheduleByMatchTeam = new Map<string, ScheduleEntryInput>();
  for (const s of schedule) {
    scheduleByMatchTeam.set(`${s.match}|${s.team}`, s);
  }

  for (const [uid, displayName] of uidNames) {
    const assignedEntries = schedule.filter((s) => s.uid === uid && s.name);
    const scoutedByThisUser = matchData.filter((m) => m.uid === uid);

    // Only show if they have at least one assignment or submitted at least one match
    if (assignedEntries.length === 0 && scoutedByThisUser.length === 0) continue;

    const pastMatchCards: MatchCard[] = [];
    const nextMatchCards: MatchCard[] = [];

    // Past matches: what this user actually scouted
    for (const scouted of scoutedByThisUser) {
      const scheduleEntry = scheduleByMatchTeam.get(`${scouted.match}|${scouted.team}`);
      const teamNumber = parseInt(scouted.team.replace("frc", ""), 10);
      
      const card: MatchCard = {
        matchKey: scouted.match,
        matchDisplay: formatMatchKey(scouted.match),
        team: scouted.team,
        teamNumber,
        alliance: (scheduleEntry?.alliance as "red" | "blue") ?? "red",
        estTime: scheduleEntry?.est_time ?? null,
        isCompleted: true,
        wasScouted: true,
      };

      const tbaClimb = tbaClimbData[scouted.match]?.[scouted.team];
      const tbaClimbLevel = tbaClimb?.teleop_climb ?? null;
      const scoutedClimbLevel = scouted.data_raw
        ? extractScoutedClimbLevel(scouted.data_raw)
        : null;
      const climbMatch = tbaClimb
        ? scoutedClimbLevel === tbaClimbLevel
        : null;

      card.scoutedClimbLevel = scoutedClimbLevel;
      card.tbaClimbLevel = tbaClimbLevel;
      card.climbMatch = climbMatch;
      pastMatchCards.push(card);
    }

    // Future matches: what this user is assigned to that hasn't been completed
    for (const entry of assignedEntries) {
      const isCompleted = entry.red_score != null || entry.blue_score != null;
      if (isCompleted) continue; // Skip completed matches for future section
      
      const teamNumber = parseInt(entry.team.replace("frc", ""), 10);
      const card: MatchCard = {
        matchKey: entry.match,
        matchDisplay: formatMatchKey(entry.match),
        team: entry.team,
        teamNumber,
        alliance: entry.alliance as "red" | "blue",
        estTime: entry.est_time ?? null,
        isCompleted: false,
        wasScouted: false,
      };
      nextMatchCards.push(card);
    }

    // Overall climb accuracy across all scouted matches that have TBA data
    let climbMatchCount = 0;
    let climbTotalWithTbaData = 0;
    for (const scouted of scoutedByThisUser) {
      const tbaClimb = tbaClimbData[scouted.match]?.[scouted.team];
      if (!tbaClimb) continue;
      climbTotalWithTbaData++;
      const tbaClimbLevel = tbaClimb.teleop_climb;
      const scoutedClimbLevel = scouted.data_raw
        ? extractScoutedClimbLevel(scouted.data_raw)
        : null;
      if (scoutedClimbLevel === tbaClimbLevel) climbMatchCount++;
    }

    pastMatchCards.sort((a, b) => (b.estTime ?? 0) - (a.estTime ?? 0));
    nextMatchCards.sort((a, b) => (a.estTime ?? 0) - (b.estTime ?? 0));

    const climbAccuracy =
      climbTotalWithTbaData > 0
        ? (climbMatchCount / climbTotalWithTbaData) * 100
        : null;

    const profile = profileMap.get(uid);
    const settings = profile?.settings as { scouterRating?: number } | null | undefined;
    const rating = settings?.scouterRating ?? null;

    rows.push({
      uid,
      name: displayName,
      rating,
      matchesAssigned: assignedEntries.length,
      matchesScouted: scoutedByThisUser.length,
      climbAccuracy,
      pastMatches: pastMatchCards,
      nextMatches: nextMatchCards,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build team view rows.
 * Past match cards include TBA climb vs scouted climb comparison.
 */
export function buildTeamViewData(params: {
  schedule: ScheduleEntryInput[];
  matchData: MatchDataInput[];
  tbaTeams: TBATeamInput[];
  pitData: PitDataInput[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntryInput>>;
}): TeamViewRow[] {
  const { schedule, matchData, tbaTeams, pitData, tbaClimbData } = params;

  const pitMap = new Map<string, PitDataInput>();
  for (const p of pitData) pitMap.set(p.team, p);

  const tbaTeamMap = new Map<string, TBATeamInput>();
  for (const t of tbaTeams) tbaTeamMap.set(t.key, t);

  // Scouted data index by match+team (at most one submission per match+team)
  const scoutedByMatchTeam = new Map<string, MatchDataInput>();
  for (const m of matchData) {
    scoutedByMatchTeam.set(`${m.match}|${m.team}`, m);
  }

  const teamKeys = [...new Set(schedule.map((s) => s.team))];
  const rows: TeamViewRow[] = [];

  for (const teamKey of teamKeys) {
    const teamEntries = schedule.filter((s) => s.team === teamKey);
    const tbaTeam = tbaTeamMap.get(teamKey);
    const pit = pitMap.get(teamKey);

    const teamNumber = parseInt(teamKey?.replace("frc", ""), 10);
    const teamName = tbaTeam?.name ?? pit?.team_name ?? `Team ${teamNumber}`;
    const epa = tbaTeam?.epa?.total_points?.mean ?? null;
    const priority = (pit?.data?.priority as number | undefined) ?? null;

    const scoutedMatches = matchData.filter((m) => m.team === teamKey);

    const pastMatchCards: MatchCard[] = [];
    const nextMatchCards: MatchCard[] = [];

    for (const entry of teamEntries) {
      const isCompleted = entry.red_score != null || entry.blue_score != null;
      const scouted = scoutedByMatchTeam.get(`${entry.match}|${teamKey}`);

      const card: MatchCard = {
        matchKey: entry.match,
        matchDisplay: formatMatchKey(entry.match),
        team: entry.team,
        teamNumber,
        alliance: entry.alliance as "red" | "blue",
        estTime: entry.est_time ?? null,
        isCompleted,
        redScore: entry.red_score ?? null,
        blueScore: entry.blue_score ?? null,
        predictedRedScore: entry.predicted_red_score ?? null,
        predictedBlueScore: entry.predicted_blue_score ?? null,
        assignedScouterName: entry.name ?? null,
        assignedScouterUid: entry.uid ?? null,
        scoutedByName: scouted?.name ?? null,
        scoutedByUid: scouted?.uid ?? null,
        wasScouted: scouted != null,
      };

      if (isCompleted) {
        // Populate climb comparison for past matches
        const tbaClimb = tbaClimbData[entry.match]?.[teamKey];
        const tbaClimbLevel = tbaClimb?.teleop_climb ?? null;
        const scoutedClimbLevel = scouted?.data_raw
          ? extractScoutedClimbLevel(scouted.data_raw)
          : null;
        const climbMatch = tbaClimb
          ? scouted != null
            ? scoutedClimbLevel === tbaClimbLevel
            : null
          : null;

        card.scoutedClimbLevel = scoutedClimbLevel;
        card.tbaClimbLevel = tbaClimbLevel;
        card.climbMatch = climbMatch;

        pastMatchCards.push(card);
      } else {
        nextMatchCards.push(card);
      }
    }

    pastMatchCards.sort((a, b) => (b.estTime ?? 0) - (a.estTime ?? 0));
    nextMatchCards.sort((a, b) => (a.estTime ?? 0) - (b.estTime ?? 0));

    rows.push({
      teamKey,
      teamNumber,
      teamName,
      epa,
      matchesAssigned: teamEntries.length,
      matchesScouted: scoutedMatches.length,
      priority,
      pastMatches: pastMatchCards,
      nextMatches: nextMatchCards,
    });
  }

  return rows.sort((a, b) => a.teamNumber - b.teamNumber);
}
