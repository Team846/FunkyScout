/**
 * Cycle logic for assigning scouters to teams in matches.
 * Ported from Python (ScouterManagerTest.py).
 *
 * Uses work/rest ratio and priority-sorted teams to distribute scouting shifts.
 */

export interface Scouter {
  uid: string;
  name?: string;
}

export interface CycleAssignment {
  uid: string;
  name?: string;
  teamKey: string;
  matchKey: string;
}

export interface CycleInput {
  /** Scouters to assign */
  scouters: Scouter[];
  /** matchTeams[matchIdx] = team keys in that match */
  matchTeams: string[][];
  /** teamPriority[matchIdx] = priority for each team (higher = scout first) */
  teamPriority: number[][];
  /** [w, r] work slots and rest slots per cycle */
  ratio: [number, number];
  /** matchKeys[matchIdx] = "qm1", "qm2", etc. Defaults to qm1, qm2, ... */
  matchKeys?: string[];
}

function assignGroups(n: number, w: number, r: number): number[] {
  const cycle = w + r;
  if (cycle <= 0) {
    throw new Error("Work + rest (w + r) must be positive");
  }
  const baseGroupSize = Math.floor(n / cycle);
  const remainder = n % cycle;

  if (baseGroupSize === 0) {
    return Array(n).fill(1);
  }

  return Array.from({ length: cycle }, (_, i) =>
    baseGroupSize + (i < remainder ? 1 : 0),
  );
}

type GroupAssignments = Map<string, number[]>;

function assignMatches(
  groupSizes: number[],
  w: number,
  r: number,
  totalMatches: number,
): GroupAssignments {
  const cycle = w + r;
  if (cycle <= 0) {
    throw new Error("Work + rest (w + r) must be positive");
  }

  const assignments: GroupAssignments = new Map();
  groupSizes.forEach((size, i) => {
    assignments.set(`${i + 1}-${size}`, []);
  });

  const groupKeys = Array.from(assignments.keys());

  for (let m = 1; m <= totalMatches; m++) {
    for (let gIdx = 0; gIdx < groupSizes.length; gIdx++) {
      const groupKey = groupKeys[gIdx];
      const matchList = assignments.get(groupKey)!;
      if ((m + gIdx) % cycle < w) {
        matchList.push(m);
      }
    }
  }

  return assignments;
}

function unpackAssignments(
  assignments: GroupAssignments,
): [number[], number[][]] {
  const scouterGroups: number[] = [];
  const matches: number[][] = [];

  assignments.forEach((matchList, key) => {
    const size = parseInt(key.split("-")[1], 10);
    scouterGroups.push(size);
    matches.push(matchList);
  });

  return [scouterGroups, matches];
}

function specifyGroups<T>(scouterGroups: number[], scouters: T[]): T[][] {
  if (scouterGroups.length === 0) {
    return [];
  }

  const grouped: T[][] = [];
  let groupIndex = 0;
  let groupNum = 0;

  for (const scouter of scouters) {
    if (groupIndex >= scouterGroups[groupNum]) {
      groupIndex = 0;
      groupNum += 1;
    }
    if (groupNum >= scouterGroups.length) {
      break;
    }
    if (grouped.length <= groupNum) {
      grouped.push([]);
    }
    grouped[groupNum].push(scouter);
    groupIndex += 1;
  }

  return grouped;
}

function sortMatchesByPriority(
  matchTeams: string[][],
  teamPriority: number[][],
): string[][] {
  if (teamPriority.length < matchTeams.length) {
    throw new Error(
      `team_priority must have at least as many entries as match_teams (${teamPriority.length} < ${matchTeams.length})`,
    );
  }

  return matchTeams.map((teams, matchIdx) => {
    const priority = teamPriority[matchIdx];
    const pairs = teams.map((team, i) => [team, priority[i]] as [string, number]);
    return pairs
      .sort((a, b) => b[1] - a[1])
      .map(([team]) => team);
  });
}

function specifyMatches(
  groupedScouters: Scouter[][],
  sortedMatches: string[][],
  matches: number[][],
  matchKeys: string[],
): CycleAssignment[] {
  const result: CycleAssignment[] = [];

  for (let groupIdx = 0; groupIdx < groupedScouters.length; groupIdx++) {
    if (groupIdx >= matches.length) break;

    const scouters = groupedScouters[groupIdx];
    const groupMatchList = matches[groupIdx];

    for (const scouter of scouters) {
      for (let matchIndex = 0; matchIndex < groupMatchList.length; matchIndex++) {
        const match = groupMatchList[matchIndex];
        if (match > sortedMatches.length) continue;

        const teamsAvailable = sortedMatches[match - 1];
        if (!teamsAvailable || teamsAvailable.length === 0) continue;

        const teamIdx = matchIndex % teamsAvailable.length;
        const team = teamsAvailable[teamIdx];
        const matchKey =
          matchKeys[match - 1] ?? `qm${match}`;

        result.push({
          uid: scouter.uid,
          name: scouter.name,
          teamKey: team,
          matchKey,
        });
      }
    }
  }

  return result;
}

function validateInputs(
  scouters: Scouter[],
  matchTeams: string[][],
  teamPriority: number[][],
  ratio: [number, number],
): void {
  const [w, r] = ratio;

  if (w <= 0 || r < 0) {
    throw new Error("Work (w) must be > 0 and rest (r) must be >= 0.");
  }

  if (matchTeams.length === 0) {
    throw new Error("No matches provided.");
  }

  if (scouters.length === 0) {
    throw new Error("No scouters provided.");
  }

  if (matchTeams.length !== teamPriority.length) {
    throw new Error(
      `Mismatch: ${matchTeams.length} matches but ${teamPriority.length} priority lists.`,
    );
  }

  for (let i = 0; i < matchTeams.length; i++) {
    const teams = matchTeams[i];
    const priorities = teamPriority[i];
    if (teams.length !== priorities.length) {
      throw new Error(
        `Match ${i + 1} has ${teams.length} teams but ${priorities.length} priority values.`,
      );
    }
  }
}

/**
 * Run the full cycle pipeline and return flat assignments.
 */
export function runCycle(input: CycleInput): CycleAssignment[] {
  const {
    scouters,
    matchTeams,
    teamPriority,
    ratio,
    matchKeys = matchTeams.map((_, i) => `qm${i + 1}`),
  } = input;

  validateInputs(scouters, matchTeams, teamPriority, ratio);

  const [w, r] = ratio;
  const totalMatches = matchTeams.length;

  const sizes = assignGroups(scouters.length, w, r);
  const assignments = assignMatches(sizes, w, r, totalMatches);
  const [scouterGroups, matches] = unpackAssignments(assignments);
  const groupedScouters = specifyGroups(scouterGroups, scouters);
  const sortedMatches = sortMatchesByPriority(matchTeams, teamPriority);

  return specifyMatches(groupedScouters, sortedMatches, matches, matchKeys);
}
