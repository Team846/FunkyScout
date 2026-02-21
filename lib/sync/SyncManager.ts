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
      console.error(
        `[Sync] Item ${item.id} exceeded max retries. Last error: ${item.last_error || "unknown"}`,
      );
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
      const { retryable, message } = classifyError(error);

      if (!retryable) {
        console.error(`[Sync] Non-retryable error for item ${item.id}: ${message}`);
        // Remove non-retryable items from queue
        await removeSyncQueueItem(item.id);
        return;
      }

      // Increment retry count
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

    // 1. Fetch existing data to preserve TBA stats and team_name
    const { data: existing, error: fetchError } = await this.supabaseClient
      .from("event_team_data")
      .select("data, team_name")
      .eq("event", event)
      .eq("team", team)
      .maybeSingle();

    if (fetchError) {
      // Continue with upsert anyway (might be first write)
    }

    // 2. Merge pit data with existing TBA stats
    let mergedData = data;
    if (existing && existing.data) {
      // Keep existing TBA stats (rank, record, epa, opr, etc.)
      // Overwrite with new pit scouting data
      mergedData = {
        ...existing.data, // Preserve TBA stats
        ...data,          // Overwrite with pit data
      };
    }

    // 3. Preserve existing team_name from TBA bootstrap if not provided
    const finalTeamName = teamName || existing?.team_name || null;

    // 4. Upsert merged data
    const { error } = await this.supabaseClient
      .from("event_team_data")
      .upsert(
        {
          event,
          team,
          data: mergedData,
          team_name: finalTeamName,
          name,
          uid,
        },
        {
          onConflict: "event,team",
        },
      );

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

    // 3. Sync to Supabase using existing syncTeamData
    await this.syncTeamData({
      event,
      team,
      data: updatedData,
      teamName,
      name,
      uid,
      timestamp,
    });
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
   * Sync match data deletion to Supabase
   */
  private async syncDeleteMatchData(
    payload: DeleteMatchDataPayload,
  ): Promise<void> {
    const { event, match, team, uid, timestamp } = payload;

    const { error } = await this.supabaseClient
      .from("event_match_data")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("event", event)
      .eq("match", match)
      .eq("team", team)
      .eq("uid", uid)
      .eq("timestamp", timestamp);

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
    const { id, event, title, entries, type } = payload;

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

    // Soft delete picklist (entries are embedded — no separate entries operation needed)
    const { error: picklistError } = await this.supabaseClient
      .from("event_picklist")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (picklistError) {
      throw picklistError;
    }
  }
}
