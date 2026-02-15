/**
 * Fetches data and builds CycleInput for runCycle.
 */

import { getSchedule } from "@lib/data";
import { fetchAllUserDetails } from "@lib/supabase/user";
import type { CycleInput, Scouter } from "./cycle";

/** Sort match keys: qm1, qm2, ..., qmN, then sf1m1, sf2m1, ..., then f1m1, f1m2 */
function sortMatchKeys(matchKeys: string[]): string[] {
  const order = (mk: string): number[] => {
    if (mk.startsWith("qm")) {
      return [0, parseInt(mk.slice(2), 10) || 0];
    } 
    if (mk.startsWith("sf")) {
      const m = mk.match(/sf(\d+)m(\d+)/);
      return [1, m ? parseInt(m[1], 10) : 0, m ? parseInt(m[2], 10) : 0];
    }
    if (mk.startsWith("f")) {
      const m = mk.match(/f(\d+)m(\d+)/);
      return [2, m ? parseInt(m[1], 10) : 0, m ? parseInt(m[2], 10) : 0];
    }
    return [3, 0];
  };

  return [...matchKeys].sort((a, b) => {
    const oa = order(a);
    const ob = order(b);
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
