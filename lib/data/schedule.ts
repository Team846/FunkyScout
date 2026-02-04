import supabase from "../supabase/supabase";
import { fetchTBAMatchSchedule } from "../tba/event";
import type { Alliance } from "./schema";

/**
 * Refresh schedule from TBA.
 * If schedule doesn't exist yet (future event), silently returns.
 * Also performs B-team reconciliation: adds any teams from schedule not in roster.
 */
export async function refreshSchedule(eventKey: string) {
  const schedule = await fetchTBAMatchSchedule(eventKey);

  // Schedule not available yet - silently return (this is expected)
  if (!schedule || Object.keys(schedule).length === 0) return;

  // B-team reconciliation: add teams from schedule not in roster
  const allTeams = new Set<string>();
  Object.values(schedule).forEach((match) => {
    [...match.redTeams, ...match.blueTeams].forEach((t) => allTeams.add(t));
  });

  const { error: teamError } = await supabase.from("event_team_data").upsert(
    [...allTeams].map((team) => ({ event: eventKey, team })),
    { onConflict: "event,team", ignoreDuplicates: true }
  );

  if (teamError) throw teamError;

  // Upsert schedule rows
  const rows: {
    event: string;
    match: string;
    team: string;
    alliance: Alliance;
  }[] = [];

  for (const [matchKey, match] of Object.entries(schedule)) {
    match.redTeams.forEach((team) =>
      rows.push({ event: eventKey, match: matchKey, team, alliance: "red" })
    );
    match.blueTeams.forEach((team) =>
      rows.push({ event: eventKey, match: matchKey, team, alliance: "blue" })
    );
  }

  const { error: scheduleError } = await supabase
    .from("event_schedule")
    .upsert(rows, { onConflict: "event,match,team" });

  if (scheduleError) throw scheduleError;
}

/**
 * Get match schedule for an event.
 * Returns empty array if no schedule exists yet.
 */
export async function getSchedule(eventKey: string) {
  const { data, error } = await supabase
    .from("event_schedule")
    .select("*")
    .eq("event", eventKey)
    .is("deleted_at", null);

  if (error) throw error;
  return data ?? [];
}
