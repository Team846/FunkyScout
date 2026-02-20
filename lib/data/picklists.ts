/**
 * Picklist data fetching from Supabase
 * Follows the same pattern as schedule.ts and teams.ts
 */

import supabase from "../supabase/supabase";
import type { EventPicklist, EventPicklistEntry } from "./schema";
import { upsertEventPicklistsRows, upsertEventPicklistEntriesRows } from "../db";

const picklistSyncKey = (event: string) => `lastPicklistSync_${event}`;

/**
 * Fetch all picklists for an event from Supabase and upsert into local cache.
 *
 * Incremental sync: after the first fetch, only rows with last_modified >=
 * last sync time are fetched (1-minute clock-skew buffer). Both the picklist
 * headers and entries use the same cutoff timestamp.
 *
 * Soft-delete propagation: incremental entry fetches omit the deleted_at filter
 * so that removed entries are written to local cache with their deleted_at set.
 *
 * Note: this function returns what Supabase returned (which may be a partial set
 * in incremental mode). Callers in CompetitionDataContext use the return value
 * only for caching — UI reads come from the local SQLite cache.
 */
export async function getPicklists(
  eventKey: string,
): Promise<{
  picklists: EventPicklist[];
  entries: EventPicklistEntry[];
} | null> {
  const lastSyncStr = localStorage.getItem(picklistSyncKey(eventKey));
  const isIncremental = !!lastSyncStr;
  const cutoffISO = isIncremental
    ? new Date(new Date(lastSyncStr!).getTime() - 60_000).toISOString()
    : null;

  try {
    // --- Fetch picklist headers ---
    let headerQuery = supabase
      .from("event_picklist")
      .select("*")
      .eq("event", eventKey);

    if (isIncremental) {
      // Include soft-deleted headers so deletions propagate to local cache
      headerQuery = headerQuery.gte("last_modified", cutoffISO!);
    } else {
      headerQuery = headerQuery.is("deleted_at", null);
    }

    const { data: picklists, error: picklistsError } = await headerQuery;

    if (picklistsError) {
      console.error("[getPicklists] Error fetching picklists:", picklistsError);
      return null;
    }

    // --- Fetch picklist entries ---
    // For incremental: filter by last_modified on the entire event's entries table
    // (cheaper than fetching by changed picklist IDs)
    let entriesQuery = supabase
      .from("event_picklist_entries")
      .select("*")
      .eq("event", eventKey)
      .order("rank", { ascending: true });

    if (isIncremental) {
      // Include soft-deleted entries so removals propagate to local cache
      entriesQuery = entriesQuery.gte("last_modified", cutoffISO!);
    } else {
      // Full load: only active entries (safe since cache will be fully replaced by caller)
      entriesQuery = entriesQuery.is("deleted_at", null);

      // Scope to IDs returned by the header query
      if (picklists && picklists.length > 0) {
        entriesQuery = entriesQuery.in("id", picklists.map((p) => p.id));
      } else {
        // No picklists at all — skip entries fetch
        console.log(`[getPicklists] No picklists found for event ${eventKey}`);
        localStorage.setItem(picklistSyncKey(eventKey), new Date().toISOString());
        return { picklists: [], entries: [] };
      }
    }

    const { data: entries, error: entriesError } = await entriesQuery;

    if (entriesError) {
      console.error("[getPicklists] Error fetching entries:", entriesError);
      return null;
    }

    // --- Update local cache ---
    if (isIncremental) {
      // Upsert only changed rows — preserves unmodified local rows
      if (picklists && picklists.length > 0) {
        await upsertEventPicklistsRows(eventKey, picklists as EventPicklist[]);
      }
      if (entries && entries.length > 0) {
        await upsertEventPicklistEntriesRows(eventKey, entries as EventPicklistEntry[]);
      }
      console.log(
        `[getPicklists] Incremental: ${picklists?.length ?? 0} picklists, ${entries?.length ?? 0} entries changed`,
      );
    }
    // Note: full-load caching is handled by the caller (CompetitionDataContext)
    // via cacheEventPicklists / cacheEventPicklistEntries — we just return the data.

    localStorage.setItem(picklistSyncKey(eventKey), new Date().toISOString());

    return {
      picklists: (picklists || []) as EventPicklist[],
      entries: (entries || []) as EventPicklistEntry[],
    };
  } catch (error) {
    console.error("[getPicklists] Unexpected error:", error);
    return null;
  }
}
