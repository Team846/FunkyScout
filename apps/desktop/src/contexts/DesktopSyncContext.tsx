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
  const { currentEvent, isOnline } = useDesktopEvent();
  const prevEventRef = useRef<string | null>(null);
  const prevOnlineRef = useRef<boolean>(isOnline);

  // Callback registry for data context refresh functions
  const refreshCallbacks = useRef<Set<() => void>>(new Set());

  /**
   * Trigger all registered refresh callbacks
   * Called on event switch, route change, online/offline
   */
  const forceSyncNow = useCallback(() => {
    console.log(
      `[DesktopSync] Triggering refresh for ${refreshCallbacks.current.size} callbacks`
    );

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
    console.log(
      `[DesktopSync] Registered callback (total: ${refreshCallbacks.current.size})`
    );

    // Return unregister function
    return () => {
      refreshCallbacks.current.delete(callback);
      console.log(
        `[DesktopSync] Unregistered callback (total: ${refreshCallbacks.current.size})`
      );
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
      console.log(
        `[DesktopSync] Event switched from ${prevEventRef.current} to ${currentEvent}`
      );
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
      ({ toLocation }: any) => {
        console.log(
          `[DesktopSync] Route changing to ${toLocation.pathname}, triggering refresh`
        );
        forceSyncNow();
      }
    );

    return unsubscribe;
  }, [router, forceSyncNow]);

  /**
   * Trigger 3: Online/offline transitions
   * When coming back online, refresh data from Supabase
   */
  useEffect(() => {
    // Only trigger when coming BACK online (offline → online)
    if (isOnline && !prevOnlineRef.current) {
      console.log("[DesktopSync] Back online, triggering refresh");
      forceSyncNow();
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, forceSyncNow]);

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
