import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDesktopEvent } from "./DesktopEventContext";
import { useDesktopRealtime } from "./DesktopRealtimeContext";
import {
  getSchedule as getSQLiteSchedule,
  getPicklists as getSQLitePicklists,
  type EventScheduleEntry,
} from "../lib/db";

export interface ScheduleEntry {
  match: string;
  team: string;
  alliance: "red" | "blue";
  name?: string;
  uid?: string;
  // Match timing & scores (from TBA via desktop backend)
  est_time?: number;
  red_score?: number | null;
  blue_score?: number | null;
  // Match predictions (from Statbotics via desktop backend)
  red_win_prob?: number | null;
  predicted_red_score?: number | null;
  predicted_blue_score?: number | null;
}

export interface TBAMatchData {
  redTeams: string[];
  blueTeams: string[];
  est_time: number;
  redScore: number | null;
  blueScore: number | null;
  red_win_prob?: number | null;
  predicted_red_score?: number | null;
  predicted_blue_score?: number | null;
}

export interface TbaClimbEntry {
  event: string;
  match_key: string;
  team: string;
  auto_climb: "L1" | "L2" | "L3" | null;
  teleop_climb: "L1" | "L2" | "L3" | null;
}

export interface PicklistEntry {
  team: string;
  rank: number;
  flags: Record<string, unknown> | null;
}

export interface Picklist {
  event: string;
  id: string;
  title: string;
  picklist: PicklistEntry[];
  uname: string;
  uid: string;
  type?: string; // "public" | "private" | "default"
  timestamp: number;
  last_modified: number;
}

interface DesktopCompetitionDataContextType {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  picklists: Picklist[];
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>;
  loading: boolean;
  lastDataRefreshAt: number; // Bumped each time SQLite is re-read; watch this to react to syncs
  refresh: () => Promise<void>;
  refreshFromCache: () => Promise<void>;
}

const DesktopCompetitionDataContext = createContext<
  DesktopCompetitionDataContextType | undefined
>(undefined);

