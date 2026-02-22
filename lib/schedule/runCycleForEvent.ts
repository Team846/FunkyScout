/**
 * Runs the full cycle for an event: fetch input, run cycle logic, return assignments.
 * Add writing (assignShiftMatch or Edge Function) here when ready.
 */

import { getCycleInput } from "./getCycleInput";
import { runCycle, type CycleAssignment, type Scouter } from "./cycle";

/**
 * Get schedule + scouters, run cycle, return assignments.
 * Does not write to DB yet — use the returned assignments in your UI or Edge Function.
 *
 * @param eventKey - Event key (e.g. "2025casf")
 * @param ratio - [w, r] work and rest slots
 * @param scoutersOverride - If provided, use these scouters instead of fetching all from DB.
 * @param teamPriorityOverride - Optional. Per-match, per-team priority (default 0).
 */
export async function runCycleForEvent(
  eventKey: string,
  ratio: [number, number],
  scoutersOverride?: Scouter[],
  teamPriorityOverride?: Record<string, Record<string, number>>,
): Promise<CycleAssignment[]> {
  const input = await getCycleInput(eventKey, ratio, scoutersOverride, teamPriorityOverride);
  return runCycle(input);
}
