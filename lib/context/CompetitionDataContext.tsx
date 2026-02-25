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
import { useEvent } from "./EventContext";
import { useSync } from "./SyncContext";
import {
  getSchedule,
  getMatchData,
  getPicklists,
  syncShiftAssignments,
} from "@lib/data";
import { fetchTBAMatchSchedule } from "@lib/tba";
import { getNexusEventStatus, type NexusMatch } from "@lib/nexus";
import type {
  EventPicklist as SupabaseEventPicklist,
} from "../data/schema";
import {
  getEventSchedule,
  getTbaMatches,
  cacheTbaMatches,
  cacheEventPicklists,
  type TbaMatch,
} from "@lib/db";
import {
  PollingController,
  LIVE_POLLING_CONFIG,
  BACKUP_API_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";
import supabase from "@lib/supabase/supabase";

export interface ScheduleEntry {
  match: string;
  team: string;
  alliance: "red" | "blue";
  name?: string; // Assigned scout name
  uid?: string; // Assigned scout uid
  // Match timing & scores (from TBA via desktop)
  est_time?: number;
  red_score?: number | null;
  blue_score?: number | null;
  // Match predictions (from Statbotics via desktop)
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
  // Statbotics predictions (from desktop sync)
  red_win_prob?: number | null;
  predicted_red_score?: number | null;
  predicted_blue_score?: number | null;
}

interface CompetitionDataContextType {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  nexusMatches: NexusMatch[];
  loading: boolean;
  initialLoading: boolean;
  refresh: () => Promise<void>;
}

const CompetitionDataContext = createContext<
  CompetitionDataContextType | undefined
>(undefined);

export function CompetitionDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { registerRefreshCallback } = useSync();
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [tbaSchedule, setTbaSchedule] = useState<Record<string, TBAMatchData>>(
    {}
  );
  const [nexusMatches, setNexusMatches] = useState<NexusMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const schedulePolling = useRef<PollingController | null>(null);
  const nexusPolling = useRef<PollingController | null>(null);
  const picklistPolling = useRef<PollingController | null>(null);
  const matchDataPolling = useRef<PollingController | null>(null);

  // Refs for stable access in refresh callback
  const fetchScheduleRef = useRef<(() => Promise<void>) | null>(null);
  const fetchNexusRef = useRef<(() => Promise<void>) | null>(null);
  const fetchPicklistsRef = useRef<(() => Promise<void>) | null>(null);
  const fetchMatchDataRef = useRef<(() => Promise<void>) | null>(null);
  const skipCacheOnceRef = useRef(false);
  const hasLoadedDataRef = useRef(false);

  const fetchSchedule = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Check if we should skip cache this time (only on event change when online)
    const shouldSkipCache = skipCacheOnceRef.current && isOnline;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false; // Clear immediately
    }

    // 1. Load from cache only on first load (no live data yet) and if not skipping.
    // Once hasLoadedDataRef is true we have live data in state — don't overwrite it
    // with potentially stale cache.
    if (!shouldSkipCache && !hasLoadedDataRef.current) {
      const [cachedSchedule, cachedTba] = await Promise.all([
        getEventSchedule(currentEvent),
        getTbaMatches(currentEvent),
      ]);

      if (cachedSchedule.length > 0) {
        setSchedule(
          cachedSchedule.map(
            (s: { match: string; team: string; alliance: string }) => ({
              match: s.match,
              team: s.team,
              alliance: s.alliance as "red" | "blue",
            })
          )
        );
        hasLoadedDataRef.current = true;
      }

      if (cachedTba.length > 0) {
        const map: Record<string, TBAMatchData> = {};
        for (const m of cachedTba as TbaMatch[]) {
          map[m.match_key] = {
            redTeams: m.red_teams,
            blueTeams: m.blue_teams,
            est_time: m.est_time ?? 0,
            redScore: m.red_score ?? null,
            blueScore: m.blue_score ?? null,
          };
        }
        setTbaSchedule(map);
      }
    }

    // 2. Network refresh
    if (isOnline) {
      console.log("[CompetitionData] Fetching schedule from network");
      // Only show loading on initial load or event change (prevents flickering on background refreshes)
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }
      try {
        const [supabaseSchedule, tbaData] = await Promise.all([
          getSchedule(currentEvent),
          fetchTBAMatchSchedule(currentEvent),
        ]);

        console.log(
          `[CompetitionData] getSchedule returned ${supabaseSchedule?.length ?? 0} entries`
        );

        // Check if desktop has synced match data
        const hasMatchData =
          supabaseSchedule &&
          supabaseSchedule.some((s: any) => s.est_time != null);

        if (supabaseSchedule) {
          const entries = supabaseSchedule.map((s: any) => ({
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

          // Build tbaSchedule from schedule entries (desktop-synced data)
          if (hasMatchData) {
            console.log("[CompetitionData] Using match data from desktop sync");
            const matchData: Record<string, TBAMatchData> = {};
            entries.forEach((entry) => {
              if (!matchData[entry.match]) {
                const matchEntries = entries.filter(
                  (e) => e.match === entry.match
                );
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
          } else {
            console.log(
              "[CompetitionData] No match data from desktop, will use TBA fallback"
            );
          }
          // Note: getSchedule() already handles caching with correct timestamp conversion
        }

        // Only use TBA data if desktop hasn't synced match data
        if (tbaData && !hasMatchData) {
          console.log("[CompetitionData] Falling back to TBA match data");
          setTbaSchedule(tbaData);
          const tbaMatches: TbaMatch[] = Object.entries(tbaData).map(
            ([key, m]) => {
              const match = m as TBAMatchData;
              return {
                event: currentEvent,
                match_key: key,
                red_teams: match.redTeams,
                blue_teams: match.blueTeams,
                est_time: match.est_time,
                red_score: match.redScore ?? undefined,
                blue_score: match.blueScore ?? undefined,
                last_synced: Date.now(),
              };
            }
          );
          await cacheTbaMatches(currentEvent, tbaMatches);
        }
        hasLoadedDataRef.current = true;
      } catch (error) {
        console.error("[CompetitionData] Error fetching schedule:", error);
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    } else {
      // Offline: done after cache
      setInitialLoading(false);
    }
  }, [currentEvent, dbInitialized, isOnline]);

  const fetchNexus = useCallback(async () => {
    if (!currentEvent || !isOnline) return;
    console.log("[CompetitionData] Fetching Nexus live data");
    try {
      const nexusData = await getNexusEventStatus(currentEvent);
      setNexusMatches(nexusData ? nexusData.matches : []);
    } catch (e) {
      console.error("[CompetitionData] Nexus fetch failed", e);
    }
  }, [currentEvent, isOnline]);

  const fetchMatchData = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Network refresh from Supabase (source of truth)
    if (isOnline) {
      console.log("[CompetitionData] Fetching match data from Supabase");
      try {
        await getMatchData(currentEvent);
        console.log("[CompetitionData] Match data synced successfully");
      } catch (error) {
        console.error("[CompetitionData] Failed to fetch match data:", error);
      }
    }
  }, [currentEvent, dbInitialized, isOnline]);

  const fetchPicklists = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Network refresh from Supabase (source of truth)
    if (isOnline) {
      console.log("[CompetitionData] Fetching picklists from Supabase");
      try {
        const data = await getPicklists(currentEvent);

        if (data && data.picklists.length > 0) {
          console.log(`[CompetitionData] Received ${data.picklists.length} picklists (isIncremental=${data.isIncremental})`);

          if (data.isIncremental) {
            // Incremental sync: getPicklists already called upsertEventPicklistsRows internally
            // with correctly-converted timestamps. Nothing more to do here — do NOT call
            // cacheEventPicklists (DELETE-all + INSERT) with a partial list.
            console.log("[CompetitionData] ✅ Incremental: cache already updated by getPicklists");
          } else {
            // Full load: replace all local picklists with the complete Supabase result.
            // Convert Supabase ISO timestamps → epoch ms for WASM SQLite INTEGER columns.
            const localPicklists = data.picklists.map(
              (p: SupabaseEventPicklist) => ({
                ...p,
                timestamp: p.timestamp
                  ? new Date(p.timestamp).getTime()
                  : undefined,
                last_modified: p.last_modified
                  ? new Date(p.last_modified).getTime()
                  : undefined,
                deleted_at: p.deleted_at
                  ? new Date(p.deleted_at).getTime()
                  : undefined,
              })
            );
            await cacheEventPicklists(currentEvent, localPicklists);
            console.log(
              `[CompetitionData] ✅ Full load: cached ${localPicklists.length} picklists`
            );
          }
        } else if (data && !data.isIncremental && data.picklists.length === 0) {
          // Full load with 0 picklists — clear cache so stale picklists don't persist
          await cacheEventPicklists(currentEvent, []);
          console.log("[CompetitionData] ✅ Full load: cleared picklists (0 in Supabase)");
        }
      } catch (error) {
        console.error("[CompetitionData] Failed to fetch picklists:", error);
      }
    }
  }, [currentEvent, dbInitialized, isOnline]);

  // Keep refs in sync
  useEffect(() => {
    fetchScheduleRef.current = fetchSchedule;
    fetchNexusRef.current = fetchNexus;
    fetchPicklistsRef.current = fetchPicklists;
    fetchMatchDataRef.current = fetchMatchData;
  }, [fetchSchedule, fetchNexus, fetchPicklists, fetchMatchData]);

  // Stable wrappers for polling - always call latest fetch functions
  const fetchScheduleStable = useCallback(async () => {
    if (fetchScheduleRef.current) {
      await fetchScheduleRef.current();
    }
  }, []); // Never changes!

  const fetchNexusStable = useCallback(async () => {
    if (fetchNexusRef.current) {
      await fetchNexusRef.current();
    }
  }, []); // Never changes!

  const fetchPicklistsStable = useCallback(async () => {
    if (fetchPicklistsRef.current) {
      await fetchPicklistsRef.current();
    }
  }, []); // Never changes!

  const fetchMatchDataStable = useCallback(async () => {
    if (fetchMatchDataRef.current) {
      await fetchMatchDataRef.current();
    }
  }, []); // Never changes!

  // Start controllers once when dbInitialized (never stop/start on event changes)
  useEffect(() => {
    if (!dbInitialized) return;

    if (!schedulePolling.current) {
      schedulePolling.current = new PollingController(
        "Schedule",
        fetchScheduleStable,
        LIVE_POLLING_CONFIG // 2min dev, 4min prod polling for shift assignments
      );
      schedulePolling.current.start();
    }
    if (!nexusPolling.current) {
      nexusPolling.current = new PollingController(
        "Nexus",
        fetchNexusStable,
        BACKUP_API_POLLING_CONFIG // 2min — no rate limits, more realtime than Supabase polls
      );
      nexusPolling.current.start();
    }
    if (!picklistPolling.current) {
      picklistPolling.current = new PollingController(
        "Picklists",
        fetchPicklistsStable,
        LIVE_POLLING_CONFIG // 2min dev, 4min prod polling for picklists
      );
      picklistPolling.current.start();
    }
    if (!matchDataPolling.current) {
      matchDataPolling.current = new PollingController(
        "Match Data",
        fetchMatchDataStable,
        LIVE_POLLING_CONFIG // 2min dev, 4min prod polling for match scouting data
      );
      matchDataPolling.current.start();
    }

    return () => {
      schedulePolling.current?.stop();
      schedulePolling.current = null;
      nexusPolling.current?.stop();
      nexusPolling.current = null;
      picklistPolling.current?.stop();
      picklistPolling.current = null;
      matchDataPolling.current?.stop();
      matchDataPolling.current = null;
    };
  }, [
    dbInitialized,
    fetchScheduleStable,
    fetchNexusStable,
    fetchPicklistsStable,
    fetchMatchDataStable,
  ]);

  // Handle event changes - fetch data immediately
  useEffect(() => {
    if (!currentEvent) {
      setSchedule([]);
      setTbaSchedule({});
      setNexusMatches([]);
      setInitialLoading(false);
      hasLoadedDataRef.current = false;
      return;
    }

    if (dbInitialized) {
      // Set skip flag when changing events (only if online and has prior data)
      if (isOnline && hasLoadedDataRef.current) {
        skipCacheOnceRef.current = true;
        setInitialLoading(true);
      }
      // Trigger one immediate fetch per data type.
      // Pollers handle the 5-min periodic background refresh.
      // forceRefresh() is NOT called here — that would duplicate these calls.
      fetchSchedule();
      fetchNexus();
      fetchPicklists();
      fetchMatchData();
    }
  }, [
    currentEvent,
    dbInitialized,
    fetchSchedule,
    fetchNexus,
    fetchPicklists,
    fetchMatchData,
    isOnline,
  ]);

  // Subscribe to Supabase realtime for schedule changes only.
  // Match data and picklists are written locally before sync, so realtime
  // is only needed to catch admin schedule edits from desktop on mobile devices.
  useEffect(() => {
    if (!currentEvent || !dbInitialized || !isOnline) return;

    // Disable realtime in development to save on Supabase free tier limits
    if (import.meta.env.DEV) {
      console.log(
        "[Competition] Realtime subscriptions disabled in development mode"
      );
      return;
    }

    console.log("[Competition] Setting up schedule realtime subscription");

    let debounceTimer: NodeJS.Timeout | null = null;
    let updateCount = 0;

    const channel = supabase
      .channel(`competition-schedule-${currentEvent}`)
      .on("system", { event: "CHANNEL_ERROR" }, (error) => {
        console.error("[Competition] Realtime channel error:", error);
      })
      // Listen for schedule changes (admin assignment updates from desktop)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_schedule",
          filter: `event=eq.${currentEvent}`,
        },
        () => {
          updateCount++;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            console.log(
              `[Competition] Realtime: Batched ${updateCount} schedule updates`
            );
            updateCount = 0;
            fetchSchedule();
            await syncShiftAssignments(currentEvent);
          }, 2000);
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("[Competition] ✅ Schedule realtime subscribed");
        } else if (status === "CHANNEL_ERROR") {
          console.error("[Competition] ❌ Realtime subscription error:", err);
        } else if (status === "TIMED_OUT") {
          console.warn("[Competition] ⏱️ Realtime subscription timed out");
        } else if (status === "CLOSED") {
          console.log("[Competition] 🔌 Realtime channel closed");
        }
      });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [currentEvent, dbInitialized, isOnline, fetchSchedule]);

  const refresh = useCallback(async () => {
    console.log("[CompetitionDataContext] Refresh callback triggered");
    // Use refs to call current fetch functions without changing callback identity.
    // forceRefresh() is NOT called — that would duplicate these fetches.
    const promises = [];
    if (fetchScheduleRef.current) promises.push(fetchScheduleRef.current());
    if (fetchNexusRef.current) promises.push(fetchNexusRef.current());
    if (fetchPicklistsRef.current) promises.push(fetchPicklistsRef.current());
    if (fetchMatchDataRef.current) promises.push(fetchMatchDataRef.current());
    await Promise.all(promises);
  }, []); // Empty dependencies - callback never changes!

  // Register refresh callback with SyncContext
  useEffect(() => {
    if (!registerRefreshCallback) return;

    console.log(
      "[CompetitionDataContext] Registering refresh callback with SyncContext"
    );
    const unregister = registerRefreshCallback(refresh);

    return () => {
      console.log("[CompetitionDataContext] Unregistering refresh callback");
      unregister();
    };
  }, [registerRefreshCallback, refresh]);

  // Memoize context value to prevent unnecessary re-renders when polling runs but data hasn't changed
  const contextValue = useMemo(
    () => ({
      schedule,
      tbaSchedule,
      nexusMatches,
      loading,
      initialLoading,
      refresh,
    }),
    [schedule, tbaSchedule, nexusMatches, loading, initialLoading, refresh]
  );

  return (
    <CompetitionDataContext.Provider value={contextValue}>
      {children}
    </CompetitionDataContext.Provider>
  );
}

export function useCompetition() {
  const context = useContext(CompetitionDataContext);
  if (context === undefined) {
    throw new Error(
      "useCompetition must be used within a CompetitionDataProvider"
    );
  }
  return context;
}
