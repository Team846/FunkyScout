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

interface DesktopRealtimeContextType {
  registerRefreshCallback: (callback: () => void) => () => void;
  isConnected: boolean;
}

const DesktopRealtimeContext = createContext<
  DesktopRealtimeContextType | undefined
>(undefined);

export function DesktopRealtimeProvider({ children }: { children: ReactNode }) {
  const { currentEvent } = useDesktopEvent();
  const callbacksRef = useRef<Set<() => void>>(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track whether this is a reconnect (vs. initial subscription) so we can
  // trigger a catch-up sync only when we've been disconnected and come back.
  const hasConnectedOnceRef = useRef(false);
  // Set to false during effect cleanup so CLOSED doesn't schedule a retry
  // against an already-removed channel (e.g. on unmount or event change).
  const isEffectActiveRef = useRef(false);

  // Debouncing state to batch rapid updates
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateCountRef = useRef(0);

  // Register a callback to be called on realtime updates
  const registerRefreshCallback = useCallback((callback: () => void) => {
    callbacksRef.current.add(callback);

    // Return unregister function
    return () => {
      callbacksRef.current.delete(callback);
    };
  }, []);

  // Call all registered callbacks (debounced)
  const triggerRefresh = useCallback(() => {
    updateCountRef.current++;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to batch updates
    debounceTimerRef.current = setTimeout(() => {
      updateCountRef.current = 0;

      // Trigger one Rust sync cycle for the whole batch — called here so each
      // consumer context doesn't need to independently invoke it.
      invoke("trigger_sync_now").catch(console.error);

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
        console.warn(`[DesktopRealtime] ${status} — retrying in 5s`);
        setIsConnected(false);
        retryTimerRef.current = setTimeout(() => {
          console.log("[DesktopRealtime] Retrying subscription...");
          channel.subscribe(handleStatus);
        }, 5_000);
      } else if (status === "CLOSED") {
        setIsConnected(false);
        // Retry on unexpected closes (spotty network). Skip if the effect is
        // cleaning up — that's an intentional close and the channel is gone.
        if (isEffectActiveRef.current) {
          console.warn("[DesktopRealtime] CLOSED unexpectedly — retrying in 5s");
          retryTimerRef.current = setTimeout(() => {
            console.log("[DesktopRealtime] Retrying after CLOSED...");
            channel.subscribe(handleStatus);
          }, 5_000);
        }
      }
    };

    const channel = supabase
      .channel(`desktop-realtime-${currentEvent}`)
      // Team data (pit scouting submissions from mobile)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_team_data",
          filter: `event=eq.${currentEvent}`,
        },
        () => triggerRefresh()
      )
      // Picklists (admin edits from mobile or other desktop sessions)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_picklist",
          filter: `event=eq.${currentEvent}`,
        },
        () => triggerRefresh()
      )
      // Match data (match scouting submissions from mobile)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_match_data",
          filter: `event=eq.${currentEvent}`,
        },
        () => triggerRefresh()
      )
      .subscribe(handleStatus);

    return () => {
      // Mark effect as inactive BEFORE unsubscribing so the CLOSED handler
      // triggered by unsubscribe() doesn't schedule a retry.
      isEffectActiveRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      channel.unsubscribe();
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [currentEvent, triggerRefresh]);

  return (
    <DesktopRealtimeContext.Provider
      value={{ registerRefreshCallback, isConnected }}
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
