/**
 * DesktopSyncContext - Manages refresh triggers for desktop app
 *
 * Provides a callback registry for data refresh functions.
 * Used by AppShell's manual sync button to re-read SQLite after a Rust sync.
 * Data contexts (TeamData, CompetitionData) have their own 120s polling loops.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useDesktopEvent } from "./DesktopEventContext";

interface DesktopSyncContextType {
  registerRefreshCallback: (callback: () => void) => () => void;
  forceSyncNow: () => void;
}

const DesktopSyncContext = createContext<DesktopSyncContextType | undefined>(
  undefined
);

export function DesktopSyncProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { currentEvent } = useDesktopEvent();
  const prevEventRef = useRef<string | null>(null);

  // Callback registry for data context refresh functions
  const refreshCallbacks = useRef<Set<() => void>>(new Set());

  /**
   * Trigger all registered refresh callbacks
   * Called on event switch, route change, online/offline
   */
  const forceSyncNow = useCallback(() => {
    refreshCallbacks.current.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error("[DesktopSync] Error in refresh callback:", error);
      }
    });
  }, []);

  /**
   * Register a refresh callback from data contexts
   * Returns unregister function
   */
  const registerRefreshCallback = useCallback((callback: () => void) => {
    refreshCallbacks.current.add(callback);

    // Return unregister function
    return () => {
      refreshCallbacks.current.delete(callback);
    };
  }, []);

  /**
   * Trigger 1: Event switch
   * When user switches events, refresh all data
   */
  useEffect(() => {
    if (
      currentEvent &&
      prevEventRef.current &&
      currentEvent !== prevEventRef.current
    ) {
      forceSyncNow();
    }
    prevEventRef.current = currentEvent;
  }, [currentEvent, forceSyncNow]);

  /**
   * Note: Desktop is always online (native app), so no online/offline trigger needed.
   * Route changes do NOT trigger a sync — data contexts have their own periodic
   * polls (120s Rust sync + post-sync SQLite re-reads). Syncing on every page
   * navigation would cause unnecessary Supabase egress.
   */

  return (
    <DesktopSyncContext.Provider
      value={{ registerRefreshCallback, forceSyncNow }}
    >
      {children}
    </DesktopSyncContext.Provider>
  );
}

export function useDesktopSync() {
  const context = useContext(DesktopSyncContext);
  if (!context) {
    throw new Error(
      "useDesktopSync must be used within DesktopSyncProvider"
    );
  }
  return context;
}
