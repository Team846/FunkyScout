import supabase from "../supabase/supabase";
import { cacheEventMatchData } from "../db";

/**
 * Bootstrap event_match_data from event_schedule.
 * Creates placeholder rows for every match-team combination.
 * Called after refreshSchedule() during event setup.
 */
/**
 * Sync shift assignments from event_schedule to event_match_data.
 * Called when schedule assignments are updated.
 */
export async function syncShiftAssignments(eventKey: string) {
  // Get all schedule entries with their assignments
  const { data: scheduleData, error: scheduleError } = await supabase
    .from("event_schedule")
    .select("event, match, team, alliance, name, uid")
    .eq("event", eventKey)
    .is("deleted_at", null);

  if (scheduleError) throw scheduleError;
  if (!scheduleData || scheduleData.length === 0) return;

  // Update match data with shift assignments
  // Include data_raw to satisfy NOT NULL constraint (in case row doesn't exist yet)
  const updates = scheduleData.map((entry) => ({
    event: entry.event,
    match: entry.match,
    team: entry.team,
    alliance: entry.alliance as "red" | "blue",
    name: entry.name || "",
    uid: entry.uid || "",
    data_raw: {},  // Empty placeholder (required for upsert)
    data: {},      // Empty placeholder (required for upsert)
  }));

  const { error: updateError } = await supabase
    .from("event_match_data")
    .upsert(updates, {
      onConflict: "event,match,team",
      ignoreDuplicates: false // Always update
    });

  if (updateError) throw updateError;
}

export async function bootstrapMatchData(eventKey: string) {
  // Get schedule from Supabase (source of truth)
  const { data: scheduleData, error: scheduleError } = await supabase
    .from("event_schedule")
    .select("event, match, team, alliance, name, uid")
    .eq("event", eventKey)
    .is("deleted_at", null);

  if (scheduleError) throw scheduleError;

  if (!scheduleData || scheduleData.length === 0) {
    return; // No schedule yet - skip bootstrap
  }

  // Check if match data already exists
  const { data: existingData, error: checkError } = await supabase
    .from("event_match_data")
    .select("event, match, team")
    .eq("event", eventKey)
    .is("deleted_at", null)
    .limit(1);

  if (checkError) throw checkError;

  if (existingData && existingData.length > 0) {
    return; // Already bootstrapped
  }

  // Create placeholder rows with empty data_raw and data
  const rows = scheduleData.map((entry) => ({
    event: entry.event,
    match: entry.match,
    team: entry.team,
    alliance: entry.alliance,
    name: entry.name || "",  // Copy from schedule or empty string if not assigned
    uid: entry.uid || "",    // Copy from schedule or empty string if not assigned
    data_raw: {},            // Empty placeholder
    data: {},                // Empty object (column has NOT NULL constraint)
    // timestamp left null until actually scouted
  }));

  const { error: insertError } = await supabase
    .from("event_match_data")
    .upsert(rows, { onConflict: "event,match,team" });

  if (insertError) throw insertError;
}

/**
 * Fetch event_match_data from Supabase and cache locally.
 * Similar to getSchedule() pattern.
 */
export async function getMatchData(eventKey: string) {
  try {
    const { data, error } = await supabase
      .from("event_match_data")
      .select(`
        event,
        match,
        team,
        alliance,
        data_raw,
        data,
        name,
        uid,
        timestamp,
        last_modified,
        deleted_at
      `)
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (error) throw error;

    if (data) {
      await cacheEventMatchData(
        eventKey,
        data.map((d) => ({
          event: d.event,
          match: d.match,
          team: d.team,
          alliance: d.alliance as "red" | "blue",
          data_raw: d.data_raw,
          data: d.data,
          name: d.name,
          uid: d.uid,
          timestamp: d.timestamp,
          // Convert PostgreSQL timestamps to epoch milliseconds for SQLite
          last_modified: d.last_modified ? new Date(d.last_modified).getTime() : undefined,
          deleted_at: d.deleted_at ? new Date(d.deleted_at).getTime() : undefined,
        })),
      );
    }

    return data ?? [];
  } catch (e) {
    console.warn("[MatchData] Supabase fetch failed:", e);
    return [];
  }
}
