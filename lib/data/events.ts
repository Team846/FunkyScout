import supabase from "../supabase/supabase";
import { fetchTBAEventTeams } from "../tba/event";
import { refreshSchedule } from "./schedule";
import { getLocalEventList, cacheEventList } from "../db";

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

  if (eventError) throw eventError;

  // Cache locally
  await cacheEventList([
    {
      event: eventKey,
      alias: eventKey,
      date: `${year}-01-01`,
    },
  ]);

  // 2. Fetch teams from TBA → upsert event_team_data (guaranteed)
  const teams = await fetchTBAEventTeams(eventKey);
  if (!teams) throw new Error("Failed to fetch teams from TBA");

  // Store team key and team_name from TBA
  const rows = teams.map((t) => ({
    event: eventKey,
    team: t.key,
    team_name: t.name, // Team nickname from TBA
  }));
  const { error: teamsError } = await supabase
    .from("event_team_data")
    .upsert(rows, { onConflict: "event,team" });

  if (teamsError) throw teamsError;

  // 3. Try to refresh schedule (may not exist yet - that's OK)
  await refreshSchedule(eventKey);
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
