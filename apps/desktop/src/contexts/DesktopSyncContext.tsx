/**
 * DesktopSyncContext - Manages refresh triggers for desktop app
 *
 * Desktop doesn't need a write queue (backend writes directly to Supabase)
 * But we DO need to trigger data context refreshes on:
 * - Event switching
 * - Route changes (page navigation)
 * - Online/offline transitions
 *
 * Data contexts register their refresh functions here
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
  router,
}: {
  children: ReactNode;
  router: any; // Router instance from createRouter
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
   * Trigger 2: Route changes (page navigation)
   * Refresh data when navigating between pages
   */
  useEffect(() => {
    const unsubscribe = router.subscribe(
      "onBeforeLoad",
      () => {
        forceSyncNow();
      }
    );

    return unsubscribe;
  }, [router, forceSyncNow]);

  /**
   * Note: Desktop is always online (native app), so no online/offline trigger needed
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
