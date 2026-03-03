/**
 * Write operations with offline-first pattern
 *
 * Desktop (Tauri):
 * 1. Write to local Tauri SQLite cache immediately (optimistic update)
 * 2. Queue operation in Tauri sync_queue table
 * 3. Rust background service syncs to Supabase every 30s
 *
 * Mobile (Web):
 * 1. Write to local WASM SQLite cache immediately (optimistic update)
 * 2. Queue the operation in IndexedDB for background sync
 * 3. Trigger instant sync if online (for immediate collaboration)
 * 4. Return immediately (non-blocking)
 */

import {
  addToSyncQueue,
  upsertEventMatchDataRows,
  cacheEventSchedule,
  insertPicklistToCache,
  updatePicklistCache,
  upsertEventTeamDataRows,
  softDeletePicklistCache,
  getEventSchedule,
  getEventMatchData,
  getTbaTeams,
  type EventTeamData,
  type EventMatchData,
  type EventScheduleEntry,
  type EventPicklist,
} from "@lib/db";
import type { CycleAssignment } from "@lib/schedule/cycle";
import { addToImageQueue } from "@lib/storage/imageQueue";
import { compressImage } from "@lib/utils/imageCompression";
import { isTauri } from "@lib/utils/platform";
import supabase from "@lib/supabase/supabase";

/**
 * Get user's JWT token for desktop sync operations
 * Returns null if not authenticated or on mobile
 */
async function getUserJWT(): Promise<string | null> {
  if (!isTauri()) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Global sync trigger - set by SyncContext
 * Allows write operations to trigger instant sync without React context
 */
let globalSyncTrigger: (() => Promise<void>) | null = null;

export function setGlobalSyncTrigger(trigger: () => Promise<void>) {
  globalSyncTrigger = trigger;
}

/**
 * Desktop-only global refresh callbacks
 * Set by the desktop data contexts so that local SQLite writes (deleteMatchData,
 * putTeamData, setTeamPriority, assignShiftsFromCycle, etc.) immediately reflect
 * in the UI without waiting for the realtime callback (~7s) or 120s sync cycle.
 *
 * Each callback re-reads the corresponding SQLite tables and updates React state.
 */
let globalDesktopCompetitionRefresh: (() => void) | null = null;
let globalDesktopTeamRefresh: (() => void) | null = null;

export function setDesktopCompetitionRefresh(cb: (() => void) | null) {
  globalDesktopCompetitionRefresh = cb;
}
export function setDesktopTeamRefresh(cb: (() => void) | null) {
  globalDesktopTeamRefresh = cb;
}

/**
 * Trigger instant sync if online
 * Fire-and-forget - errors are logged but don't block the write
 */
async function triggerInstantSync() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  if (!globalSyncTrigger) return;

  try {
    await globalSyncTrigger();
  } catch (error) {
    console.error("[Writes] Instant sync failed:", error);
    // Don't throw - write already succeeded locally
  }
}

/**
 * Put team data (pit scouting)
 * Writes to local SQLite first, then queues for sync
 */
