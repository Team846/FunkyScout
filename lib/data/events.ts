import supabase from "../supabase/supabase";
import { fetchTBAEventTeams } from "../tba/event";
import { refreshSchedule } from "./schedule";
import { bootstrapMatchData } from "./match-data";
import { getLocalEventList, cacheEventList } from "../db";
import { isTauri } from "../utils/platform";

/**
 * Bootstrap an event from TBA into Supabase.
 * Creates event_list entry and populates event_team_data with teams.
 * Attempts to refresh schedule (may not exist yet for future events).
 */
export async function bootstrapEvent(eventKey: string) {
  // 1. Upsert event_list (guaranteed)
  // Extract year from event key (e.g., "2025cada" → "2025")
  const year = eventKey.slice(0, 4);

  const { error: eventError } = await supabase.from("event_list").upsert({
    event: eventKey,
    alias: eventKey,
    date: `${year}-01-01`, // Placeholder date, can be updated later
  });

  if (eventError) {
    console.error(`[Bootstrap] Failed to create event_list entry:`, eventError);
    throw eventError;
  }

  // Cache locally (skip for Tauri - backend handles caching)
  if (!isTauri()) {
    try {
      await cacheEventList([
        {
          event: eventKey,
          alias: eventKey,
          date: `${year}-01-01`,
        },
      ]);
    } catch (e) {
      // Silently fail cache - desktop doesn't need it
      console.warn("[Bootstrap] Cache failed (expected for desktop):", e);
    }
  }

  // 2. Fetch teams from TBA → upsert event_team_data (guaranteed)
  const teams = await fetchTBAEventTeams(eventKey);

  if (!teams) {
    throw new Error(
      `Failed to fetch teams from TBA for event "${eventKey}".\n\n` +
      `Possible reasons:\n` +
      `• Event doesn't exist on The Blue Alliance yet\n` +
      `• Event code is incorrect (check spelling and year)\n` +
      `• TBA API is temporarily unavailable\n` +
      `• Network connectivity issue\n\n` +
      `Check the console logs for more details.`
    );
  }

  // Fetch existing event_team_data to preserve pit scouting — never overwrite with {}
  const { data: existingRows } = await supabase
    .from("event_team_data")
    .select("team, data")
    .eq("event", eventKey);

  const existingByTeam = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    const team = row?.team as string;
    const data = row?.data;
    if (team && data && typeof data === "object" && !Array.isArray(data)) {
      existingByTeam.set(team, data as Record<string, unknown>);
    }
  }

  // Upsert: preserve existing pit scouting for existing teams, use {} only for new teams
  const rows = teams.map((t) => ({
    event: eventKey,
    team: t.key,
    team_name: t.name, // Team nickname from TBA
    data: existingByTeam.get(t.key) ?? {}, // Preserve pit scouting; empty only for new teams
  }));
  const { error: teamsError } = await supabase
    .from("event_team_data")
    .upsert(rows, { onConflict: "event,team" });

  if (teamsError) {
    console.error(`[Bootstrap] Failed to upsert teams:`, teamsError);
    throw teamsError;
  }

  // 3. Try to refresh schedule (may not exist yet - that's OK)
  await refreshSchedule(eventKey);

  // 4. Bootstrap match data from schedule (creates placeholder rows)
  await bootstrapMatchData(eventKey);
}

/**
 * Get all events from Supabase, with local cache fallback.
 */
export async function getEvents() {
  const cached = await getLocalEventList();

  if (!navigator.onLine) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from("event_list")
      .select("*")
      .is("deleted_at", null)
      .order("date", { ascending: false });

    if (error) throw error;

    if (data) {
      await cacheEventList(
        data.map((d) => ({
          event: d.event,
          alias: d.alias,
          date: d.date,
          deleted_at: d.deleted_at ? Date.parse(d.deleted_at) : undefined,
        })),
      );
    }

    return data;
  } catch (e) {
    console.warn("[Events] Supabase fetch failed, using local cache:", e);
    return cached;
  }
}

export async function getEventByKey(eventKey: string) {
  if (!navigator.onLine) {
    const cached = await getLocalEventList();
    return cached.find((e) => e.event === eventKey) || null;
  }

  try {
    const { data, error } = await supabase
      .from("event_list")
      .select("*")
      .eq("event", eventKey)
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    const cached = await getLocalEventList();
    return cached.find((e) => e.event === eventKey) || null;
  }
}

/**
 * Sync team names from TBA to Supabase.
 * Updates team_name field without touching pit scouting data.
 * Similar to how EPA is synced - separate from pit scouting.
 */
export async function syncTeamNames(eventKey: string) {
  const teams = await fetchTBAEventTeams(eventKey);

  if (!teams) {
    console.warn(`[SyncTeamNames] Failed to fetch teams from TBA for ${eventKey}`);
    return;
  }

  // For each team, update ONLY the team_name field, preserving all other data
  for (const team of teams) {
    const { error } = await supabase
      .from("event_team_data")
      .update({ team_name: team.name })
      .eq("event", eventKey)
      .eq("team", team.key);

    if (error) {
      console.error(`[SyncTeamNames] Failed to update team_name for ${team.key}:`, error);
    }
  }

  console.log(`[SyncTeamNames] Updated ${teams.length} team names for ${eventKey}`);
}
