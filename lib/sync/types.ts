/**
 * Type definitions for the sync queue system
 */

// Queue item types that can be synced
export type SyncQueueType =
  | "PUT_TEAM_DATA"
  | "PUT_TEAM_DATA_WITH_IMAGES"
  | "PUT_MATCH_DATA"
  | "DELETE_MATCH_DATA"
  | "ASSIGN_SHIFT"
  | "CREATE_PICKLIST"
  | "UPDATE_PICKLIST"
  | "DELETE_PICKLIST";

// Base payload interface
export interface BaseSyncPayload {
  event: string;
  timestamp: number;
}

// Payload for PUT_TEAM_DATA
export interface PutTeamDataPayload extends BaseSyncPayload {
  team: string;
  data: any;
  teamName?: string;
  name?: string;
  uid?: string;
}

// Payload for PUT_TEAM_DATA_WITH_IMAGES
export interface PutTeamDataWithImagesPayload extends BaseSyncPayload {
  team: string;
  data: any;
  teamName?: string;
  name?: string;
  uid?: string;
  localImageIds: string[]; // References to IndexedDB image queue
}

// Payload for PUT_MATCH_DATA
export interface PutMatchDataPayload extends BaseSyncPayload {
  match: string;
  team: string;
  alliance: "red" | "blue";
  dataRaw: any;
  name?: string;
  uid: string;
}

// Payload for DELETE_MATCH_DATA
export interface DeleteMatchDataPayload extends BaseSyncPayload {
  match: string;
  team: string;
  uid: string;
}

// Payload for ASSIGN_SHIFT
export interface AssignShiftPayload extends BaseSyncPayload {
  team: string;
  uid: string;
  name?: string;
}

// Payload for CREATE_PICKLIST
export interface CreatePicklistPayload extends BaseSyncPayload {
  id: string;
  title: string;
  entries: PicklistEntry[];
  uid: string;
  uname: string;
  type: "public" | "private" | "default";
}

// Payload for UPDATE_PICKLIST
export interface UpdatePicklistPayload extends BaseSyncPayload {
  id: string;
  title: string;
  entries: PicklistEntry[];
  type?: "public" | "private" | "default";
}

// Payload for DELETE_PICKLIST
export interface DeletePicklistPayload extends BaseSyncPayload {
  id: string;
}

// Helper type for picklist entries
export interface PicklistEntry {
  team: string;
  rank: number;
  flags?: any;
}

// Union type for all possible payloads
export type SyncPayload =
  | PutTeamDataPayload
  | PutTeamDataWithImagesPayload
  | PutMatchDataPayload
  | DeleteMatchDataPayload
  | AssignShiftPayload
  | CreatePicklistPayload
  | UpdatePicklistPayload
  | DeletePicklistPayload;

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

// Default retry configuration
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 1000, // 1 second
  maxDelay: 300000, // 5 minutes
  backoffFactor: 2,
};

// Error classification result
export interface ErrorClassification {
  retryable: boolean;
  message: string;
}

// Sync error class
export class SyncError extends Error {
  constructor(
    message: string,
    public queueItemId: number,
    public retryable: boolean,
    public originalError?: any,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/**
 * Calculate delay for retry attempt
 */
export function calculateRetryDelay(
  retries: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = Math.min(
    config.baseDelay * Math.pow(config.backoffFactor, retries),
    config.maxDelay,
  );
  return delay;
}

/**
 * Classify error to determine if it's retryable
 */
export function classifyError(error: any): ErrorClassification {
  // PostgreSQL error codes
  if (error.code === "23505") {
    // Unique constraint violation - already exists, not retryable
    return { retryable: false, message: "Duplicate entry (already synced)" };
  }

  if (error.code === "42P01") {
    // Table doesn't exist - schema error, not retryable
    return { retryable: false, message: "Schema error (table not found)" };
  }

  if (error.code === "23503") {
    // Foreign key violation - data integrity issue, not retryable
    return {
      retryable: false,
      message: "Data integrity error (foreign key violation)",
    };
  }

  // Network-related errors - retryable
  if (
    error.message?.toLowerCase().includes("network") ||
    error.message?.toLowerCase().includes("fetch") ||
    error.message?.toLowerCase().includes("timeout") ||
    error.name === "NetworkError" ||
    error.name === "FetchError"
  ) {
    return { retryable: true, message: `Network error: ${error.message}` };
  }

  // HTTP status codes
  if (error.status) {
    if (error.status >= 500 && error.status < 600) {
      // Server errors - retryable
      return { retryable: true, message: `Server error: ${error.status}` };
    }
    if (error.status === 429) {
      // Rate limit - retryable with backoff
      return { retryable: true, message: "Rate limit exceeded" };
    }
    if (error.status >= 400 && error.status < 500) {
      // Client errors (except 429) - not retryable
      return { retryable: false, message: `Client error: ${error.status}` };
    }
  }

  // Default: treat as retryable to be safe
  return { retryable: true, message: error.message || "Unknown error" };
}
