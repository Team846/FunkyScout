import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDesktopEvent } from "./DesktopEventContext";
import supabase from "@lib/supabase/supabase";

export interface ActiveScout {
  uid: string;
  name: string;
  match: string;
  team: string;
  phase: "match_start" | "match_play";
}

interface DesktopRealtimeContextType {
  registerRefreshCallback: (callback: () => void) => () => void;
  isConnected: boolean;
  activeScouts: ActiveScout[];
}

const DesktopRealtimeContext = createContext<
  DesktopRealtimeContextType | undefined
>(undefined);

export function DesktopRealtimeProvider({ children }: { children: ReactNode }) {
  const { currentEvent } = useDesktopEvent();
  const callbacksRef = useRef<Set<() => void>>(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const [activeScouts, setActiveScouts] = useState<ActiveScout[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track whether this is a reconnect (vs. initial subscription) so we can
  // trigger a catch-up sync only when we've been disconnected and come back.
  const hasConnectedOnceRef = useRef(false);
  // Set to false during effect cleanup so retries don't fire against a removed channel.
  const isEffectActiveRef = useRef(false);

  // Debouncing state to batch rapid updates
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Accumulates which tables fired during the debounce window so we sync only those
  const pendingTablesRef = useRef<Set<string>>(new Set());

  // Holds the currently active channel so retries can remove it before creating a new one.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Register a callback to be called on realtime updates
  const registerRefreshCallback = useCallback((callback: () => void) => {
    callbacksRef.current.add(callback);

    // Return unregister function
    return () => {
      callbacksRef.current.delete(callback);
    };
  }, []);

  // Call all registered callbacks (debounced).
  // Accepts an optional table name — if provided, only that table is synced in Rust
  // (saves egress vs a full sync_once). Multiple tables within the debounce window are
  // each synced individually. Falls back to a full trigger_sync_now if no table given.
  const triggerRefresh = useCallback((table?: string) => {
    if (table) {
      pendingTablesRef.current.add(table);
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to batch updates within 500ms
    debounceTimerRef.current = setTimeout(() => {
      const tables = pendingTablesRef.current;
      pendingTablesRef.current = new Set();

      if (tables.size > 0) {
        console.log(`[DesktopRealtime] 🔄 Per-table sync for: ${[...tables].join(", ")} + ${callbacksRef.current.size} callbacks`);
        // Sync each changed table individually — avoids full sync cycle (TBA, schedule, etc.)
        tables.forEach((t) => invoke("sync_table_now", { table: t }).catch(console.error));
      } else {
        console.log(`[DesktopRealtime] 🔄 Full sync + ${callbacksRef.current.size} callbacks`);
        invoke("trigger_sync_now").catch(console.error);
      }

      callbacksRef.current.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error("[DesktopRealtime] Callback error:", error);
        }
      });
    }, 500); // 500ms debounce (shorter than mobile's 2s, for snappier desktop UX)
  }, []);

  // Subscribe to Supabase realtime for user-generated data from mobile.
  // event_schedule is intentionally excluded — desktop is the writer for schedule
  // (TBA sync), so subscribing would create a feedback loop.
  useEffect(() => {
    if (!currentEvent) {
      setIsConnected(false);
      return;
    }

    // Reset reconnect tracker when event changes so first sub isn't treated as reconnect
    hasConnectedOnceRef.current = false;
    isEffectActiveRef.current = true;

    // Stable channel name per event — no incrementing counter. The counter was
    // causing every retry to be treated as a brand-new (table, filter) subscription
    // by Supabase's WAL decoder, forcing a cold-start delay on every reconnect.
    // supabase.removeChannel() on cleanup/retry is sufficient to clear stale state.
    const createChannel = () => {
      const name = `desktop-realtime-${currentEvent}`;

      const ch = supabase
        .channel(name)
        // Team data (pit scouting submissions from mobile)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_team_data" },
          (payload) => {
            // Filter client-side — avoids server-side filter cold-start delays.
            // Server-side filters force Supabase to warm a new WAL decoder slot for
            // every unique filter value, making the first event after each reconnect slow.
            //
            // Also handle 413 (payload too large): Supabase sends errors:["Error 413..."]
            // and sets new/old to {} when the row is too large to transmit. We can't
            // filter by event in that case, so refresh conservatively to avoid silent drops.
            const errors = (payload as any).errors as string[] | undefined;
            const is413 = errors?.some((e) => e.includes("413"));
            const ev = (payload.new as any)?.event ?? (payload.old as any)?.event;
            if (!is413 && ev !== currentEvent) return;
            if (is413) console.warn("[DesktopRealtime] ⚠️ event_team_data payload too large — refreshing conservatively");
            console.log(`[DesktopRealtime] 📨 event_team_data ${payload.eventType}`);
            triggerRefresh("event_team_data");
          }
        )
        // Picklists (admin edits from mobile or other desktop sessions)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_picklist" },
          (payload) => {
            const errors = (payload as any).errors as string[] | undefined;
            const is413 = errors?.some((e) => e.includes("413"));
            const ev = (payload.new as any)?.event ?? (payload.old as any)?.event;
            if (!is413 && ev !== currentEvent) return;
            if (is413) console.warn("[DesktopRealtime] ⚠️ event_picklist payload too large — refreshing conservatively");
            console.log(`[DesktopRealtime] 📨 event_picklist ${payload.eventType}`);
            triggerRefresh("event_picklist");
          }
        )
        // Match data (match scouting submissions from mobile)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_match_data" },
          (payload) => {
            const errors = (payload as any).errors as string[] | undefined;
            const is413 = errors?.some((e) => e.includes("413"));
            const ev = (payload.new as any)?.event ?? (payload.old as any)?.event;
            if (!is413 && ev !== currentEvent) return;
            if (is413) console.warn("[DesktopRealtime] ⚠️ event_match_data payload too large — refreshing conservatively");
            console.log(`[DesktopRealtime] 📨 event_match_data ${payload.eventType}`);
            triggerRefresh("event_match_data");
          }
        )
        .subscribe(handleStatus);

      channelRef.current = ch;
      return ch;
    };

    const scheduleRetry = () => {
      retryTimerRef.current = setTimeout(() => {
        if (!isEffectActiveRef.current) return;
        // Remove the broken channel before creating a fresh one so Supabase fully
        // tears down the old Phoenix socket and creates a new transport connection.
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        console.log("[DesktopRealtime] Retrying with fresh channel...");
        createChannel();
      }, 5_000);
    };

    const handleStatus = (status: any, err: any) => {
      if (err) {
        console.error("[DesktopRealtime] Subscription error:", err);
      }
      if (status === "SUBSCRIBED") {
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setIsConnected(true);

        if (hasConnectedOnceRef.current) {
          // Reconnect — catch up on any events missed while disconnected
          console.log("[DesktopRealtime] ✅ Reconnected — triggering catch-up sync");
          invoke("trigger_sync_now").catch(console.error);
        } else {
          // Initial subscription — no catch-up needed, normal 120s cycle will run
          console.log("[DesktopRealtime] ✅ Realtime subscribed");
          hasConnectedOnceRef.current = true;
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[DesktopRealtime] ${status} — retrying in 5s with fresh channel`);
        setIsConnected(false);
        scheduleRetry();
      } else if (status === "CLOSED") {
        setIsConnected(false);
        // Retry on unexpected closes (spotty network). Skip if the effect is
        // cleaning up — that's an intentional close and the channel is gone.
        if (isEffectActiveRef.current) {
          console.warn("[DesktopRealtime] CLOSED unexpectedly — retrying in 5s with fresh channel");
          scheduleRetry();
        }
      }
    };

    createChannel();

    // Presence channel — separate from postgres_changes, tracks who is actively scouting.
    // Mobile joins this channel when entering match_start or match_play. Desktop
    // subscribes (listen-only) to display who is currently in a match.
    const presenceChannel = supabase.channel(`scouting-presence-${currentEvent}`)
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        const scouts = Object.values(state)
          .flat()
          .map((p: any) => ({
            uid: p.uid ?? "",
            name: p.name ?? "",
            match: p.match ?? "",
            team: p.team ?? "",
            phase: p.phase ?? "match_start",
          } as ActiveScout));
        setActiveScouts(scouts);
        console.log(`[DesktopRealtime] 👀 Active scouts: ${scouts.length}`);
      })
      .subscribe();
    presenceChannelRef.current = presenceChannel;

    return () => {
      // Mark effect as inactive BEFORE unsubscribing so the CLOSED handler
      // triggered by unsubscribe() doesn't schedule a retry.
      isEffectActiveRef.current = false;
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
    };
  }, [currentEvent, triggerRefresh]);

  return (
    <DesktopRealtimeContext.Provider
      value={{ registerRefreshCallback, isConnected, activeScouts }}
    >
      {children}
    </DesktopRealtimeContext.Provider>
  );
}

export function useDesktopRealtime() {
  const context = useContext(DesktopRealtimeContext);
  if (!context) {
    throw new Error(
      "useDesktopRealtime must be used within DesktopRealtimeProvider"
    );
  }
  return context;
}
