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
import { toast } from "sonner";
import { setGlobalSyncTrigger } from "@lib/data/writes";

interface SyncContextType {
  syncManager: SyncManager | null;
  forceSyncNow: () => Promise<void>;
  isSyncing: boolean;
  lastSyncedAt: number | null; // epoch ms of last successful full sync
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
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const prevEventRef = useRef<string | null>(null);
  const prevOnlineRef = useRef<boolean>(isOnline);
  // Ref so SyncManager's getIsOnline() closure always reads the latest value
  // even though the SyncManager is only instantiated once (when dbInitialized).
  const isOnlineRef = useRef<boolean>(isOnline);

  // Callback registry for data context refresh functions
  const refreshCallbacks = useRef<Set<() => void>>(new Set());

  // Keep isOnlineRef in sync so SyncManager's getIsOnline() never reads a stale closure
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // Initialize SyncManager
  useEffect(() => {
    if (!dbInitialized) return;

    syncManagerRef.current = new SyncManager(
      supabase,
      () => isOnlineRef.current,
      (type, error) => {
        console.error(`[SyncContext] Permanent sync failure: ${type} — ${error}`);
        toast.error(`Upload failed permanently (${type})`, {
          description: "Data was not saved to the server. Check your connection and try again.",
          duration: 8000,
        });
      },
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

      // Step 2: Clear sync keys for the current event so refresh callbacks
      // do full loads instead of incremental. This handles the case where
      // the sync key was advanced after a partial full fetch (e.g. auth hiccup
      // on startup), which would cause incremental syncs to miss rows that were
      // present before the sync key window.
      if (currentEvent) {
        [
          "lastTeamSync_",
          "lastScheduleSync_",
          "lastMatchSync_",
          "lastPicklistSync_",
        ].forEach((prefix) => {
          localStorage.removeItem(`${prefix}${currentEvent}`);
        });
        console.log(
          `[SyncContext] Cleared sync keys for event ${currentEvent} — next fetch will be full load`,
        );
      }

      // Step 3: Refresh all data contexts
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
      setLastSyncedAt(Date.now());
    } catch (error) {
      console.error("[SyncContext] Sync failed:", error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, currentEvent]);

  // Register forceSyncNow as the global sync trigger for instant sync
  useEffect(() => {
    setGlobalSyncTrigger(forceSyncNow);
    console.log("[SyncContext] Registered global sync trigger for instant sync");
  }, [forceSyncNow]);

  // Trigger 1: Event Switch — push-only (flush pending writes, no data refresh).
  // Each data context already handles its own refetch via event-change effects;
  // firing refresh callbacks here would double every fetch on every event switch.
  useEffect(() => {
    if (
      currentEvent &&
      prevEventRef.current &&
      currentEvent !== prevEventRef.current
    ) {
      console.log(
        `[SyncContext] Event switched from ${prevEventRef.current} to ${currentEvent}, flushing writes`,
      );
      syncManagerRef.current?.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Event switch flush failed:", error);
      });
    }
    prevEventRef.current = currentEvent;
  }, [currentEvent]); // forceSyncNow intentionally excluded — push-only, no refresh

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
      toast.info("Back online, syncing data...", { duration: 2000 });

      forceSyncNow()
        .then(() => {
          toast.success("Sync complete!", { duration: 2000 });
        })
        .catch((error) => {
          console.error("[SyncContext] Online sync failed:", error);
          toast.error("Sync failed", { duration: 3000 });
        });
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, dbInitialized, forceSyncNow]);

  // Trigger 3: Route changes — push-only (flush pending writes, no data refresh)
  // Data contexts have their own 5min polling timers; refreshing on every navigation
  // would cause 4 Supabase reads + 2 external API calls per page change.
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const unsubscribe = router.subscribe("onBeforeLoad", ({ toLocation }: any) => {
      console.log(
        `[SyncContext] Route changing to ${toLocation.pathname}, flushing writes`,
      );
      // Push-only: drain the local write queue without triggering data context refreshes
      syncManagerRef.current?.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Route change push failed:", error);
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [router]);

  // Trigger 5: App visibility (tab/browser/mobile app returning to foreground)
  // Push-only + incremental refresh (no sync key clearing) to keep costs low.
  useEffect(() => {
    if (!dbInitialized) return;

    const handleVisibility = () => {
      if (document.hidden || !isOnline) return;
      console.log("[SyncContext] App visible again, pushing writes + incremental refresh");
      // Flush write queue (push-only)
      syncManagerRef.current?.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Visibility push failed:", error);
      });
      // Incremental refresh — sync keys are NOT cleared, so each context
      // fetches only rows modified since its last sync timestamp
      refreshCallbacks.current.forEach((callback) => {
        try {
          callback();
        } catch (error) {
          console.error("[SyncContext] Error in visibility refresh callback:", error);
        }
      });
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [dbInitialized, isOnline]);

  // Trigger 4: Auth changes (login/logout)
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_IN") {
        console.log("[SyncContext] User signed in, triggering sync and data refresh");
        // forceSyncNow() already fires all refresh callbacks internally — no need to call them again
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
        lastSyncedAt,
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
