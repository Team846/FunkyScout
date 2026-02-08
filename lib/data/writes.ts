/**
 * Write operations with offline-first pattern
 *
 * All write functions:
 * 1. Write to local SQLite cache immediately (optimistic update)
 * 2. Queue the operation for background sync to Supabase
 * 3. Return immediately (non-blocking)
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
  type EventTeamData,
  type EventMatchData,
  type EventScheduleEntry,
  type EventPicklist,
  type EventPicklistEntry,
} from "@lib/db";
import { addToImageQueue } from "@lib/storage/imageQueue";
import { compressImage } from "@lib/utils/imageCompression";

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
  const now = Date.now();

  // 1. Write to local SQLite immediately (optimistic)
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

  await cacheEventTeamData([teamData]);

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

  console.log(`[Writes] Queued team data for ${teamNumber} in ${eventKey}`);
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
  const now = Date.now();

  // 1. Write to local SQLite
  const matchData: EventMatchData = {
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
  };

  await cacheEventMatchData([matchData]);

  // 2. Queue for sync
  await addToSyncQueue("PUT_MATCH_DATA", {
    event: eventKey,
    match: matchNumber,
    team: teamNumber,
    alliance: alliance,
    dataRaw: dataRaw,
    name: options?.name,
    uid: uid,
    timestamp: now,
  });

  console.log(
    `[Writes] Queued match data for ${teamNumber} in match ${matchNumber}`,
  );
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

  // Soft delete in local cache
  const existing = await getEventMatchData(eventKey, matchNumber, teamNumber);
  if (existing.length > 0) {
    const toDelete = existing.filter((e) => e.uid === uid);
    await cacheEventMatchData(
      toDelete.map((e) => ({ ...e, deleted_at: now })),
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
    `[Writes] Queued delete match data for ${teamNumber} in match ${matchNumber}`,
  );
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

  // Update local schedule cache
  const schedule = await getEventSchedule(eventKey);
  const updated = schedule.map((s) =>
    s.team === teamNumber ? { ...s, uid, name, last_modified: now } : s,
  );
  await cacheEventSchedule(updated);

  // Queue for sync
  await addToSyncQueue("ASSIGN_SHIFT", {
    event: eventKey,
    team: teamNumber,
    uid: uid,
    name: name,
    timestamp: now,
  });

  console.log(`[Writes] Queued shift assignment for ${teamNumber}`);
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
  const nowISO = new Date(now).toISOString();

  // Cache picklist header locally
  const picklist: EventPicklist = {
    id,
    event: eventKey,
    title,
    picklist: null, // deprecated field
    uname,
    uid,
    type,
    timestamp: nowISO,
    last_modified: nowISO,
    deleted_at: null,
  };

  await cacheEventPicklists([picklist]);

  // Cache picklist entries locally
  const picklistEntries: EventPicklistEntry[] = entries.map((e) => ({
    event: eventKey,
    id,
    team: e.team,
    rank: e.rank,
    flags: e.flags,
    last_modified: nowISO,
    deleted_at: null,
  }));

  await cacheEventPicklistEntries(picklistEntries);

  // Queue for sync
  await addToSyncQueue("CREATE_PICKLIST", {
    id,
    event: eventKey,
    title,
    entries,
    uid,
    uname,
    type,
    timestamp: now,
  });

  console.log(`[Writes] Queued picklist creation: ${title}`);

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
  const nowISO = new Date(now).toISOString();

  // Update picklist header locally (just the title and last_modified)
  const picklist: Partial<EventPicklist> & { id: string; event: string } = {
    id,
    event: eventKey,
    title,
    ...(type ? { type } : {}),
    picklist: null,
    last_modified: nowISO,
  };

  await cacheEventPicklists([picklist as EventPicklist]);

  // Delete old entries and cache new ones
  const picklistEntries: EventPicklistEntry[] = entries.map((e) => ({
    event: eventKey,
    id,
    team: e.team,
    rank: e.rank,
    flags: e.flags,
    last_modified: nowISO,
    deleted_at: null,
  }));

  await cacheEventPicklistEntries(picklistEntries);

  // Queue for sync
  await addToSyncQueue("UPDATE_PICKLIST", {
    id,
    event: eventKey,
    title,
    entries,
    ...(type ? { type } : {}),
    timestamp: now,
  });

  console.log(`[Writes] Queued picklist update: ${title}`);
}

/**
 * Delete picklist
 */
export async function deletePicklist(
  id: string,
  eventKey: string,
): Promise<void> {
  const now = Date.now();
  const nowISO = new Date(now).toISOString();

  // Soft delete picklist locally
  const picklist: Partial<EventPicklist> & { id: string; event: string } = {
    id,
    event: eventKey,
    deleted_at: nowISO,
    last_modified: nowISO,
  };

  await cacheEventPicklists([picklist as EventPicklist]);

  // Soft delete entries locally
  const existingEntries = await getEventPicklistEntries(eventKey, id);
  const deletedEntries = existingEntries.map((e) => ({
    ...e,
    deleted_at: nowISO,
    last_modified: nowISO,
  }));

  await cacheEventPicklistEntries(deletedEntries);

  // Queue for sync
  await addToSyncQueue("DELETE_PICKLIST", {
    id,
    event: eventKey,
    timestamp: now,
  });

  console.log(`[Writes] Queued picklist deletion: ${id}`);
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
    compressedBlobs.map(async (blob, idx) => {
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
        files: localImageIds.map((id, idx) => ({
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

  await cacheEventTeamData([teamData]);

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
}
