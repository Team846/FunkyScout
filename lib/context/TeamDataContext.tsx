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
import { getTeams } from "@lib/data";
import {
  getTbaTeams,
  cacheTbaTeams,
  getEventTeamData,
  type TbaTeam,
  type EventTeamData,
} from "@lib/db";
import {
  PollingController,
  LIVE_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";

export interface Team {
  key: string;
  num: number;
  name: string;
  rank: number;
}

export interface TBATeam {
  key: string;
  team: number;
  name: string;
  rank: number;
  record: { wins: number; losses: number; ties: number };
  nextMatch: string | null;
  lastMatch: string | null;
  epa?: {
    total_points?: { mean?: number; sd?: number };
    auto?: { mean?: number; sd?: number };
    teleop?: { mean?: number; sd?: number };
    endgame?: { mean?: number; sd?: number };
    norm?: number;
  } | null;
  opr?: number;
  dpr?: number;
}

interface TeamDataContextType {
  teams: Team[];
  tbaTeams: TBATeam[];
  loading: boolean;
  initialLoading: boolean;
  refresh: () => Promise<void>;
  scoutedTeams: Set<string>; // Team keys that have been pit scouted
  teamAssignments: Map<string, string>; // Map of teamKey -> assignedUid
}

const TeamDataContext = createContext<TeamDataContextType | undefined>(
  undefined
);

export function TeamDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { registerRefreshCallback } = useSync();
  const [teams, setTeams] = useState<Team[]>([]);
  const [tbaTeams, setTbaTeams] = useState<TBATeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const [teamAssignments, setTeamAssignments] = useState<Map<string, string>>(
    new Map()
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const pollingController = useRef<PollingController | null>(null);

  // Refs for stable access in refresh callback
  const fetchTeamsRef = useRef<(() => Promise<void>) | null>(null);
  const currentEventRef = useRef(currentEvent);
  const skipCacheOnceRef = useRef(false);
  const hasLoadedDataRef = useRef(false);
  const isFetchingRef = useRef(false);

  const fetchTeams = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Prevent concurrent fetches — if one is already in progress, skip this call.
    // The in-progress fetch will still complete and update state correctly.
    if (isFetchingRef.current) {
      console.log("[TeamData] Skipping fetch — already in progress");
      return;
    }
    isFetchingRef.current = true;

    // Check if we should skip cache this time (only on event change when online)
    const shouldSkipCache = skipCacheOnceRef.current && isOnline;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false; // Clear immediately
    }

    // 1. Load from cache only on first load (no live data yet) and if not skipping.
    // Once hasLoadedDataRef is true we have live data in state — don't overwrite it
    // with potentially stale cache (avoids the flash-then-revert race condition).
    if (!shouldSkipCache && !hasLoadedDataRef.current) {
      const cached = await getTbaTeams(currentEvent);
      if (cached.length > 0) {
        setTeams(
          cached.map((t: TbaTeam) => ({
            key: t.team_key,
            num: t.team_number,
            name: t.name ?? "",
            rank: t.rank ?? 0,
          }))
        );
        setTbaTeams(
          cached.map((t: TbaTeam) => ({
            key: t.team_key,
            team: t.team_number,
            name: t.name ?? "",
            rank: t.rank ?? 0,
            record: {
              wins: t.wins ?? 0,
              losses: t.losses ?? 0,
              ties: t.ties ?? 0,
            },
            nextMatch: t.next_match || null,
            lastMatch: t.last_match || null,
          }))
        );
        hasLoadedDataRef.current = true;
      }
    }

    // 2. Refresh from Supabase if online
    if (isOnline) {
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }
      try {
        const supabaseTeams = await getTeams(currentEvent);

        // All stats (rank, EPA, OPR, record) are pushed to Supabase by desktop every ~120s
        const merged: TbaTeam[] = (supabaseTeams ?? []).map(
          (supabaseTeam: {
            event: string;
            team: string;
            data?: any;
            team_name?: string;
          }) => {
            const teamNumber = parseInt(
              supabaseTeam.team.replace("frc", ""),
              10
            );
            return {
              event: currentEvent,
              team_key: supabaseTeam.team,
              team_number: teamNumber,
              name: supabaseTeam.team_name ?? `Team ${teamNumber}`,
              rank: supabaseTeam.data?.rank ?? 0,
              wins: supabaseTeam.data?.record?.wins ?? 0,
              losses: supabaseTeam.data?.record?.losses ?? 0,
              ties: supabaseTeam.data?.record?.ties ?? 0,
              epa: supabaseTeam.data?.epa ?? null,
              opr: supabaseTeam.data?.opr ?? undefined,
              dpr: supabaseTeam.data?.dpr ?? undefined,
              next_match: supabaseTeam.data?.next_match || undefined,
              last_match: supabaseTeam.data?.last_match || undefined,
              last_synced: Date.now(),
            };
          }
        );

        merged.sort((a, b) => a.team_number - b.team_number);
        if (merged.length > 0) {
          await cacheTbaTeams(currentEvent, merged);
          setTeams(
            merged.map((t) => ({
              key: t.team_key,
              num: t.team_number,
              name: t.name ?? "",
              rank: t.rank ?? 0,
            }))
          );
          setTbaTeams(
            merged.map((t) => ({
              key: t.team_key,
              team: t.team_number,
              name: t.name ?? "",
              rank: t.rank ?? 0,
              record: {
                wins: t.wins ?? 0,
                losses: t.losses ?? 0,
                ties: t.ties ?? 0,
              },
              nextMatch: t.next_match || null,
              lastMatch: t.last_match || null,
            }))
          );
          hasLoadedDataRef.current = true;
        }
      } finally {
        setLoading(false);
        setInitialLoading(false);
        isFetchingRef.current = false;
      }
    } else {
      // Offline: done after cache
      setInitialLoading(false);
      isFetchingRef.current = false;
    }
  }, [currentEvent, dbInitialized, isOnline]);

  // Keep refs in sync
  useEffect(() => {
    fetchTeamsRef.current = fetchTeams;
    currentEventRef.current = currentEvent;
  }, [fetchTeams, currentEvent]);

  // Stable wrapper for polling - always calls latest fetch function
  const fetchTeamsStable = useCallback(async () => {
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }
  }, []); // Never changes!

  // Start controller once when dbInitialized (never stop/start on event changes)
  useEffect(() => {
    if (!dbInitialized) return;

    if (!pollingController.current) {
      pollingController.current = new PollingController(
        "Teams (Supabase 15s + TBA 2min cached)",
        fetchTeamsStable,
        LIVE_POLLING_CONFIG // 15s polling for Supabase, TBA cached at 2min
      );
      pollingController.current.start();
    }

    return () => {
      pollingController.current?.stop();
      pollingController.current = null;
    };
  }, [dbInitialized, fetchTeamsStable]);

  // Handle event changes - fetch teams immediately
  useEffect(() => {
    if (!currentEvent) {
      setTeams([]);
      setTbaTeams([]);
      setInitialLoading(false);
      hasLoadedDataRef.current = false;
      isFetchingRef.current = false;
      return;
    }

    if (dbInitialized) {
      // Set skip flag when changing events (only if online and has prior data)
      if (isOnline && hasLoadedDataRef.current) {
        skipCacheOnceRef.current = true;
        setInitialLoading(true);
      }
      // Allow the new event's fetch to run even if a previous fetch is in flight.
      // The old fetch belongs to a different event and should be superseded.
      isFetchingRef.current = false;
      // Trigger one immediate fetch. Poller handles periodic background refresh.
      // forceRefresh() is NOT called here — that would duplicate this fetch.
      fetchTeams();
    }
  }, [currentEvent, dbInitialized, fetchTeams, isOnline]);

  // Fetch scouted teams and assignments when event changes
  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      setScoutedTeams(new Set());
      setTeamAssignments(new Map());
      return;
    }

    getEventTeamData(currentEvent).then((data: EventTeamData[]) => {
      const scouted = new Set(
        data
          .filter((t: EventTeamData) => {
            // Only count as scouted if name is registered (someone submitted pit data)
            return !!t.name;
          })
          .map((t: EventTeamData) => t.team)
      );
      setScoutedTeams(scouted);

      // Build assignment map
      const assignments = new Map<string, string>();
      data.forEach((t: EventTeamData) => {
        if (t.assigned) {
          assignments.set(t.team, t.assigned);
        }
      });
      setTeamAssignments(assignments);
    });
  }, [currentEvent, dbInitialized]);

  // No realtime subscription for event_team_data on mobile — pit scouting data
  // submitted by this device is already in local SQLite immediately, and TBA/EPA
  // updates from desktop are non-urgent and covered by the 5-minute poll.

  const refresh = useCallback(async () => {
    // Use ref to call current fetch function without changing callback identity.
    // forceRefresh() is NOT called — that would duplicate this fetch.
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }

    // Also refresh scouted teams and assignments
    if (currentEventRef.current) {
      const data = await getEventTeamData(currentEventRef.current);
      const scouted = new Set(
        data
          .filter((t: EventTeamData) => {
            // Only count as scouted if name is registered (someone submitted pit data)
            return !!t.name;
          })
          .map((t: EventTeamData) => t.team)
      );
      setScoutedTeams(scouted);

      // Build assignment map
      const assignments = new Map<string, string>();
      data.forEach((t: EventTeamData) => {
        if (t.assigned) {
          assignments.set(t.team, t.assigned);
        }
      });
      setTeamAssignments(assignments);
    }
  }, []); // Empty dependencies - callback never changes!

  // Register refresh callback with SyncContext
  useEffect(() => {
    if (!registerRefreshCallback) return;

    console.log(
      "[TeamDataContext] Registering refresh callback with SyncContext"
    );
    const unregister = registerRefreshCallback(refresh);

    return () => {
      console.log("[TeamDataContext] Unregistering refresh callback");
      unregister();
    };
  }, [registerRefreshCallback, refresh]);

  // Memoize context value to prevent unnecessary re-renders when polling runs but data hasn't changed
  const contextValue = useMemo(
    () => ({
      teams,
      tbaTeams,
      loading,
      initialLoading,
      refresh,
      scoutedTeams,
      teamAssignments,
    }),
    [
      teams,
      tbaTeams,
      loading,
      initialLoading,
      refresh,
      scoutedTeams,
      teamAssignments,
    ]
  );

  return (
    <TeamDataContext.Provider value={contextValue}>
      {children}
    </TeamDataContext.Provider>
  );
}

export function useTeamData() {
  const context = useContext(TeamDataContext);
  if (context === undefined) {
    throw new Error("useTeamData must be used within a TeamDataProvider");
  }
  return context;
}
