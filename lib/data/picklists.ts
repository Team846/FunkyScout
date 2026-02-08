/**
 * Picklist data fetching from Supabase
 * Follows the same pattern as schedule.ts and teams.ts
 */

import supabase from "../supabase/supabase";
import type { EventPicklist, EventPicklistEntry } from "./schema";

/**
 * Fetch all picklists for an event from Supabase
 * Returns picklists and their entries
 */
export async function getPicklists(
  eventKey: string,
): Promise<{
  picklists: EventPicklist[];
  entries: EventPicklistEntry[];
} | null> {
  try {
    // Fetch picklists
    const { data: picklists, error: picklistsError } = await supabase
      .from("event_picklist")
      .select("*")
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (picklistsError) {
      console.error("[getPicklists] Error fetching picklists:", picklistsError);
      return null;
    }

    if (!picklists || picklists.length === 0) {
      console.log(`[getPicklists] No picklists found for event ${eventKey}`);
      return { picklists: [], entries: [] };
    }

    // Fetch all entries for these picklists
    const picklistIds = picklists.map((p) => p.id);
    const { data: entries, error: entriesError } = await supabase
      .from("event_picklist_entries")
      .select("*")
      .eq("event", eventKey)
      .in("id", picklistIds)
      .is("deleted_at", null)
      .order("rank", { ascending: true });

    if (entriesError) {
      console.error(
        "[getPicklists] Error fetching picklist entries:",
        entriesError,
      );
      return null;
    }

    console.log(
      `[getPicklists] Fetched ${picklists.length} picklists with ${entries?.length || 0} entries for ${eventKey}`,
    );

    return {
      picklists: picklists as EventPicklist[],
      entries: (entries || []) as EventPicklistEntry[],
    };
  } catch (error) {
    console.error("[getPicklists] Unexpected error:", error);
    return null;
  }
}
