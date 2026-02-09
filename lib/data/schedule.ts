import supabase from "../supabase/supabase";
import { fetchTBAMatchSchedule } from "../tba/event";
import type { Alliance } from "./schema";
import { getEventSchedule, cacheEventSchedule } from "../db";

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
    { onConflict: "event,team", ignoreDuplicates: true },
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
      rows.push({ event: eventKey, match: matchKey, team, alliance: "red" }),
    );
    match.blueTeams.forEach((team) =>
      rows.push({ event: eventKey, match: matchKey, team, alliance: "blue" }),
    );
  }

  const { error: scheduleError } = await supabase
    .from("event_schedule")
    .upsert(rows, { onConflict: "event,match,team" });

  if (scheduleError) throw scheduleError;
}

/**
 * Get match schedule for an event with local fallback.
 */
export async function getSchedule(eventKey: string) {
  const cached = await getEventSchedule(eventKey);

  if (!navigator.onLine) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from("event_schedule")
      .select(`
        event,
        match,
        team,
        alliance,
        name,
        uid,
        last_modified,
        deleted_at,
        est_time,
        red_score,
        blue_score,
        red_win_prob,
        predicted_red_score,
        predicted_blue_score
      `)
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (error) throw error;

    console.log(`[Schedule] Fetched ${data?.length ?? 0} schedule entries from Supabase`);
    if (data && data.length > 0) {
      console.log('[Schedule] Sample entry:', data[0]);
      const entriesWithNames = data.filter(d => d.name).length;
      console.log(`[Schedule] ${entriesWithNames} entries have name field (shift assignments)`);
    }

    if (data) {
      await cacheEventSchedule(
        data.map((d) => ({
          event: d.event,
          match: d.match,
          team: d.team,
          alliance: d.alliance as "red" | "blue",
          name: d.name,
          uid: d.uid,
          // Convert PostgreSQL timestamps to epoch milliseconds for SQLite
          last_modified: d.last_modified ? new Date(d.last_modified).getTime() : undefined,
          deleted_at: d.deleted_at ? new Date(d.deleted_at).getTime() : undefined,
          // Match data from desktop sync
          est_time: d.est_time,
          red_score: d.red_score,
          blue_score: d.blue_score,
          red_win_prob: d.red_win_prob,
          predicted_red_score: d.predicted_red_score,
          predicted_blue_score: d.predicted_blue_score,
        })),
      );
      console.log(`[Schedule] Cached ${data.length} entries to local SQLite`);
    }

    return data ?? [];
  } catch (e) {
    console.warn("[Schedule] Supabase fetch failed, using local cache:", e);
    return cached;
  }
}
