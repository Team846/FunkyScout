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
  cacheEventTeamData,
  cacheEventMatchData,
  cacheEventSchedule,
  cacheEventPicklists,
  cacheEventPicklistEntries,
  getEventSchedule,
  getEventMatchData,
  getEventPicklistEntries,
  getTbaTeams,
  type EventTeamData,
  type EventMatchData,
  type EventScheduleEntry,
  type EventPicklist,
  type EventPicklistEntry,
} from "@lib/db";
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

    // 1. Cache locally (Tauri SQLite)
    await invoke("cache_team_data", { data: [teamData] });

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

  // 1. Write to local SQLite immediately (optimistic)
  await cacheEventTeamData(eventKey, [teamData]);

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
    await invoke("cache_match_data", { data: [matchData] });

    // 2. Add to sync queue
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

  // 1. Write to local SQLite
  await cacheEventMatchData(eventKey, [matchData]);

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
  const existing = await getEventMatchData(eventKey, matchNumber, teamNumber);
  if (existing.length > 0) {
    const toDelete = existing.filter((e: EventMatchData) => e.uid === uid);
    await cacheEventMatchData(
      eventKey,
      toDelete.map((e: EventMatchData) => ({ ...e, deleted_at: now })),
    );
  }

  // Queue for sync
  await addToSyncQueue("DELETE_MATCH_DATA", {
    event: eventKey,
    match: matchNumber,
    team: teamNumber,
    uid: uid,
    timestamp: now,
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
    await invoke("cache_schedule", { schedule: updated });

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
        picklist: null,
        uname,
        uid,
        type,
        timestamp: now,
        last_modified: now,
      };

      const picklistEntries = entries.map((e) => ({
        event: eventKey,
        id,
        team: e.team,
        rank: e.rank,
        flags: e.flags,
        last_modified: now,
      }));

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      await invoke("cache_picklist_entries", { entries: picklistEntries });

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
    picklist: null, // deprecated field
    uname,
    uid,
    type,
    timestamp: now,
    last_modified: now,
    deleted_at: undefined,
  };

  await cacheEventPicklists(eventKey, [picklist]);

  const picklistEntries: EventPicklistEntry[] = entries.map((e) => ({
    event: eventKey,
    id,
    team: e.team,
    rank: e.rank,
    flags: e.flags,
    last_modified: now,
    deleted_at: undefined,
  }));

  await cacheEventPicklistEntries(eventKey, picklistEntries);

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
        picklist: null,
        last_modified: now,
      };

      const picklistEntries = entries.map((e) => ({
        event: eventKey,
        id,
        team: e.team,
        rank: e.rank,
        flags: e.flags,
        last_modified: now,
      }));

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      await invoke("cache_picklist_entries", { entries: picklistEntries });

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

      console.log(`[Writes] Desktop: Queued picklist update: ${title}`);

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
  // Update picklist header locally (just the title and last_modified)
  const picklist: Partial<EventPicklist> & { id: string; event: string } = {
    id,
    event: eventKey,
    title,
    ...(type ? { type } : {}),
    picklist: null,
    last_modified: now,
  };

  await cacheEventPicklists(eventKey, [picklist as EventPicklist]);

  // Delete old entries and cache new ones
  const picklistEntries: EventPicklistEntry[] = entries.map((e) => ({
    event: eventKey,
    id,
    team: e.team,
    rank: e.rank,
    flags: e.flags,
    last_modified: now,
    deleted_at: undefined,
  }));

  await cacheEventPicklistEntries(eventKey, picklistEntries);

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

      // Soft delete picklist locally
      const picklist: Partial<EventPicklist> & { id: string; event: string } = {
        id,
        event: eventKey,
        deleted_at: now,
        last_modified: now,
      };

      // Soft delete entries locally - get entries using Tauri invoke
      const allEntries = await invoke<EventPicklistEntry[]>("get_picklist_entries", { event: eventKey });
      const existingEntries = allEntries.filter(e => e.id === id);
      const deletedEntries = existingEntries.map((e: EventPicklistEntry) => ({
        ...e,
        deleted_at: now,
        last_modified: now,
      }));

      // Cache locally (Tauri SQLite) - invoke commands directly
      await invoke("cache_picklists", { picklists: [picklist] });
      await invoke("cache_picklist_entries", { entries: deletedEntries });

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
  // Soft delete picklist locally
  const picklist: Partial<EventPicklist> & { id: string; event: string } = {
    id,
    event: eventKey,
    deleted_at: now,
    last_modified: now,
  };

  await cacheEventPicklists(eventKey, [picklist as EventPicklist]);

  // Soft delete entries locally
  const existingEntries = await getEventPicklistEntries(eventKey, id);
  const deletedEntries = existingEntries.map((e: EventPicklistEntry) => ({
    ...e,
    deleted_at: now,
    last_modified: now,
  }));

  await cacheEventPicklistEntries(eventKey, deletedEntries);

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

  // 1. Compress images
  const compressedBlobs = await Promise.all(
    imageFiles.map((file) => compressImage(file)),
  );

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

  await cacheEventTeamData(eventKey, [teamData]);

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
