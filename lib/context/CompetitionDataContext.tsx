import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useEvent } from "./EventContext";
import { useSync } from "./SyncContext";
import { getSchedule, getPicklists } from "@lib/data";
import { fetchTBAMatchSchedule } from "@lib/tba";
import { getNexusEventStatus, type NexusMatch } from "@lib/nexus";
import type { EventPicklist as SupabaseEventPicklist, EventPicklistEntry as SupabaseEventPicklistEntry } from "../data/schema";
import {
  getEventSchedule,
  cacheEventSchedule,
  getTbaMatches,
  cacheTbaMatches,
  cacheEventPicklists,
  cacheEventPicklistEntries,
  type TbaMatch,
} from "@lib/db";
import {
  PollingController,
  DEFAULT_POLLING_CONFIG,
  LIVE_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";

export interface ScheduleEntry {
  match: string;
  team: string;
  alliance: "red" | "blue";
}

export interface TBAMatchData {
  redTeams: string[];
  blueTeams: string[];
  est_time: number;
  redScore: number | null;
  blueScore: number | null;
}

interface CompetitionDataContextType {
  schedule: ScheduleEntry[];
  tbaSchedule: Record<string, TBAMatchData>;
  nexusMatches: NexusMatch[];
  loading: boolean;
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

  const schedulePolling = useRef<PollingController | null>(null);
  const nexusPolling = useRef<PollingController | null>(null);
  const picklistPolling = useRef<PollingController | null>(null);

  // Refs for stable access in refresh callback
  const fetchScheduleRef = useRef<(() => Promise<void>) | null>(null);
  const fetchNexusRef = useRef<(() => Promise<void>) | null>(null);
  const fetchPicklistsRef = useRef<(() => Promise<void>) | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // 1. Load from cache
    const [cachedSchedule, cachedTba] = await Promise.all([
      getEventSchedule(currentEvent),
      getTbaMatches(currentEvent),
    ]);

    if (cachedSchedule.length > 0) {
      setSchedule(
        cachedSchedule.map((s: { match: string; team: string; alliance: string }) => ({
          match: s.match,
          team: s.team,
          alliance: s.alliance as "red" | "blue",
        }))
      );
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

    // 2. Network refresh
    if (isOnline) {
      console.log("[CompetitionData] Fetching schedule from network");
      setLoading(true);
      try {
        const [supabaseSchedule, tbaData] = await Promise.all([
          getSchedule(currentEvent),
          fetchTBAMatchSchedule(currentEvent),
        ]);

        if (supabaseSchedule) {
          const entries = supabaseSchedule.map((s: { match: string; team: string; alliance: string; name?: string; uid?: string; last_modified?: string; deleted_at?: string | null }) => ({
            match: s.match,
            team: s.team,
            alliance: s.alliance as "red" | "blue",
          }));
          setSchedule(entries);
          // Cache full schedule entries with name and uid for shift assignments (convert string timestamps to numbers for SQLite)
          await cacheEventSchedule(
            supabaseSchedule.map((s: { match: string; team: string; alliance: string; name?: string; uid?: string; last_modified?: string; deleted_at?: string | null }) => ({
              event: currentEvent,
              match: s.match,
              team: s.team,
              alliance: s.alliance as "red" | "blue",
              name: s.name,
              uid: s.uid,
              last_modified: s.last_modified ? new Date(s.last_modified).getTime() : undefined,
              deleted_at: s.deleted_at ? new Date(s.deleted_at).getTime() : undefined,
            }))
          );
        }

        if (tbaData) {
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
      } finally {
        setLoading(false);
      }
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

  const fetchPicklists = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Network refresh from Supabase (source of truth)
    if (isOnline) {
      console.log("[CompetitionData] Fetching picklists from Supabase");
      try {
        const data = await getPicklists(currentEvent);

        if (data) {
          // Convert Supabase schema (string timestamps) to local SQLite schema (number timestamps)
          const localPicklists = data.picklists.map((p: SupabaseEventPicklist) => ({
            ...p,
            timestamp: p.timestamp ? new Date(p.timestamp).getTime() : undefined,
            last_modified: p.last_modified ? new Date(p.last_modified).getTime() : undefined,
            deleted_at: p.deleted_at ? new Date(p.deleted_at).getTime() : undefined,
          }));

          const localEntries = data.entries.map((e: SupabaseEventPicklistEntry) => ({
            ...e,
            last_modified: e.last_modified ? new Date(e.last_modified).getTime() : undefined,
            deleted_at: e.deleted_at ? new Date(e.deleted_at).getTime() : undefined,
          }));

          // Cache picklists to local SQLite
          await cacheEventPicklists(localPicklists);

          // Cache picklist entries to local SQLite
          if (localEntries.length > 0) {
            await cacheEventPicklistEntries(localEntries);
          }

          console.log(
            `[CompetitionData] Synced ${data.picklists.length} picklists with ${data.entries.length} entries from Supabase`,
          );
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
  }, [fetchSchedule, fetchNexus, fetchPicklists]);

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

  // Start controllers once when dbInitialized (never stop/start on event changes)
  useEffect(() => {
    if (!dbInitialized) return;

    if (!schedulePolling.current) {
      schedulePolling.current = new PollingController(
        "Schedule",
        fetchScheduleStable,
        DEFAULT_POLLING_CONFIG
      );
      schedulePolling.current.start();
    }
    if (!nexusPolling.current) {
      nexusPolling.current = new PollingController(
        "Nexus",
        fetchNexusStable,
        LIVE_POLLING_CONFIG
      );
      nexusPolling.current.start();
    }
    if (!picklistPolling.current) {
      picklistPolling.current = new PollingController(
        "Picklists",
        fetchPicklistsStable,
        DEFAULT_POLLING_CONFIG
      );
      picklistPolling.current.start();
    }

    return () => {
      schedulePolling.current?.stop();
      nexusPolling.current?.stop();
      picklistPolling.current?.stop();
    };
  }, [dbInitialized, fetchScheduleStable, fetchNexusStable, fetchPicklistsStable]);

  // Handle event changes - fetch data immediately
  useEffect(() => {
    if (!currentEvent) {
      setSchedule([]);
      setTbaSchedule({});
      setNexusMatches([]);
    return;
    }

    if (dbInitialized) {
      // Clear state to show empty UI while new data loads
      setSchedule([]);
      setTbaSchedule({});
      setNexusMatches([]);
      // Fetch schedule, nexus, and picklist data immediately when event changes
      fetchSchedule();
      fetchNexus();
      fetchPicklists();
    }
  }, [currentEvent, dbInitialized, fetchSchedule, fetchNexus, fetchPicklists]);

  const refresh = useCallback(async () => {
    console.log("[CompetitionDataContext] Refresh callback triggered");
    // Use refs to call current fetch functions without changing callback identity
    const promises = [];
    if (fetchScheduleRef.current) promises.push(fetchScheduleRef.current());
    if (fetchNexusRef.current) promises.push(fetchNexusRef.current());
    if (fetchPicklistsRef.current) promises.push(fetchPicklistsRef.current());
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

  return (
    <CompetitionDataContext.Provider
      value={{ schedule, tbaSchedule, nexusMatches, loading, refresh }}
    >
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