export function DesktopCompetitionDataProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { currentEvent } = useDesktopEvent();
  const { registerRefreshCallback } = useDesktopRealtime();

  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [tbaSchedule, setTbaSchedule] = useState<Record<string, TBAMatchData>>(
    {}
  );
  const [picklists, setPicklists] = useState<Picklist[]>([]);
  const [tbaClimbData, setTbaClimbData] = useState<Record<string, Record<string, TbaClimbEntry>>>({});
  const [loading, setLoading] = useState(false);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState(0);

  const hasLoadedDataRef = useRef(false);
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Process schedule data into display format
   */
  const processScheduleData = (scheduleData: EventScheduleEntry[]) => {
    const entries: ScheduleEntry[] = scheduleData.map((s) => ({
      match: s.match,
      team: s.team,
      alliance: s.alliance as "red" | "blue",
      name: s.name,
      uid: s.uid,
      est_time: s.est_time,
      red_score: s.red_score,
      blue_score: s.blue_score,
      red_win_prob: s.red_win_prob,
      predicted_red_score: s.predicted_red_score,
      predicted_blue_score: s.predicted_blue_score,
    }));
    setSchedule(entries);

    const matchData: Record<string, TBAMatchData> = {};
    entries.forEach((entry) => {
      if (!matchData[entry.match]) {
        const matchEntries = entries.filter((e) => e.match === entry.match);
        matchData[entry.match] = {
          redTeams: matchEntries
            .filter((e) => e.alliance === "red")
            .map((e) => e.team),
          blueTeams: matchEntries
            .filter((e) => e.alliance === "blue")
            .map((e) => e.team),
          est_time: entry.est_time ?? 0,
          redScore: entry.red_score ?? null,
          blueScore: entry.blue_score ?? null,
          red_win_prob: entry.red_win_prob,
          predicted_red_score: entry.predicted_red_score,
          predicted_blue_score: entry.predicted_blue_score,
        };
      }
    });
    setTbaSchedule(matchData);
  };

  /**
   * Read schedule, picklists, and climb data from local SQLite cache.
   * Rust sync service (120s, incremental) is the sole Supabase reader —
   * the frontend never calls Supabase directly for these tables.
   *
   * Shows whatever SQLite has immediately (offline-safe). Rust sync updates
   * SQLite in the background; subsequent polls pick up fresh data silently.
   */
  const fetchData = useCallback(async () => {
    if (!currentEvent) return;

    try {
      const [cachedSchedule, cachedPicklists] = await Promise.all([
        getSQLiteSchedule(currentEvent),
        getSQLitePicklists(currentEvent),
      ]);

      if (cachedSchedule.length > 0) {
        processScheduleData(cachedSchedule);
        hasLoadedDataRef.current = true;
      }

      setPicklists(cachedPicklists);

      // TBA climb data (populated by Rust sync service)
      try {
        const climbEntries = await invoke<TbaClimbEntry[]>("get_tba_climb_data", { event: currentEvent });
        const climbMap: Record<string, Record<string, TbaClimbEntry>> = {};
        for (const entry of climbEntries) {
          if (!climbMap[entry.match_key]) climbMap[entry.match_key] = {};
          climbMap[entry.match_key][entry.team] = entry;
        }
        setTbaClimbData(climbMap);
      } catch {
        // Non-fatal: TBA climb data not available yet
      }
    } catch (error) {
      console.error("[DesktopCompetitionData] Failed to read from SQLite:", error);
    } finally {
      setLoading(false);
      setLastDataRefreshAt(Date.now());
    }
  }, [currentEvent]);

  // Keep fetchDataRef in sync with latest callback
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Handle event changes
  useEffect(() => {
    if (!currentEvent) {
      setSchedule([]);
      setTbaSchedule({});
      setPicklists([]);
      setTbaClimbData({});
      hasLoadedDataRef.current = false;
      return;
    }

    // Show loading when switching events (if we had data from a prior event)
    if (hasLoadedDataRef.current) {
      setLoading(true);
      hasLoadedDataRef.current = false;
    }

    // 1. Read SQLite immediately — shows cached/stale data (offline-safe)
    fetchData();

    // 2. Trigger Rust sync to pull fresh Supabase data into SQLite
    invoke("trigger_sync_now").catch((e) =>
      console.warn("[DesktopCompetitionData] trigger_sync_now failed:", e)
    );

    // 3. Re-read SQLite after sync has had time to write. Multiple reads
    //    because cold-start sync time varies (5-35s across all tables).
    //    Team data is fetched late in the sync cycle (~step 16 of 17), so a
    //    35s poll is needed to reliably catch priority/pit data on first load.
    //    Stale data from step 1 stays visible until a poll finds fresh data.
    const pollDelays = [5_000, 10_000, 20_000, 35_000];
    const timers = pollDelays.map((delay) =>
      setTimeout(() => {
        console.log(`[DesktopCompetitionData] Post-sync poll at ${delay / 1000}s`);
        fetchDataRef.current?.();
      }, delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [currentEvent, fetchData]);

  // Every 120s: trigger a Rust sync then re-read SQLite once the sync has had time to write.
  // This ensures Supabase changes (picklist edits, new scouting data) are visible within ~135s.
  useEffect(() => {
    if (!currentEvent) return;

    const timer = setInterval(() => {
      console.log("[DesktopCompetitionData] Triggering sync + SQLite refresh (120s)");
      invoke("trigger_sync_now").catch(console.error);
      // Re-read SQLite after the sync has had time to complete (~15s for TBA + Supabase pulls)
      setTimeout(() => {
        console.log("[DesktopCompetitionData] Post-sync SQLite refresh (120s+15s)");
        fetchDataRef.current?.();
      }, 15_000);
    }, 120_000);

    return () => clearInterval(timer);
  }, [currentEvent]);

  // Register refresh callback for realtime updates (when realtime is re-enabled)
  useEffect(() => {
    if (!currentEvent) return;

    const unregister = registerRefreshCallback(() => {
      // Realtime change detected: trigger Rust sync, then re-read SQLite
      invoke("trigger_sync_now").catch(console.error);
      setTimeout(() => fetchDataRef.current?.(), 3_000);
    });

    return unregister;
  }, [currentEvent, registerRefreshCallback]);

  const refresh = useCallback(async () => {
    if (fetchDataRef.current) {
      await fetchDataRef.current();
    }
  }, []);

  // refreshFromCache is an alias for fetchData (both read SQLite only now)
  const refreshFromCache = fetchData;

  const contextValue = useMemo(
    () => ({
      schedule,
      tbaSchedule,
      picklists,
      tbaClimbData,
      loading,
      lastDataRefreshAt,
      refresh,
      refreshFromCache,
    }),
    [schedule, tbaSchedule, picklists, tbaClimbData, loading, lastDataRefreshAt, refresh, refreshFromCache]
  );

  return (
    <DesktopCompetitionDataContext.Provider value={contextValue}>
      {children}
    </DesktopCompetitionDataContext.Provider>
  );
}

export function useDesktopCompetitionData() {
  const context = useContext(DesktopCompetitionDataContext);
  if (!context) {
    throw new Error(
      "useDesktopCompetitionData must be used within DesktopCompetitionDataProvider"
    );
  }
  return context;
}
