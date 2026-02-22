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
  const callbacksRef = useRef<Set<() => void>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

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

      callbacksRef.current.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error("[DesktopRealtime] Callback error:", error);
        }
      });
    }, 500); // 500ms debounce (shorter than mobile's 2s, for snappier desktop UX)
  }, []);
  
  // Subscribe to Supabase realtime
  useEffect(() => {
    // TEMPORARILY DISABLED: Realtime disabled to conserve Supabase limits
    // Re-enable after monthly reset or upgrade to paid plan
    console.log("[DesktopRealtime] Realtime subscriptions DISABLED (conserving limits)");
    setIsConnected(false);
    return;

    // eslint-disable-next-line no-unreachable
    if (!currentEvent) {
      setIsConnected(false);
      return;
    }

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
        () => triggerRefresh()
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
        () => triggerRefresh()
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
        () => triggerRefresh()
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
        () => triggerRefresh()
      )
      .subscribe((status: any, err: any) => {
        if (err) {
          console.error("[DesktopRealtime] Subscription error:", err);
        }
        if (status === "SUBSCRIBED") {
          setIsConnected(true);
        } else if (status === "CHANNEL_ERROR") {
          console.error("[DesktopRealtime] Channel error");
          setIsConnected(false);
        } else if (status === "TIMED_OUT") {
          console.error("[DesktopRealtime] Connection timed out");
          setIsConnected(false);
        } else if (status === "CLOSED") {
          setIsConnected(false);
        }
      });

    // Cleanup on event change or unmount
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Best practice: unsubscribe before removing
      channel.unsubscribe();
      supabase.removeChannel(channel);
      setIsConnected(false);

      console.log("[DesktopRealtime] ✅ Channel removed");
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
