/**
 * SyncManager - Central orchestrator for offline-first sync operations
 *
 * Responsibilities:
 * - Process sync queue with retry logic and exponential backoff
 * - Run on 30-second interval + event-driven triggers
 * - Sync writes to Supabase when online
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSyncQueue,
  removeSyncQueueItem,
  incrementSyncQueueRetry,
  upsertEventTeamDataRows,
  type SyncQueueItem,
} from "@lib/db";
import {
  type SyncQueueType,
  type PutTeamDataPayload,
  type PutTeamDataWithImagesPayload,
  type PutMatchDataPayload,
  type DeleteMatchDataPayload,
  type AssignShiftPayload,
  type CreatePicklistPayload,
  type UpdatePicklistPayload,
  type DeletePicklistPayload,
  classifyError,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from "./types";
import {
  getFromImageQueue,
  removeFromImageQueue,
} from "@lib/storage/imageQueue";
import { uploadTeamImage } from "@lib/storage/uploads";

export class SyncManager {
  private syncInProgress: boolean = false;
  private syncTimer: any = null;
  private readonly SYNC_INTERVAL = 30_000; // 30 seconds
  private retryTimers: Map<number, any> = new Map();

  constructor(
    private supabaseClient: SupabaseClient,
    private getIsOnline: () => boolean,
    private onPermanentFailure?: (type: string, error: string) => void,
  ) {}

  /**
   * Start background sync polling
   */
  start(): void {
    if (this.syncTimer) {
      console.warn("[SyncManager] Already started");
      return;
    }

    console.log("[SyncManager] Starting with 30s polling interval");
    this.syncTimer = setInterval(() => {
      this.processSyncQueue().catch((error) => {
        console.error("[SyncManager] Polling error:", error);
      });
    }, this.SYNC_INTERVAL);

    // Initial sync
    this.processSyncQueue().catch((error) => {
      console.error("[SyncManager] Initial sync error:", error);
    });
  }

  /**
   * Stop all sync operations
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Clear all retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    console.log("[SyncManager] Stopped");
  }

  /**
   * Manually trigger sync (for refresh buttons)
   */
  async forceSyncNow(): Promise<void> {
    console.log("[SyncManager] Force sync triggered");
    await this.processSyncQueue();
  }

  /**
   * Process sync queue items
   */
  private async processSyncQueue(): Promise<void> {
    // Skip if already syncing
    if (this.syncInProgress) {
      return;
    }

    // Skip if offline
    if (!this.getIsOnline()) {
      return;
    }

    this.syncInProgress = true;

    try {
      const queue = await getSyncQueue();

      if (queue.length === 0) {
        return;
      }

      console.log(`[Sync] Processing ${queue.length} items`);

      // Process each queue item
      for (const item of queue) {
        try {
          await this.processQueueItem(item);
        } catch (error) {
          console.error(`[Sync] Error processing item ${item.id}:`, error);
          // Continue processing other items even if one fails
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Handle individual queue item with retry logic
   */
  private async processQueueItem(item: SyncQueueItem): Promise<void> {
    // Check if we've exceeded max retries
    if (item.retries >= DEFAULT_RETRY_CONFIG.maxRetries) {
      const lastError = item.last_error || "unknown error";
      console.error(
        `[Sync] ⚠️  Item ${item.id} (${item.type}) permanently failed after ${item.retries} retries. Data NOT synced to Supabase. Last error: ${lastError}`,
      );
      this.onPermanentFailure?.(item.type, lastError);
      await removeSyncQueueItem(item.id);
      return;
    }

    try {

      // Execute sync based on type
      switch (item.type as SyncQueueType) {
        case "PUT_TEAM_DATA":
          await this.syncTeamData(item.payload as PutTeamDataPayload);
          break;

        case "PUT_TEAM_DATA_WITH_IMAGES":
          await this.syncTeamDataWithImages(
            item.payload as PutTeamDataWithImagesPayload,
          );
          break;

        case "PUT_MATCH_DATA":
          await this.syncMatchData(item.payload as PutMatchDataPayload);
          break;

        case "DELETE_MATCH_DATA":
          await this.syncDeleteMatchData(
            item.payload as DeleteMatchDataPayload,
          );
          break;

        case "ASSIGN_SHIFT":
          await this.syncAssignShift(item.payload as AssignShiftPayload);
          break;

        case "CREATE_PICKLIST":
          await this.syncPicklistCreate(item.payload as CreatePicklistPayload);
          break;

        case "UPDATE_PICKLIST":
          await this.syncPicklistUpdate(item.payload as UpdatePicklistPayload);
          break;

        case "DELETE_PICKLIST":
          await this.syncPicklistDelete(item.payload as DeletePicklistPayload);
          break;

        default:
          console.error(`[Sync] Unknown queue type: ${item.type}`);
          // Remove unknown types from queue
          await removeSyncQueueItem(item.id);
          return;
      }

      // Success - remove from queue
      await removeSyncQueueItem(item.id);
    } catch (error: any) {
      // Classify error
      const { retryable, networkError, message } = classifyError(error);

      if (!retryable) {
        console.error(`[Sync] Non-retryable error for item ${item.id}: ${message}`);
        // Remove non-retryable items from queue
        await removeSyncQueueItem(item.id);
        return;
      }

      if (networkError) {
        // Connectivity failure — do NOT increment the retry counter.
        // navigator.onLine can be true even with no actual internet (e.g. WiFi
        // with no connectivity), so incrementing here would burn through all 5
        // retries in a single offline period and permanently lose the data.
        // The 30s poller will retry automatically when connectivity returns.
        console.warn(`[Sync] Network error for item ${item.id} (${item.type}), keeping in queue without incrementing retries: ${message}`);
        return;
      }

      // Increment retry count for non-network errors (server errors, rate limits, etc.)
      await incrementSyncQueueRetry(item.id, message);

      // Schedule retry with exponential backoff
      const delay = calculateRetryDelay(item.retries + 1);
      console.warn(`[Sync] Retrying item ${item.id} in ${delay}ms: ${message}`);

      // Clear existing retry timer if any
      if (this.retryTimers.has(item.id)) {
        clearTimeout(this.retryTimers.get(item.id));
      }

      // Schedule retry
      const timer = setTimeout(async () => {
        this.retryTimers.delete(item.id);
        try {
          // Fetch fresh item from queue
          const queue = await getSyncQueue();
          const freshItem = queue.find((q: SyncQueueItem) => q.id === item.id);
          if (freshItem) {
            await this.processQueueItem(freshItem);
          }
        } catch (retryError) {
          console.error(`[Sync] Retry error for item ${item.id}:`, retryError);
        }
      }, delay);

      this.retryTimers.set(item.id, timer);
    }
  }

  /**
   * Sync team data (pit scouting) to Supabase with merge logic
   * Fetches existing data, merges pit data with TBA stats, then upserts
   */
  private async syncTeamData(payload: PutTeamDataPayload): Promise<void> {
    const { event, team, data, name, uid, teamName } = payload;

    // 1. Fetch existing data to preserve TBA stats and team_name.
    const { data: existing, error: fetchError } = await this.supabaseClient
      .from("event_team_data")
      .select("data, team_name")
      .eq("event", event)
      .eq("team", team)
      .maybeSingle();

    if (fetchError) {
      // Bail out — pushing without the fetch-merge would overwrite existing pit scouting
      // data with only the current submission's fields (losing any previously scouted fields
      // not present in this submission). The queue item will retry when the fetch succeeds.
      // maybeSingle() returns null data (not an error) for 0 rows, so this is a real error.
      console.error("[Sync] Fetch failed before team data merge — aborting to preserve existing pit scouting:", fetchError);
      throw fetchError;
    }

    // 2. Merge new pit scouting fields on top of any existing pit scouting data.
    //    existing.data may contain previously submitted pit fields from another scout
    //    or a partial re-submission — preserve anything not present in the new payload.
    let mergedData = data;
    if (existing && existing.data) {
      mergedData = {
        ...existing.data, // Preserve existing pit scouting fields
        ...data,          // New submission wins on any key it includes
      };
    }

    // 3. Preserve existing team_name from TBA bootstrap if not provided
    const finalTeamName = teamName || existing?.team_name || null;

    // 4. Upsert merged data — only include name/uid if present to prevent null overwrites.
    // If name/uid are null/undefined, the existing scouter identity is preserved in Supabase.
    // (Matches the protection already in syncMatchData and the desktop Rust path.)
    const upsertPayload: Record<string, unknown> = {
      event,
      team,
      data: mergedData,
      team_name: finalTeamName,
      last_modified: new Date().toISOString(),
    };
    if (name != null) upsertPayload.name = name;
    if (uid != null) upsertPayload.uid = uid;

    const { error } = await this.supabaseClient
      .from("event_team_data")
      .upsert(upsertPayload, {
        onConflict: "event,team",
      });

    if (error) {
      console.error(`[Sync] Team data sync error:`, error);
      throw error;
    }
  }

  /**
   * Sync team data with images to Supabase
   * Uploads images from IndexedDB to Supabase Storage, then syncs data
   */
  private async syncTeamDataWithImages(
    payload: PutTeamDataWithImagesPayload,
  ): Promise<void> {
    const { event, team, data, teamName, name, uid, timestamp, localImageIds } =
      payload;

    // 1. Upload images from IndexedDB to Supabase Storage
    const uploadedPaths = await Promise.all(
      localImageIds.map(async (id) => {
        const image = await getFromImageQueue(id);
        const path = await uploadTeamImage(
          event,
          team,
          image.blob,
          image.filename,
        );
        await removeFromImageQueue(id); // Cleanup after successful upload
        return {
          path,
          filename: image.filename,
          uploaded: true,
          timestamp: image.timestamp,
        };
      }),
    );

    // 2. Update data JSON with uploaded paths
    const updatedData = {
      ...data,
      images: {
        ...data.images,
        files: uploadedPaths,
      },
    };

    // 3. Sync to Supabase using existing syncTeamData.
    await this.syncTeamData({
      event,
      team,
      data: updatedData,
      teamName,
      name,
      uid,
      timestamp,
    });

    // 4. Write real paths back to local SQLite so the UI refreshes immediately.
    //    Without this, pending-* placeholders stay in the cache until the next
    //    5-minute polling cycle replaces them — images never appear until restart.
    await upsertEventTeamDataRows(event, [
      {
        event,
        team,
        data: updatedData,
        team_name: teamName,
        name,
        uid,
        assigned: undefined,
        timestamp,
        last_modified: Date.now(),
        deleted_at: undefined,
      },
    ]);
  }

  /**
   * Sync match data (match scouting) to Supabase
   */
  private async syncMatchData(payload: PutMatchDataPayload): Promise<void> {
    const { event, match, team, alliance, dataRaw, name, uid, timestamp } =
      payload;

    // Validate alliance is provided
    if (!alliance) {
      console.error('[Sync] Alliance is null/undefined for match data:', payload);
      throw new Error('Alliance is required for match data');
    }

    // CRITICAL FIX: Build upsert payload dynamically - only include name if defined
    // This prevents null overwrites when editing match data without name/uid
    const upsertPayload: Record<string, unknown> = {
      event,
      match,
      team,
      alliance,
      data_raw: dataRaw,
      data: "{}",
      uid,
      timestamp: new Date(timestamp).toISOString(), // Convert milliseconds to ISO string
      last_modified: new Date().toISOString(), // Convert to ISO string for PostgreSQL
    };

    // Only include name if it's defined in the payload (prevents null overwrite)
    if (name !== undefined) {
      upsertPayload.name = name;
    }

    const { error } = await this.supabaseClient
      .from("event_match_data")
      .upsert(upsertPayload, {
        onConflict: "event,match,team",
      });

    if (error) {
      throw error;
    }
  }

  /**
   * Sync match data deletion to Supabase.
   * Must set last_modified so incremental sync (filtered by last_modified) propagates deletion.
   */
  private async syncDeleteMatchData(
    payload: DeleteMatchDataPayload,
  ): Promise<void> {
    const { event, match, team, uid } = payload;
    const now = new Date().toISOString();

    const { error } = await this.supabaseClient
      .from("event_match_data")
      .update({
        deleted_at: now,
        last_modified: now,
      })
      .eq("event", event)
      .eq("match", match)
      .eq("team", team)
      .eq("uid", uid);

    if (error) {
      throw error;
    }
  }

  /**
   * Sync shift assignment to Supabase
   */
  private async syncAssignShift(payload: AssignShiftPayload): Promise<void> {
    const { event, team, uid, name } = payload;

    const { error } = await this.supabaseClient
      .from("event_schedule")
      .update({
        uid,
        name,
        last_modified: new Date().toISOString(),
      })
      .eq("event", event)
      .eq("team", team);

    if (error) {
      throw error;
    }
  }

  /**
   * Sync picklist creation to Supabase
   */
  private async syncPicklistCreate(
    payload: CreatePicklistPayload,
  ): Promise<void> {
    const { id, event, title, entries, uid, uname, type, timestamp } = payload;

    // Insert picklist with embedded entries in picklist JSONB column
    const { error: picklistError } = await this.supabaseClient
      .from("event_picklist")
      .upsert({
        id,
        event,
        title,
        picklist: entries, // entries embedded in JSONB column
        uname,
        uid,
        type,
        timestamp: new Date(timestamp).toISOString(),
        last_modified: new Date().toISOString(),
      });

    if (picklistError) {
      console.error("[SyncManager] Picklist creation error:", picklistError);
      throw picklistError;
    }
  }

  /**
   * Sync picklist update to Supabase
   */
  private async syncPicklistUpdate(
    payload: UpdatePicklistPayload,
  ): Promise<void> {
    const { id, title, entries, type } = payload;

    const now = new Date().toISOString();

    console.log(`[SyncManager] Updating picklist ${id} in Supabase with timestamp:`, now);

    // Update picklist with embedded entries in picklist JSONB column
    const { error: picklistError } = await this.supabaseClient
      .from("event_picklist")
      .update({
        title,
        picklist: entries, // entries embedded in JSONB column
        ...(type ? { type } : {}),
        last_modified: now,
      })
      .eq("id", id);

    if (picklistError) {
      throw picklistError;
    }
  }

  /**
   * Sync picklist deletion to Supabase
   */
  private async syncPicklistDelete(
    payload: DeletePicklistPayload,
  ): Promise<void> {
    const { id } = payload;
    const now = new Date().toISOString();

    // Soft delete picklist. Must also set last_modified so incremental sync
    // (which filters by last_modified >= cutoff) fetches this row and propagates
    // deleted_at to other clients' local cache.
    const { error: picklistError } = await this.supabaseClient
      .from("event_picklist")
      .update({
        deleted_at: now,
        last_modified: now,
      })
      .eq("id", id);

    if (picklistError) {
      throw picklistError;
    }
  }
}