export async function putTeamData(
  eventKey: string,
  teamNumber: string,
  data: any,
  options?: {
    teamName?: string;
    name?: string;
    uid?: string;
  },
): Promise<void> {
  // Validate team exists in TBA for this event
  const tbaTeams = await getTbaTeams(eventKey);
  const teamExists = tbaTeams.some((t) => t.team_key === teamNumber);

  if (!teamExists) {
    throw new Error(
      `Team ${teamNumber} is not registered for event ${eventKey}`,
    );
  }

  const now = Date.now();

  if (isTauri()) {
    // DESKTOP: Use Tauri commands
    const { invoke } = await import("@tauri-apps/api/core");

    const teamData = {
      event: eventKey,
      team: teamNumber,
      data: data,
      team_name: options?.teamName,
      name: options?.name,
      uid: options?.uid,
      timestamp: now,
      last_modified: now,
      deleted_at: null,
    };

    // 1. Cache locally (Tauri SQLite) — upsert one row, preserves other teams
    await invoke("cache_pit_scouting_data", { data: [teamData] });
    globalDesktopTeamRefresh?.();

    // 2. Add to sync queue
    await invoke("add_to_sync_queue", {
      operation: "PUT_TEAM_DATA",
      payload: {
        event: eventKey,
        team: teamNumber,
        data: data,
        teamName: options?.teamName,
        name: options?.name,
        uid: options?.uid,
        timestamp: now,
      },
    });

    console.log(`[Writes] Desktop: Queued team data for ${teamNumber} in ${eventKey}`);

    // 3. Trigger instant sync (fire-and-forget)
    invoke("trigger_sync_now").catch((e) => {
      console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
    });

    return;
  }

  // MOBILE: Use WASM SQLite
  const teamData: EventTeamData = {
    event: eventKey,
    team: teamNumber,
    data: data,
    team_name: options?.teamName,
    name: options?.name,
    uid: options?.uid,
    timestamp: now,
    last_modified: now,
  };

  // 1. Write to local SQLite immediately (optimistic) — use upsert, NOT cacheEventTeamData,
  //    which would DELETE all teams and insert one (wiping others from local cache)
  await upsertEventTeamDataRows(eventKey, [teamData]);

  // 2. Queue for background sync
  await addToSyncQueue("PUT_TEAM_DATA", {
    event: eventKey,
    team: teamNumber,
    data: data,
    teamName: options?.teamName,
    name: options?.name,
    uid: options?.uid,
    timestamp: now,
  });

  console.log(`[Writes] Mobile: Queued team data for ${teamNumber} in ${eventKey}`);

  // 3. Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Put match data (match scouting)
 * Writes to local SQLite first, then queues for sync
 */
export async function putMatchData(
  eventKey: string,
  matchNumber: string,
  teamNumber: string,
  dataRaw: any,
  uid: string,
  alliance: "red" | "blue",
  options?: {
    name?: string;
  },
): Promise<void> {
  // Validate alliance is provided and valid
  if (!alliance || (alliance !== "red" && alliance !== "blue")) {
    throw new Error(
      `Alliance is required for match data. Received: ${alliance}. ` +
      `This likely means the team's alliance was not properly determined from the schedule. ` +
      `Match: ${matchNumber}, Team: ${teamNumber}`
    );
  }

  const now = Date.now();

  if (isTauri()) {
    // DESKTOP: Use Tauri commands
    const { invoke } = await import("@tauri-apps/api/core");

    const matchData = {
      event: eventKey,
      match: matchNumber,
      team: teamNumber,
      alliance: alliance,
      data_raw: dataRaw,
      data: null, // unused field
      name: options?.name,
      uid: uid,
      timestamp: now,
      last_modified: now,
      deleted_at: null,
    };

    // 1. Cache locally (Tauri SQLite)
    await invoke("cache_match_scouting_data", { data: [matchData] });
    globalDesktopCompetitionRefresh?.();

    // 2. Add to sync queue (include user JWT so Rust can write to Supabase with auth)
    const user_jwt = await getUserJWT();
    await invoke("add_to_sync_queue", {
      operation: "PUT_MATCH_DATA",
      payload: {
        event: eventKey,
        match: matchNumber,
        team: teamNumber,
        alliance: alliance,
        dataRaw: dataRaw,
        ...(options?.name ? { name: options.name } : {}), // Only include if defined
        uid: uid,
        timestamp: now,
        user_jwt,
      },
    });

    console.log(`[Writes] Desktop: Queued match data for ${teamNumber} in match ${matchNumber}`);

    // 3. Trigger instant sync (fire-and-forget)
    invoke("trigger_sync_now").catch((e) => {
      console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
    });

    return;
  }

  // MOBILE: Use WASM SQLite
  const matchData: EventMatchData = {
    event: eventKey,
    match: matchNumber,
    team: teamNumber,
    alliance: alliance,
    data_raw: dataRaw,
    data: null, // unused field
    name: options?.name, // Local cache can have undefined
    uid: uid,
    timestamp: now,
    last_modified: now,
  };

  // 1. Write to local SQLite — use upsertEventMatchDataRows (not cacheEventMatchData)
  //    to avoid wiping all other event match data before reinserting just this one row
  await upsertEventMatchDataRows(eventKey, [matchData]);

  // 2. Queue for sync - CRITICAL: Only include name if defined to prevent null overwrites
  await addToSyncQueue("PUT_MATCH_DATA", {
    event: eventKey,
    match: matchNumber,
    team: teamNumber,
    alliance: alliance,
    dataRaw: dataRaw,
    ...(options?.name ? { name: options.name } : {}), // Only include if defined
    uid: uid,
    timestamp: now,
  });

  console.log(
    `[Writes] Mobile: Queued match data for ${teamNumber} in match ${matchNumber}`,
  );

  // 3. Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Delete match data
 * Uses soft-delete pattern
 */
export async function deleteMatchData(
  eventKey: string,
  matchNumber: string,
  teamNumber: string,
  uid: string,
): Promise<void> {
  const now = Date.now();

  if (isTauri()) {
    // DESKTOP: Update local cache immediately (optimistic), then queue for sync
    const { invoke } = await import("@tauri-apps/api/core");

    // 1. Get existing match data from local cache
    const allMatchData = await invoke<any[]>("get_match_scouting_data", { event: eventKey });
    const matchData = allMatchData.find(
      (m) => m.match === matchNumber && m.team === teamNumber && m.uid === uid
    );

    if (!matchData) {
      console.warn(`[Writes] Match data not found for deletion: ${teamNumber} in ${matchNumber}`);
      return;
    }

    // Store original timestamp for Supabase query
    const originalTimestamp = matchData.timestamp;

    console.log(
      `[Writes] Deleting match data: match=${matchNumber}, team=${teamNumber}, uid=${uid}, originalTimestamp=${originalTimestamp}, type=${typeof originalTimestamp}`
    );

    // 2. Update local cache with deleted_at (optimistic update)
    matchData.deleted_at = now;
    matchData.last_modified = now;
    await invoke("cache_match_scouting_data", { data: [matchData] });
    globalDesktopCompetitionRefresh?.();

    // 3. Queue for sync (will push to Supabase when online)
    // CRITICAL: Use original timestamp for Supabase query to match the record
    await invoke("add_to_sync_queue", {
      operation: "DELETE_MATCH_DATA",
      payload: {
        event: eventKey,
        match: matchNumber,
        team: teamNumber,
        uid: uid,
        timestamp: originalTimestamp, // Use original timestamp, not now
      },
    });

    console.log(`[Writes] Desktop: Deleted match data for ${teamNumber} in ${matchNumber} (local + queued for Supabase, timestamp=${originalTimestamp})`);

    // 4. Trigger instant sync (fire-and-forget)
    invoke("trigger_sync_now").catch((e) => {
      console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
    });

    return;
  }

  // MOBILE: Update local cache then queue for sync
  // Use upsertEventMatchDataRows (not cacheEventMatchData) to avoid wiping all
  // other match data for this event — cacheEventMatchData does a DELETE+reinsert.
  const existing = await getEventMatchData(eventKey, matchNumber, teamNumber);
  if (existing.length > 0) {
    const toDelete = existing.filter((e: EventMatchData) => e.uid === uid);
    if (toDelete.length > 0) {
      await upsertEventMatchDataRows(
        eventKey,
        toDelete.map((e: EventMatchData) => ({ ...e, deleted_at: now })),
      );
    }
  }

  // Queue for sync — (event, match, team, uid) is sufficient to identify the row
  await addToSyncQueue("DELETE_MATCH_DATA", {
    event: eventKey,
    match: matchNumber,
    team: teamNumber,
    uid: uid,
  });

  console.log(
    `[Writes] Mobile: Queued delete match data for ${teamNumber} in match ${matchNumber}`,
  );

  // Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Assign scouting shift to team
 */
export async function assignShift(
  eventKey: string,
  teamNumber: string,
  uid: string,
  name?: string,
): Promise<void> {
  const now = Date.now();

  if (isTauri()) {
    // DESKTOP: Use Tauri commands
    const { invoke } = await import("@tauri-apps/api/core");

    // Get schedule and update assignment
    const schedule = await invoke<EventScheduleEntry[]>("get_schedule", { event: eventKey });
    const updated = schedule.map((s: EventScheduleEntry) =>
      s.team === teamNumber ? { ...s, uid, name, last_modified: now } : s,
    );

    // 1. Cache locally (Tauri SQLite)
    await invoke("cache_schedule", { event: eventKey, schedule: updated });
    globalDesktopCompetitionRefresh?.();

    // 2. Add to sync queue
    await invoke("add_to_sync_queue", {
      operation: "ASSIGN_SHIFT",
      payload: {
        event: eventKey,
        team: teamNumber,
        uid: uid,
        name: name,
        timestamp: now,
      },
    });

    console.log(`[Writes] Desktop: Queued shift assignment for ${teamNumber}`);

    // 3. Trigger instant sync (fire-and-forget)
    invoke("trigger_sync_now").catch((e) => {
      console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
    });

    return;
  }

  // MOBILE: Use WASM SQLite
  // Update local schedule cache
  const schedule = await getEventSchedule(eventKey);
  const updated = schedule.map((s: EventScheduleEntry) =>
    s.team === teamNumber ? { ...s, uid, name, last_modified: now } : s,
  );
  await cacheEventSchedule(eventKey, updated);

  // Queue for sync
  await addToSyncQueue("ASSIGN_SHIFT", {
    event: eventKey,
    team: teamNumber,
    uid: uid,
    name: name,
    timestamp: now,
  });

  console.log(`[Writes] Mobile: Queued shift assignment for ${teamNumber}`);

  // Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Create picklist
 */
export async function createPicklist(
  eventKey: string,
  title: string,
  entries: { team: string; rank: number; flags?: any }[],
  uid: string,
  uname: string,
  type: "public" | "private" | "default",
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();

  if (isTauri()) {
    try {
      console.log("[Writes] Desktop mode - using Tauri commands directly");

      // DESKTOP: Use Tauri invoke directly (avoids dynamic import issues)
      const { invoke } = await import("@tauri-apps/api/core");

      const picklist = {
        id,
        event: eventKey,
        title,
        picklist: entries,
        uname,
        uid,
        type,
        timestamp: now,
        last_modified: now,
      };

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      globalDesktopCompetitionRefresh?.();

      // Get user JWT for proper authentication
      const user_jwt = await getUserJWT();

      // Queue for Rust background sync
      await invoke("add_to_sync_queue", {
        operation: "CREATE_PICKLIST",
        payload: {
          id,
          event: eventKey,
          title,
          entries,
          uid,
          user_jwt,
          uname,
          type,
          timestamp: now,
        },
      });

      console.log(`[Writes] Desktop: Queued picklist creation: ${title}`);

      // Trigger instant sync (non-blocking, fire-and-forget)
      invoke("trigger_sync_now").catch((e) => {
        console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
      });

      return id;
    } catch (error) {
      console.error("[Writes] Desktop path failed:", error);
      throw error;
    }
  }

  // MOBILE: Use WASM SQLite + IndexedDB queue
  const picklist: EventPicklist = {
    id,
    event: eventKey,
    title,
    picklist: entries,
    uname,
    uid,
    type,
    timestamp: now,
    last_modified: now,
    deleted_at: undefined,
  };

  // Use insertPicklistToCache (upsert) instead of cacheEventPicklists (DELETE-all + INSERT)
  // so we don't wipe other picklists from the local cache
  await insertPicklistToCache(picklist);

  // Get user JWT for proper authentication
  const user_jwt = await getUserJWT();

  await addToSyncQueue("CREATE_PICKLIST", {
    id,
    event: eventKey,
    user_jwt,
    title,
    entries,
    uid,
    uname,
    type,
    timestamp: now,
  });

  console.log(`[Writes] Mobile: Queued picklist creation: ${title}`);

  await triggerInstantSync();

  return id;
}

/**
 * Update picklist
 */
export async function updatePicklist(
  id: string,
  eventKey: string,
  title: string,
  entries: { team: string; rank: number; flags?: any }[],
  type?: "public" | "private" | "default",
): Promise<void> {
  const now = Date.now();

  if (isTauri()) {
    try {
      console.log("[Writes] Desktop mode - using Tauri commands for update");

      // DESKTOP: Use Tauri invoke directly
      const { invoke } = await import("@tauri-apps/api/core");

      const picklist: Partial<EventPicklist> & { id: string; event: string } = {
        id,
        event: eventKey,
        title,
        ...(type ? { type } : {}),
        picklist: entries,
        last_modified: now,
      };

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      globalDesktopCompetitionRefresh?.();
      console.log("[Writes] Desktop: ✓ Cached picklist with entries");

      // Get user JWT for proper authentication
      const user_jwt = await getUserJWT();

      // Queue for Rust background sync
      await invoke("add_to_sync_queue", {
        operation: "UPDATE_PICKLIST",
        payload: {
          id,
          event: eventKey,
          title,
          entries,
          user_jwt,
          ...(type ? { type } : {}),
          timestamp: now,
        },
      });

      console.log(`[Writes] Desktop: ✓ Queued for sync: ${title}`);

      // Trigger instant sync and wait for it to complete
      // This prevents background polling from overwriting local changes before sync finishes
      try {
        console.log("[Writes] Desktop: Triggering instant sync...");
        await invoke("trigger_sync_now");
        console.log("[Writes] Desktop: ✅ Sync completed successfully");
      } catch (e) {
        console.warn("[Writes] Desktop: ⚠️ Instant sync trigger failed (will sync in next cycle):", e);
      }

      console.log("[Writes] Desktop: updatePicklist complete");
      return;
    } catch (error) {
      console.error("[Writes] Desktop path failed:", error);
      throw error;
    }
  }

  // MOBILE: Use WASM SQLite + IndexedDB queue
  // Use updatePicklistCache (targeted UPDATE) instead of cacheEventPicklists (DELETE-all + INSERT)
  // to avoid wiping uid, uname, timestamp, and other fields we're not changing
  await updatePicklistCache(eventKey, id, title, entries, type);

  // Queue for sync
  await addToSyncQueue("UPDATE_PICKLIST", {
    id,
    event: eventKey,
    title,
    entries,
    ...(type ? { type } : {}),
    timestamp: now,
  });

  console.log(`[Writes] Mobile: Queued picklist update: ${title}`);

  // Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Delete picklist
 */
export async function deletePicklist(
  id: string,
  eventKey: string,
): Promise<void> {
  const now = Date.now();

  if (isTauri()) {
    try {
      console.log("[Writes] Desktop mode - using Tauri commands for delete");

      // DESKTOP: Use Tauri invoke directly
      const { invoke } = await import("@tauri-apps/api/core");

      // Soft delete picklist locally (entries are embedded, no separate entries table)
      const picklist: Partial<EventPicklist> & { id: string; event: string } = {
        id,
        event: eventKey,
        deleted_at: now,
        last_modified: now,
      };

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      globalDesktopCompetitionRefresh?.();

      // Get user JWT for proper authentication
      const user_jwt = await getUserJWT();

      // Queue for Rust background sync
      await invoke("add_to_sync_queue", {
        operation: "DELETE_PICKLIST",
        payload: {
          id,
          event: eventKey,
          user_jwt,
          timestamp: now,
        },
      });

      console.log(`[Writes] Desktop: Queued picklist deletion: ${id}`);

      // Trigger instant sync (non-blocking, fire-and-forget)
      invoke("trigger_sync_now").catch((e) => {
        console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
      });

      return;
    } catch (error) {
      console.error("[Writes] Desktop path failed:", error);
      throw error;
    }
  }

  // MOBILE: Use WASM SQLite + IndexedDB queue
  // Use softDeletePicklistCache (targeted UPDATE) instead of cacheEventPicklists (DELETE-all + INSERT)
  // to avoid wiping other picklists from the local cache
  await softDeletePicklistCache(eventKey, id);

  // Queue for sync
  await addToSyncQueue("DELETE_PICKLIST", {
    id,
    event: eventKey,
    timestamp: now,
  });

  console.log(`[Writes] Mobile: Queued picklist deletion: ${id}`);

  // Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Put team data with images (pit scouting with photos)
 * Compresses images, stores in IndexedDB, writes to SQLite, queues for sync
 */
export async function putTeamDataWithImages(
  eventKey: string,
  teamNumber: string,
  data: any,
  imageFiles: File[],
  options?: {
    teamName?: string;
    name?: string;
    uid?: string;
  },
): Promise<void> {
  // Validate team exists in TBA for this event
  const tbaTeams = await getTbaTeams(eventKey);
  const teamExists = tbaTeams.some((t) => t.team_key === teamNumber);

  if (!teamExists) {
    throw new Error(
      `Team ${teamNumber} is not registered for event ${eventKey}`,
    );
  }

  const now = Date.now();

  console.log(
    `[Writes] Preparing team data with ${imageFiles.length} images for ${teamNumber}`,
  );

  // 1. Compress images sequentially to avoid simultaneous Canvas renders
  // crashing low-RAM devices (old iPads, budget Androids)
  const compressedBlobs: Blob[] = [];
  for (const file of imageFiles) {
    compressedBlobs.push(await compressImage(file));
  }

  // 2. Store compressed images in IndexedDB queue
  const localImageIds = await Promise.all(
    compressedBlobs.map(async (blob: Blob, idx: number) => {
      const id = crypto.randomUUID();
      await addToImageQueue({
        id,
        eventKey,
        teamNumber,
        blob,
        filename: `image-${idx}-${now}.png`,
        timestamp: now,
      });
      return id;
    }),
  );

  // 3. Write to local SQLite with pending image refs
  const teamData: EventTeamData = {
    event: eventKey,
    team: teamNumber,
    data: {
      ...data,
      images: {
        ...data.images,
        files: localImageIds.map((id: string, idx: number) => ({
          path: `pending-${id}`, // Placeholder until upload
          filename: `image-${idx}-${now}.png`,
          uploaded: false,
          timestamp: now,
        })),
      },
    },
    team_name: options?.teamName,
    name: options?.name,
    uid: options?.uid,
    timestamp: now,
    last_modified: now,
  };

  await upsertEventTeamDataRows(eventKey, [teamData]);

  // 4. Queue for background sync with image upload
  await addToSyncQueue("PUT_TEAM_DATA_WITH_IMAGES", {
    event: eventKey,
    team: teamNumber,
    data: data,
    teamName: options?.teamName,
    name: options?.name,
    uid: options?.uid,
    timestamp: now,
    localImageIds,
  });

  console.log(
    `[Writes] Queued team data with ${imageFiles.length} images for ${teamNumber}`,
  );

  // 5. Trigger instant sync if online
  await triggerInstantSync();
}

/**
 * Set team priority for the scouting scheduler (desktop only).
 * Uses a read-merge-write pattern to preserve all other data already in
 * event_team_data.data (TBA stats, pit scouting answers, etc.).
 */
export async function setTeamPriority(
  eventKey: string,
  teamKey: string,
  priority: number | null
): Promise<void> {
  if (!isTauri()) {
    throw new Error("setTeamPriority is only supported on desktop");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const now = Date.now();

  // 1. Read the current full row from local SQLite for the local cache update only.
  const allPitData = await invoke<any[]>("get_pit_scouting_data", { event: eventKey });
  const existing = allPitData.find(
    (r: any) =>
      (r.team?.startsWith("frc") ? r.team : `frc${r.team}`) ===
      (teamKey?.startsWith("frc") ? teamKey : `frc${teamKey}`)
  );
  const existingData = existing?.data ?? {};

  // 2. Merge priority into existing local data for immediate UI update.
  const mergedData =
    priority !== null
      ? { ...existingData, priority }
      : { ...existingData, priority: null };

  // 3. Build the full row shape expected by cache_pit_scouting_data
  const updatedRow = {
    event: eventKey,
    team: teamKey,
    data: mergedData,
    team_name: existing?.team_name ?? null,
    name: existing?.name ?? null,
    uid: existing?.uid ?? null,
    assigned: existing?.assigned ?? null,
    timestamp: existing?.timestamp ?? null,
    last_modified: now,
    deleted_at: null,
  };

  // 4. Cache locally so the UI reflects the change immediately
  await invoke("cache_pit_scouting_data", { data: [updatedRow] });
  globalDesktopTeamRefresh?.();

  // 5. Queue only the priority delta to Supabase.
  //    Rust's put_team_data fetches the current Supabase row and merges this on top,
  //    so we only send {priority} — never the full local data. Sending the full local
  //    data risks overwriting fresher pit scouting submitted from mobile between syncs.
  const priorityDelta = { priority: priority ?? null };
  await invoke("add_to_sync_queue", {
    operation: "PUT_TEAM_DATA",
    payload: {
      event: eventKey,
      team: teamKey,
      data: priorityDelta,
      teamName: existing?.team_name,
      name: existing?.name,
      uid: existing?.uid,
      timestamp: now,
    },
  });

  console.log(
    `[Writes] Desktop: Set priority ${priority} for ${teamKey} in ${eventKey}`
  );

  // 6. Trigger instant sync (fire-and-forget)
  invoke("trigger_sync_now").catch((e) => {
    console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
  });
}

/**
 * Bulk-assign shifts from a cycle run (desktop only).
 * Applies each CycleAssignment to its specific (match, team) row in the schedule.
 * Writes to local SQLite first, then queues a single ASSIGN_SHIFTS_BULK operation.
 */
export async function assignShiftsFromCycle(
  eventKey: string,
  assignments: CycleAssignment[],
): Promise<void> {
  if (!isTauri()) {
    throw new Error("assignShiftsFromCycle is only supported on desktop");
  }
  if (assignments.length === 0) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const now = Date.now();

  // Build lookup: "matchKey|teamKey" -> assignment
  const assignmentMap = new Map(
    assignments.map((a) => [`${a.matchKey}|${a.teamKey}`, a]),
  );

  // Read current schedule, replace ALL assignments atomically:
  // entries in the new batch get the new scouter, all others are cleared to null.
  // This prevents old assignments from compounding on top of new ones.
  const schedule = await invoke<EventScheduleEntry[]>("get_schedule", { event: eventKey });
  const updated = schedule.map((s: EventScheduleEntry) => {
    const a = assignmentMap.get(`${s.match}|${s.team}`);
    return { ...s, uid: a?.uid ?? null, name: a?.name ?? null, last_modified: now };
  });

  // 1. Cache locally (Tauri SQLite)
  await invoke("cache_schedule", { event: eventKey, schedule: updated });
  globalDesktopCompetitionRefresh?.();

  // 2. Queue a single bulk operation for Rust sync
  const user_jwt = await getUserJWT();
  await invoke("add_to_sync_queue", {
    operation: "ASSIGN_SHIFTS_BULK",
    payload: {
      event: eventKey,
      assignments: assignments.map((a) => ({
        match: a.matchKey,
        team: a.teamKey,
        uid: a.uid,
        name: a.name ?? null,
      })),
      user_jwt,
      timestamp: now,
    },
  });

  console.log(`[Writes] Desktop: Queued ASSIGN_SHIFTS_BULK (${assignments.length} assignments)`);

  // 3. Trigger instant sync (fire-and-forget)
  invoke("trigger_sync_now").catch((e) => {
    console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
  });
}

/**
 * Apply incremental assignment changes (desktop only).
 * Only the provided entries are updated; all other schedule rows are left untouched.
 * Pass uid=null / name=null to clear a specific assignment.
 * Use this instead of assignShiftsFromCycle when saving individual edits.
 */
export async function assignShiftsDiff(
  eventKey: string,
  changes: Array<{ matchKey: string; teamKey: string; uid: string | null; name: string | null }>,
): Promise<void> {
  if (!isTauri()) throw new Error("assignShiftsDiff is only supported on desktop");
  if (changes.length === 0) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const now = Date.now();

  const changeMap = new Map(changes.map((c) => [`${c.matchKey}|${c.teamKey}`, c]));

  // Read current schedule, update ONLY the dirty entries (leave all others as-is).
  const schedule = await invoke<EventScheduleEntry[]>("get_schedule", { event: eventKey });
  const updated = schedule.map((s: EventScheduleEntry) => {
    const c = changeMap.get(`${s.match}|${s.team}`);
    if (!c) return s;
    return { ...s, uid: c.uid, name: c.name, last_modified: now };
  });

  // 1. Cache locally (Tauri SQLite)
  await invoke("cache_schedule", { event: eventKey, schedule: updated });
  globalDesktopCompetitionRefresh?.();

  // 2. Queue only the changed entries — not the entire schedule.
  // Use ASSIGN_SHIFTS_DIFF (not ASSIGN_SHIFTS_BULK) so Supabase does NOT
  // clear all assignments first; it only patches the rows that changed.
  const user_jwt = await getUserJWT();
  await invoke("add_to_sync_queue", {
    operation: "ASSIGN_SHIFTS_DIFF",
    payload: {
      event: eventKey,
      assignments: changes.map((c) => ({
        match: c.matchKey,
        team: c.teamKey,
        uid: c.uid,
        name: c.name,
      })),
      user_jwt,
      timestamp: now,
    },
  });

  console.log(`[Writes] Desktop: Queued ASSIGN_SHIFTS_DIFF (${changes.length} change${changes.length !== 1 ? "s" : ""})`);

  // 3. Trigger instant sync (fire-and-forget)
  invoke("trigger_sync_now").catch((e) => {
    console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
  });
}

/**
 * Bulk-assign pit scouting teams among scouters (desktop only).
 * Updates the `assigned` column in event_team_data for each team.
 * Writes to local SQLite first, then queues a single ASSIGN_PIT_TEAMS_BULK operation.
 */
export async function assignPitTeams(
  eventKey: string,
  assignments: { teamKey: string; uid: string; name: string }[],
): Promise<void> {
  if (!isTauri()) throw new Error("assignPitTeams is only supported on desktop");
  if (assignments.length === 0) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const now = Date.now();

  const norm = (t: string) => (t?.startsWith("frc") ? t : `frc${t}`);
  const assignmentMap = new Map(
    assignments.map((a) => [norm(a.teamKey), a])
  );

  // Read current pit data, merge assignments (normalize team keys: frc5000 vs 5000)
  const allPitData = await invoke<any[]>("get_pit_scouting_data", { event: eventKey });
  const existingTeams = new Set(allPitData.map((r: any) => norm(r.team)));

  const updatedRows: any[] = [];
  for (const row of allPitData) {
    const a = assignmentMap.get(norm(row.team));
    if (a) {
      updatedRows.push({ ...row, assigned: a.uid, last_modified: now });
    }
  }
  // Create skeleton rows for teams not yet in pit data.
  // Use data: {} so cache merges (preserves TBA stats) instead of wiping.
  for (const a of assignments) {
    if (!existingTeams.has(norm(a.teamKey))) {
      updatedRows.push({
        event: eventKey,
        team: a.teamKey,
        data: {},
        team_name: null,
        name: null,
        uid: null,
        assigned: a.uid,
        timestamp: null,
        last_modified: now,
        deleted_at: null,
      });
    }
  }

  // 1. Cache locally (Tauri SQLite)
  if (updatedRows.length > 0) {
    await invoke("cache_pit_scouting_data", { data: updatedRows });
    globalDesktopTeamRefresh?.();
  }

  // 2. Queue a single bulk operation for Rust sync
  await invoke("add_to_sync_queue", {
    operation: "ASSIGN_PIT_TEAMS_BULK",
    payload: {
      event: eventKey,
      assignments: assignments.map((a) => ({ team: a.teamKey, uid: a.uid })),
      timestamp: now,
    },
  });

  console.log(`[Writes] Desktop: Queued ASSIGN_PIT_TEAMS_BULK (${assignments.length} teams)`);

  // 3. Trigger instant sync (fire-and-forget)
  invoke("trigger_sync_now").catch((e) => {
    console.warn("[Writes] Instant sync trigger failed (will sync in next cycle):", e);
  });
}
