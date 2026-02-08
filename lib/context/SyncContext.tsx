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
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { useEvent } from "./EventContext";
import { SyncManager } from "@lib/sync/SyncManager";
import supabase from "@lib/supabase/supabase";
import { getSession } from "@lib/supabase/auth";

interface SyncContextType {
  syncManager: SyncManager | null;
  forceSyncNow: () => Promise<void>;
  isSyncing: boolean;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { currentEvent, isOnline, dbInitialized } = useEvent();
  const router = useRouter();
  const syncManagerRef = useRef<SyncManager | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const prevEventRef = useRef<string | null>(null);
  const prevOnlineRef = useRef<boolean>(isOnline);

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
      syncManagerRef.current?.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Event switch sync failed:", error);
      });
    }
    prevEventRef.current = currentEvent;
  }, [currentEvent]);

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
      syncManagerRef.current.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Online sync failed:", error);
      });
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, dbInitialized]);

  // Trigger 3: Route changes
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const unsubscribe = router.subscribe("onBeforeLoad", ({ toLocation }) => {
      console.log(
        `[SyncContext] Route changing to ${toLocation.pathname}, triggering sync`,
      );
      // Note: This is fire-and-forget - we don't block navigation
      syncManagerRef.current?.forceSyncNow().catch((error) => {
        console.error("[SyncContext] Route change sync failed:", error);
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [router]);

  // Trigger 4: Auth changes (login/logout)
  useEffect(() => {
    if (!syncManagerRef.current) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        console.log("[SyncContext] User signed in, triggering sync");
        syncManagerRef.current?.forceSyncNow().catch((error) => {
          console.error("[SyncContext] Sign-in sync failed:", error);
        });
      } else if (event === "SIGNED_OUT") {
        console.log("[SyncContext] User signed out, triggering final sync");
        // Trigger sync before logout to push any pending data
        syncManagerRef.current?.forceSyncNow().catch((error) => {
          console.error("[SyncContext] Sign-out sync failed:", error);
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Manual sync function for UI (with loading state)
  const forceSyncNow = async () => {
    if (!syncManagerRef.current) {
      console.warn("[SyncContext] SyncManager not initialized");
      return;
    }

    setIsSyncing(true);
    try {
      await syncManagerRef.current.forceSyncNow();
    } catch (error) {
      console.error("[SyncContext] Manual sync failed:", error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SyncContext.Provider
      value={{
        syncManager: syncManagerRef.current,
        forceSyncNow,
        isSyncing,
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
