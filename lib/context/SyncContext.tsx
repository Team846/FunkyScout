/**
 * SyncContext - Manages sync operations and triggers
 *
 * Responsibilities:
 * - Initialize SyncManager
 * - Listen for sync triggers (event switch, online/offline, route changes, auth changes)
 * - Provide sync status and manual sync function to UI
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useEvent } from "./EventContext";
import { SyncManager } from "@lib/sync/SyncManager";
import supabase from "@lib/supabase/supabase";
import { getSession } from "@lib/supabase/auth";

interface SyncContextType {
  syncManager: SyncManager | null;
  forceSyncNow: () => Promise<void>;
  isSyncing: boolean;
  registerRefreshCallback: (callback: () => void) => () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({
  children,
  router,
}: {
  children: ReactNode;
  router: any; // Router instance from createRouter
}) {
  const { currentEvent, isOnline, dbInitialized } = useEvent();
  const syncManagerRef = useRef<SyncManager | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const prevEventRef = useRef<string | null>(null);
  const prevOnlineRef = useRef<boolean>(isOnline);

  // Callback registry for data context refresh functions
  const refreshCallbacks = useRef<Set<() => void>>(new Set());

  // Initialize SyncManager
  useEffect(() => {
    if (!dbInitialized) return;

    const getUserId = async () => {
      const session = await getSession();
      return session?.user?.id || null;
    };

    syncManagerRef.current = new SyncManager(
      supabase,
      () => currentEvent,
      () => isOnline,
      getUserId,
    );

    syncManagerRef.current.start();
    console.log("[SyncContext] SyncManager initialized and started");

    return () => {
      syncManagerRef.current?.stop();
      console.log("[SyncContext] SyncManager stopped");
    };
  }, [dbInitialized]);

  // Manual sync function for UI (with loading state and data refresh)
  const forceSyncNow = useCallback(async () => {
    if (!syncManagerRef.current || !isOnline) {
      console.log("[SyncContext] Cannot sync: manager not ready or offline");
      return;
    }

    console.log("[SyncContext] Force sync triggered");
    setIsSyncing(true);

    try {
      // Step 1: Push local changes to Supabase
      await syncManagerRef.current.forceSyncNow();
      console.log("[SyncContext] Sync completed, triggering data refresh");

      // Step 2: Refresh all data contexts
      refreshCallbacks.current.forEach((callback) => {
        try {
          callback();
        } catch (error) {
          console.error("[SyncContext] Error in refresh callback:", error);
        }
      });

      console.log(
        `[SyncContext] Triggered ${refreshCallbacks.current.size} refresh callbacks`,
      );
    } catch (error) {
      console.error("[SyncContext] Sync failed:", error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline]);

  // Trigger 1: Event Switch
  useEffect(() => {
    if (
      currentEvent &&
      prevEventRef.current &&
      currentEvent !== prevEventRef.current
    ) {
      console.log(
        `[SyncContext] Event switched from ${prevEventRef.current} to ${currentEvent}, triggering sync`,
      );
      forceSyncNow().catch((error) => {
        console.error("[SyncContext] Event switch sync failed:", error);
      });
    }
    prevEventRef.current = currentEvent;
  }, [currentEvent, forceSyncNow]);

  // Trigger 2: Online/Offline transitions
  useEffect(() => {
    // Only trigger when coming BACK online (offline → online)
    if (
      isOnline &&
      !prevOnlineRef.current &&
      dbInitialized &&
      syncManagerRef.current
    ) {
      console.log("[SyncContext] Back online, triggering sync");
      forceSyncNow().catch((error) => {
        console.error("[SyncContext] Online sync failed:", error);
      });
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, dbInitialized, forceSyncNow]);

  // Trigger 3: Route changes
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const unsubscribe = router.subscribe("onBeforeLoad", ({ toLocation }: any) => {
      console.log(
        `[SyncContext] Route changing to ${toLocation.pathname}, triggering sync`,
      );
      // Note: This is fire-and-forget - we don't block navigation
      forceSyncNow().catch((error) => {
        console.error("[SyncContext] Route change sync failed:", error);
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [router, forceSyncNow]);

  // Trigger 4: Auth changes (login/logout)
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        console.log("[SyncContext] User signed in, triggering sync");
        forceSyncNow().catch((error) => {
          console.error("[SyncContext] Sign-in sync failed:", error);
        });
      } else if (event === "SIGNED_OUT") {
        console.log("[SyncContext] User signed out, triggering final sync");
        // Trigger sync before logout to push any pending data
        forceSyncNow().catch((error) => {
          console.error("[SyncContext] Sign-out sync failed:", error);
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [forceSyncNow]);

  // Register a refresh callback from data contexts
  const registerRefreshCallback = useCallback((callback: () => void) => {
    refreshCallbacks.current.add(callback);
    console.log(
      `[SyncContext] Registered refresh callback (total: ${refreshCallbacks.current.size})`,
    );

    // Return cleanup function
    return () => {
      refreshCallbacks.current.delete(callback);
      console.log(
        `[SyncContext] Unregistered refresh callback (total: ${refreshCallbacks.current.size})`,
      );
    };
  }, []);

  return (
    <SyncContext.Provider
      value={{
        syncManager: syncManagerRef.current,
        forceSyncNow,
        isSyncing,
        registerRefreshCallback,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync must be used within SyncProvider");
  }
  return context;
}
