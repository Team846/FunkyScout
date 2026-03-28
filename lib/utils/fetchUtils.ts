/**
 * Fetching utilities with backoff and coordinated polling logic.
 */

import { errorHandler, ErrorSeverity } from "./errorHandler";

export interface PollingConfig {
  baseInterval: number; // ms
  maxInterval: number; // ms
  backoffFactor: number; // multiplier
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  baseInterval: 120_000,
  maxInterval: 300_000,
  backoffFactor: 1.5,
};


export const LIVE_POLLING_CONFIG: PollingConfig = {
  baseInterval: 600_000, // 10min — visibilitychange triggers immediate incremental refresh on app open
  maxInterval: 1_200_000, // 20min max for backoff headroom
  backoffFactor: 2,
};

export const BACKUP_API_POLLING_CONFIG: PollingConfig = {
  baseInterval: 120_000, // 2min for backup external APIs (TBA rankings, etc.)
  maxInterval: 300_000,
  backoffFactor: 1.5,
};

/**
 * Manages the timing for a periodic task with exponential backoff on failure.
 */
export class PollingController {
  private currentInterval: number;
  private timer: any = null;
  private isRunning: boolean = false;
  private config: PollingConfig;
  private task: () => Promise<void>;
  private label: string;

  constructor(
    label: string,
    task: () => Promise<void>,
    config = DEFAULT_POLLING_CONFIG
  ) {
    this.label = label;
    this.task = task;
    this.config = config;
    this.currentInterval = config.baseInterval;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[PollingController][${this.label}] Started`);
    this.scheduleNext();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`[PollingController][${this.label}] Stopped`);
  }

  public async forceRefresh() {
    this.currentInterval = this.config.baseInterval;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.runTask();
  }

  private scheduleNext() {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => this.runTask(), this.currentInterval);
  }

  private async runTask() {
    // Skip network fetch when the tab is hidden — no one is looking at the data.
    // The next scheduled tick will run normally once the tab becomes visible again.
    // SyncContext's visibilitychange handler triggers an immediate refresh on un-hide.
    if (typeof document !== "undefined" && document.hidden) {
      this.scheduleNext();
      return;
    }
    try {
      await this.task();
      // Success: reset to base interval
      this.currentInterval = this.config.baseInterval;
    } catch (error) {
      errorHandler.handleError(
        error,
        `Polling:${this.label}`,
        ErrorSeverity.LOW
      );

      // Failure: exponential backoff
      this.currentInterval = Math.min(
        this.currentInterval * this.config.backoffFactor,
        this.config.maxInterval
      );
      console.log(
        `[PollingController][${this.label}] Task failed, backing off to ${this.currentInterval}ms`
      );
    } finally {
      if (this.isRunning) {
        this.scheduleNext();
      }
    }
  }
}

/**
 * Simple wrapper for fetching with basic retry/error handling
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  context: string,
  retries = 3
): Promise<T | null> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(
        `[FetchWithRetry][${context}] Attempt ${i + 1} failed, retrying...`
      );
      // Wait a bit before retry
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }

  errorHandler.handleError(lastError, context, ErrorSeverity.MEDIUM);
  return null;
}
