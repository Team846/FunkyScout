/**
 * Picklist data fetching from Supabase
 * Follows the same pattern as schedule.ts and teams.ts
 */

import supabase from "../supabase/supabase";
import type { EventPicklist } from "./schema";
import { upsertEventPicklistsRows } from "../db";

const picklistSyncKey = (event: string) => `lastPicklistSync_${event}`;
const picklistFullSyncKey = (event: string) => `lastPicklistFullSync_${event}`;

// 5-minute lookback buffer absorbs clock skew and most partial-fetch gaps
const CLOCK_SKEW_BUFFER_MS = 5 * 60 * 1000;
// Periodic full-fetch heal: re-fetch everything every 30 minutes to catch any rows
// that slipped through partial incremental fetches during spotty connectivity
const FULL_HEAL_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Fetch all picklists for an event from Supabase and upsert into local cache.
 *
 * Incremental sync: after the first fetch, only rows with last_modified >=
 * last sync time are fetched (5-minute clock-skew buffer).
 *
 * Every 30 minutes a full-fetch heal is forced regardless of the incremental
 * sync key, to recover rows missed during partial fetches on spotty connections.
 *
 * Entries are now embedded in the picklist row's `picklist` JSONB column —
 * no separate event_picklist_entries query is needed.
 *
 * Returns `isIncremental` so the caller can decide whether to do a full cache
 * replace (full load) or skip caching (incremental — already done internally).
 */
export async function getPicklists(
  eventKey: string,
): Promise<{ picklists: EventPicklist[]; isIncremental: boolean } | null> {
  // If it's been > 30 min since the last full load, force one to heal any gaps
  const lastFullSyncStr = localStorage.getItem(picklistFullSyncKey(eventKey));
  const needsFullHeal = lastFullSyncStr
    ? Date.now() - new Date(lastFullSyncStr).getTime() > FULL_HEAL_INTERVAL_MS
    : false;
  if (needsFullHeal) {
    localStorage.removeItem(picklistSyncKey(eventKey));
    console.log(`[getPicklists] Full-heal triggered for ${eventKey}`);
  }

  const lastSyncStr = localStorage.getItem(picklistSyncKey(eventKey));
  const isIncremental = !!lastSyncStr;
  const cutoffISO = isIncremental
    ? new Date(new Date(lastSyncStr!).getTime() - CLOCK_SKEW_BUFFER_MS).toISOString()
    : null;

  try {
    // Fetch picklist headers (with embedded entries in picklist column)
    let query = supabase
      .from("event_picklist")
      .select("*")
      .eq("event", eventKey);

    if (isIncremental) {
      // Include soft-deleted headers so deletions propagate to local cache
      query = query.gte("last_modified", cutoffISO!);
    } else {
      query = query.is("deleted_at", null);
    }

    const { data: picklists, error: picklistsError } = await query;

    if (picklistsError) {
      console.error("[getPicklists] Error fetching picklists:", picklistsError);
      return null;
    }

    if (!picklists || picklists.length === 0) {
      if (!isIncremental) {
        console.log(`[getPicklists] No picklists found for event ${eventKey}`);
        // Don't advance sync key on a full fetch with 0 results — next poll should
        // also be a full fetch. This handles auth hiccups at startup that return 0
        // rows and would otherwise cause subsequent incremental syncs to miss data
        // uploaded before this window.
      } else {
        // Incremental with 0 results is normal (nothing changed) — advance the key
        localStorage.setItem(picklistSyncKey(eventKey), new Date().toISOString());
      }
      return { picklists: [], isIncremental };
    }

    // --- Update local cache for incremental syncs ---
    // Convert Supabase ISO timestamps → epoch ms for WASM SQLite INTEGER columns,
    // then upsert only changed rows (preserves unmodified local rows).
    // Full-load caching (cacheEventPicklists) is handled by the caller.
    if (isIncremental && picklists.length > 0) {
      const converted = picklists.map((p: any) => ({
        ...p,
        // picklist JSONB is already a JS array from the Supabase client
        timestamp: p.timestamp ? new Date(p.timestamp).getTime() : undefined,
        last_modified: p.last_modified
          ? new Date(p.last_modified).getTime()
          : undefined,
        deleted_at: p.deleted_at ? new Date(p.deleted_at).getTime() : undefined,
      }));
      await upsertEventPicklistsRows(eventKey, converted);
      console.log(
        `[getPicklists] Incremental: ${picklists.length} picklists upserted to cache`,
      );
    }

    localStorage.setItem(picklistSyncKey(eventKey), new Date().toISOString());
    // Record when the last full load completed so the heal timer resets correctly
    if (!isIncremental) {
      localStorage.setItem(picklistFullSyncKey(eventKey), new Date().toISOString());
    }

    return {
      picklists: (picklists || []) as EventPicklist[],
      isIncremental,
    };
  } catch (error) {
    console.error("[getPicklists] Unexpected error:", error);
    return null;
  }
}
