/**
 * Desktop Sync Queue TypeScript Wrappers
 * Provides type-safe access to Tauri sync queue commands
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Add operation to desktop sync queue
 * Returns queue item ID
 */
export async function addToSyncQueue(
  operation: string,
  payload: Record<string, any>
): Promise<number> {
  return invoke<number>("add_to_sync_queue", {
    operation,
    payload,
  });
}

/**
 * Get current sync queue status
 * Returns counts of pending, processing, and failed operations
 */
export async function getSyncQueueStatus(): Promise<{
  pending: number;
  processing: number;
  failed: number;
}> {
  return invoke("get_sync_queue_status");
}

/**
 * Clear all failed sync queue items
 * Returns number of items cleared
 */
export async function clearFailedSyncQueue(): Promise<number> {
  return invoke<number>("clear_failed_sync_queue");
}

/**
 * Retry all failed sync queue items
 * Returns number of items retried
 */
export async function retryFailedSyncQueue(): Promise<number> {
  return invoke<number>("retry_failed_sync_queue");
}
