/**
 * Fetches data and builds CycleInput for runCycle.
 */

import { getSchedule } from "@lib/data";
import { fetchAllUserDetails } from "@lib/supabase/user";
import { getMatchSortOrder } from "@lib/utils/match";
import type { CycleInput, Scouter } from "./cycle";

function sortMatchKeys(matchKeys: string[]): string[] {
  // Sort the output of getMatchSortOrder
  // quals, then semis, then finals
  return [...matchKeys].sort((a, b) => {
    // get the ordered tuples for each match key
    const oa = getMatchSortOrder(a);
    const ob = getMatchSortOrder(b);
    // compare each element of tuple in order
    // e.g. [0, 2] vs [1, 1, 2] -> compare 0 vs 1 first, then 2 vs 1 if needed (its not)
    for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
      const d = (oa[i] ?? 0) - (ob[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/**
 * Fetch schedule, scouters, and build CycleInput.
 * Uses default priority 0 for all teams until team priorities are implemented.
 *
 * @param eventKey - Event key (e.g. "2025casf")
 * @param ratio - [w, r] work and rest slots
 * @param teamPriorityOverride - Optional. Map of "matchKey" -> { teamKey: priority }. Missing entries default to 0.
 */
export async function getCycleInput(
  eventKey: string,
  ratio: [number, number],
  teamPriorityOverride?: Record<string, Record<string, number>>,
): Promise<CycleInput> // get the schedule and the profiles
{
  const [schedule, profiles] = await Promise.all([
    getSchedule(eventKey),
    fetchAllUserDetails(),
  ]);

  // safety checks in case can't get data
  if (!profiles || !Array.isArray(profiles)) {
    throw new Error("Could not load scouters");
  }

  // filter profiles so that only scouters and leads are included
  const scouters: Scouter[] = (profiles as { uid: string; name?: string; role?: string }[])
    .filter((p) => p.role === "scouter" || p.role === "lead")
    .map((p) => ({ uid: p.uid, name: p.name ?? undefined }));

  // get unique match keys from the schedule and sort them
  const rawMatchKeys = [...new Set((schedule as { match: string }[]).map((s) => s.match))];
  const matchKeys = sortMatchKeys(rawMatchKeys);

  // for each match key, get the teams in that match
  const matchTeams = matchKeys.map((mk) =>
    (schedule as { match: string; team: string }[])
      .filter((s) => s.match === mk)
      .map((s) => s.team),
  );

  // finish team priority later, add overides for now just default to 0 for all teams
  const teamPriority = matchTeams.map((teams, matchIdx) => {
    const mk = matchKeys[matchIdx];
    const overrides = teamPriorityOverride?.[mk];
    return teams.map((team) => overrides?.[team] ?? 0);
  });

  return {
    scouters,
    matchTeams,
    teamPriority,
    ratio,
    matchKeys,
  };
}
