/**
 * Fetches data and builds CycleInput for runCycle.
 */

import { getSchedule } from "@lib/data";
import { fetchAllUserDetails } from "@lib/supabase/user";
import { getMatchSortOrder } from "@lib/utils/match";
import type { CycleInput, Scouter } from "./cycle";

function sortMatchKeys(matchKeys: string[]): string[] {
  return [...matchKeys].sort((a, b) => {
    const oa = getMatchSortOrder(a);
    const ob = getMatchSortOrder(b);
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
): Promise<CycleInput> {
  const [schedule, profiles] = await Promise.all([
    getSchedule(eventKey),
    fetchAllUserDetails(),
  ]);

  if (!profiles || !Array.isArray(profiles)) {
    throw new Error("Could not load scouters");
  }

  const scouters: Scouter[] = (profiles as { uid: string; name?: string; role?: string }[])
    .filter((p) => p.role === "scouter" || p.role === "lead")
    .map((p) => ({ uid: p.uid, name: p.name ?? undefined }));

  const rawMatchKeys = [...new Set((schedule as { match: string }[]).map((s) => s.match))];
  const matchKeys = sortMatchKeys(rawMatchKeys);

  const matchTeams = matchKeys.map((mk) =>
    (schedule as { match: string; team: string }[])
      .filter((s) => s.match === mk)
      .map((s) => s.team),
  );

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
