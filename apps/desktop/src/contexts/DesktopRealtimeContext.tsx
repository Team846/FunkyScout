import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
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
  const [callbacks, setCallbacks] = useState<Set<() => void>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

  // Debouncing state to batch rapid updates
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateCountRef = useRef(0);

  // Register a callback to be called on realtime updates
  const registerRefreshCallback = useCallback((callback: () => void) => {
    setCallbacks((prev) => {
      const next = new Set(prev);
      next.add(callback);
      return next;
    });

    // Return unregister function
    return () => {
      setCallbacks((prev) => {
        const next = new Set(prev);
        next.delete(callback);
        return next;
      });
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
      console.log(
        `[DesktopRealtime] Batched ${updateCountRef.current} updates, triggering ${callbacks.size} callbacks`
      );
      updateCountRef.current = 0;

      callbacks.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error("[DesktopRealtime] Callback error:", error);
        }
      });
    }, 500); // 500ms debounce (shorter than mobile's 2s, for snappier desktop UX)
  }, [callbacks]);

  // Subscribe to Supabase realtime
  useEffect(() => {
    if (!currentEvent) {
      setIsConnected(false);
      return;
    }

    console.log(
      "[DesktopRealtime] Subscribing to realtime for event:",
      currentEvent
    );

    const channel = supabase
      .channel(`desktop-realtime-${currentEvent}`)
      // Team data (pit scouting from mobile)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_team_data",
          filter: `event=eq.${currentEvent}`,
        },
        (payload: any) => {
          console.log("[DesktopRealtime] event_team_data update:", payload);
          triggerRefresh();
        }
      )
      // Schedule (shift assignments from mobile, match data from backend)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_schedule",
          filter: `event=eq.${currentEvent}`,
        },
        (payload: any) => {
          console.log("[DesktopRealtime] event_schedule update:", payload);
          triggerRefresh();
        }
      )
      // Picklists (picklist updates from mobile/desktop)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_picklist",
          filter: `event=eq.${currentEvent}`,
        },
        (payload: any) => {
          console.log("[DesktopRealtime] event_picklist update:", payload);
          triggerRefresh();
        }
      )
      // Picklist entries (team add/remove/reorder)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_picklist_entries",
          filter: `event=eq.${currentEvent}`,
        },
        (payload: any) => {
          console.log(
            "[DesktopRealtime] event_picklist_entries update:",
            payload
          );
          triggerRefresh();
        }
      )
      // Match data (match scouting from mobile)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_match_data",
          filter: `event=eq.${currentEvent}`,
        },
        (payload: any) => {
          console.log("[DesktopRealtime] event_match_data update:", payload);
          triggerRefresh();
        }
      )
      .subscribe((status: any, err: any) => {
        console.log("[DesktopRealtime] Subscription status:", status);
        if (err) {
          console.error("[DesktopRealtime] Subscription error:", err);
        }
        if (status === "SUBSCRIBED") {
          console.log(
            "[DesktopRealtime] ✅ Successfully subscribed to realtime updates"
          );
          setIsConnected(true);
        } else if (status === "CHANNEL_ERROR") {
          console.error(
            "[DesktopRealtime] ❌ Channel error - check Supabase realtime config"
          );
          setIsConnected(false);
        } else if (status === "TIMED_OUT") {
          console.error("[DesktopRealtime] ❌ Connection timed out");
          setIsConnected(false);
        } else if (status === "CLOSED") {
          console.log("[DesktopRealtime] Connection closed");
          setIsConnected(false);
        }
      });

    // Cleanup on event change or unmount
    return () => {
      console.log("[DesktopRealtime] Unsubscribing from realtime");

      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

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
