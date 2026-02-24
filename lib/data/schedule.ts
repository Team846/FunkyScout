import supabase from "../supabase/supabase";
import { fetchTBAMatchSchedule } from "../tba/event";
import type { Alliance } from "./schema";
import { getEventSchedule, cacheEventSchedule, upsertEventScheduleRows } from "../db";

const scheduleSyncKey = (event: string) => `lastScheduleSync_${event}`;

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
 *
 * Incremental sync: after the first fetch, only rows with last_modified >=
 * last sync time are fetched (1-minute clock-skew buffer). Changed rows are
 * upserted into local cache without clearing existing rows.
 */
export async function getSchedule(eventKey: string) {
  const cached = await getEventSchedule(eventKey);

  if (!navigator.onLine) {
    return cached;
  }

  const lastSyncStr = localStorage.getItem(scheduleSyncKey(eventKey));
  const isIncremental = !!lastSyncStr;
  const cutoffISO = isIncremental
    ? new Date(new Date(lastSyncStr!).getTime() - 60_000).toISOString()
    : null;

  try {
    let query = supabase
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

    if (isIncremental) {
      query = query.gte("last_modified", cutoffISO!);
    }

    const { data, error } = await query;
    if (error) throw error;

    const processed = (data ?? []).map((d) => ({
      event: d.event,
      match: d.match,
      team: d.team,
      alliance: d.alliance as "red" | "blue",
      name: d.name,
      uid: d.uid,
      last_modified: d.last_modified ? new Date(d.last_modified).getTime() : undefined,
      deleted_at: d.deleted_at ? new Date(d.deleted_at).getTime() : undefined,
      est_time: d.est_time,
      red_score: d.red_score,
      blue_score: d.blue_score,
      red_win_prob: d.red_win_prob,
      predicted_red_score: d.predicted_red_score,
      predicted_blue_score: d.predicted_blue_score,
    }));

    if (isIncremental) {
      if (processed.length > 0) {
        await upsertEventScheduleRows(eventKey, processed);
        console.log(`[Schedule] Incremental: upserted ${processed.length} changed rows`);
      }
    } else {
      await cacheEventSchedule(eventKey, processed);
      console.log(`[Schedule] Full load: cached ${processed.length} rows`);
    }

    // Only advance the sync key if:
    // - We're already in incremental mode (0 results is normal — nothing changed), OR
    // - The full fetch actually returned rows (proves Supabase is accessible/authorized).
    // If a full fetch returns 0 rows (e.g. auth hiccup at startup), keep the key unset
    // so the next poll also does a full fetch instead of incremental that would miss data
    // uploaded before this window.
    if (isIncremental || processed.length > 0) {
      localStorage.setItem(scheduleSyncKey(eventKey), new Date().toISOString());
    }

    // Always return the full local cache so callers get the complete schedule,
    // not just the partial incremental subset from this fetch.
    return getEventSchedule(eventKey);
  } catch (e) {
    console.warn("[Schedule] Supabase fetch failed, using local cache:", e);
    return cached;
  }
}
