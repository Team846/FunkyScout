import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useDesktopEvent } from "./DesktopEventContext";
import { useDesktopRealtime } from "./DesktopRealtimeContext";
import {
  getSchedule as getSQLiteSchedule,
  getPicklists as getSQLitePicklists,
  getPicklistEntries as getSQLitePicklistEntries,
  cacheSchedule,
  cachePicklists,
  cachePicklistEntries,
  type EventScheduleEntry,
} from "../lib/db";
import supabase from "@lib/supabase/supabase";

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

export interface Picklist {
  event: string;
  id: string;
  title: string;
  uname: string;
  uid: string;
  timestamp: number;
  last_modified: number;
}

export interface PicklistEntry {
  event: string;
  id: string;
  team: string;
  rank: number;
  last_modified: number;
}

interface DesktopCompetitionDataContextType {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  picklists: Picklist[];
  picklistEntries: PicklistEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
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
  const [picklistEntries, setPicklistEntries] = useState<PicklistEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Refs for stable access in callbacks
  const skipCacheOnceRef = useRef(false);
  const hasLoadedDataRef = useRef(false);
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Three-step fetch pattern for schedule and picklists
   */
  const fetchData = useCallback(async () => {
    if (!currentEvent) return;

    const shouldSkipCache = skipCacheOnceRef.current && true;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false;
    }

    try {
      // Step 1: Read from SQLite cache (unless skipping)
      if (!shouldSkipCache) {
        console.log("[DesktopCompetitionData] Reading from SQLite cache");
        const [cachedSchedule, cachedPicklists, cachedEntries] =
          await Promise.all([
            getSQLiteSchedule(currentEvent),
            getSQLitePicklists(currentEvent),
            getSQLitePicklistEntries(currentEvent),
          ]);

        if (cachedSchedule.length > 0) {
          processScheduleData(cachedSchedule);
          hasLoadedDataRef.current = true;
        }

        // Always set picklists from cache (even if empty, to show loading state correctly)
        setPicklists(cachedPicklists);
        setPicklistEntries(cachedEntries);
      }

      // Step 2: Refresh from Supabase if online
      if (true) {
        console.log("[DesktopCompetitionData] Fetching from Supabase");

        // Only show loading on initial load or event change (prevents flickering on background refreshes)
        const isInitialLoad = !hasLoadedDataRef.current;
        if (isInitialLoad || shouldSkipCache) {
          setLoading(true);
        }

        const [supabaseSchedule, supabasePicklists, supabaseEntries] =
          await Promise.all([
            fetchScheduleFromSupabase(currentEvent),
            fetchPicklistsFromSupabase(currentEvent),
            fetchPicklistEntriesFromSupabase(currentEvent),
          ]);

        if (supabaseSchedule && supabaseSchedule.length > 0) {
          console.log(
            `[DesktopCompetitionData] Fetched ${supabaseSchedule.length} schedule entries from Supabase`
          );

          // Cache to SQLite for offline access (like mobile does)
          await cacheSchedule(
            currentEvent,
            supabaseSchedule.map((d: any) => ({
              match: d.match,
              team: d.team,
              alliance: d.alliance,
              name: d.name,
              uid: d.uid,
              est_time: d.est_time,
              red_score: d.red_score,
              blue_score: d.blue_score,
              red_win_prob: d.red_win_prob,
              predicted_red_score: d.predicted_red_score,
              predicted_blue_score: d.predicted_blue_score,
              last_modified: d.last_modified
                ? new Date(d.last_modified).getTime()
                : Date.now(),
            }))
          );

          processScheduleData(supabaseSchedule);
          hasLoadedDataRef.current = true;
        }

        // Always cache and update picklists from Supabase (even if empty)
        console.log(
          `[DesktopCompetitionData] Fetched ${supabasePicklists?.length ?? 0} picklists, ${supabaseEntries?.length ?? 0} entries from Supabase`
        );

        if (supabasePicklists && supabasePicklists.length > 0) {
          console.log("[DesktopCompetitionData] Caching picklists to SQLite");
          await cachePicklists(
            supabasePicklists.map((p: any) => ({
              ...p,
              event: currentEvent,
            }))
          );
          console.log("[DesktopCompetitionData] Picklists cached successfully");
        }

        if (supabaseEntries && supabaseEntries.length > 0) {
          console.log("[DesktopCompetitionData] Caching picklist entries to SQLite");
          await cachePicklistEntries(
            supabaseEntries.map((e: any) => ({
              ...e,
              event: currentEvent,
            }))
          );
          console.log("[DesktopCompetitionData] Picklist entries cached successfully");
        }

        setPicklists(supabasePicklists || []);
        setPicklistEntries(supabaseEntries || []);
        console.log(
          `[DesktopCompetitionData] Set state: ${supabasePicklists?.length ?? 0} picklists, ${supabaseEntries?.length ?? 0} entries`
        );
      }
    } catch (error) {
      console.error("[DesktopCompetitionData] Fetch failed:", error);
    } finally {
      setLoading(false);
    }
  }, [currentEvent, true]);

  /**
   * Fetch schedule from Supabase
   */
  const fetchScheduleFromSupabase = async (eventKey: string) => {
    const { data, error } = await supabase
      .from("event_schedule")
      .select(
        `
        event,
        match,
        team,
        alliance,
        name,
        uid,
        est_time,
        red_score,
        blue_score,
        red_win_prob,
        predicted_red_score,
        predicted_blue_score,
        last_modified
      `
      )
      .eq("event", eventKey)
      .is("deleted_at", null);

    if (error) throw error;
    return data as EventScheduleEntry[];
  };

  /**
   * Fetch picklists from Supabase
   */
  const fetchPicklistsFromSupabase = async (eventKey: string) => {
    const { data, error } = await supabase
      .from("event_picklist")
      .select("*")
      .eq("event", eventKey)
      .is("deleted_at", null)
      .order("timestamp", { ascending: false });

    if (error) throw error;
    return (data as any[]).map((p) => ({
      ...p,
      timestamp: p.timestamp ? new Date(p.timestamp).getTime() : 0,
      last_modified: p.last_modified
        ? new Date(p.last_modified).getTime()
        : 0,
    })) as Picklist[];
  };

  /**
   * Fetch picklist entries from Supabase
   */
  const fetchPicklistEntriesFromSupabase = async (eventKey: string) => {
    console.log("[DesktopCompetitionData] Fetching picklist entries for:", eventKey);
    const { data, error } = await supabase
      .from("event_picklist_entries")
      .select("*")
      .eq("event", eventKey)
      .is("deleted_at", null)
      .order("rank", { ascending: true });

    if (error) {
      console.error("[DesktopCompetitionData] Error fetching picklist entries:", error);
      throw error;
    }
    console.log("[DesktopCompetitionData] Raw picklist entries from Supabase:", data);
    const entries = (data as any[]).map((e) => ({
      ...e,
      last_modified: e.last_modified
        ? new Date(e.last_modified).getTime()
        : 0,
    })) as PicklistEntry[];
    console.log("[DesktopCompetitionData] Processed picklist entries:", entries);
    return entries;
  };

  /**
   * Process schedule data into display format
   */
  const processScheduleData = (scheduleData: EventScheduleEntry[]) => {
    // Convert to schedule entries
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

    // Build TBA schedule map (grouped by match)
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

  // Keep ref in sync
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Handle event changes
  useEffect(() => {
    if (!currentEvent) {
      setSchedule([]);
      setTbaSchedule({});
      setPicklists([]);
      setPicklistEntries([]);
      hasLoadedDataRef.current = false;
      return;
    }

    // Skip cache when switching events (if online and has prior data)
    if (true && hasLoadedDataRef.current) {
      skipCacheOnceRef.current = true;
    }

    fetchData();
  }, [currentEvent, fetchData, true]);

  // Register refresh callback for realtime updates
  useEffect(() => {
    if (!currentEvent) return;

    console.log(
      "[DesktopCompetitionData] Registering realtime refresh callback"
    );

    const unregister = registerRefreshCallback(() => {
      console.log(
        "[DesktopCompetitionData] Realtime update - forcing fresh fetch"
      );
      skipCacheOnceRef.current = true; // Skip cache, fetch from Supabase
      if (fetchDataRef.current) {
        fetchDataRef.current();
      }
    });

    return unregister;
  }, [currentEvent, registerRefreshCallback]);

  const refresh = useCallback(async () => {
    console.log("[DesktopCompetitionData] Manual refresh triggered");
    if (fetchDataRef.current) {
      await fetchDataRef.current();
    }
  }, []);

  return (
    <DesktopCompetitionDataContext.Provider
      value={{
        schedule,
        tbaSchedule,
        picklists,
        picklistEntries,
        loading,
        refresh,
      }}
    >
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
