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
import { fetchTBATeamStatuses } from "@lib/tba";
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
  BACKUP_API_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";
import supabase from "@lib/supabase/supabase";

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

  // Cache for TBA API calls (2-minute TTL for backup API calls)
  const tbaCache = useRef<{ data: any; timestamp: number } | null>(null);
  const TBA_CACHE_TTL = 120_000; // 2 minutes

  const fetchTeams = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Check if we should skip cache this time (only on event change when online)
    const shouldSkipCache = skipCacheOnceRef.current && isOnline;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false; // Clear immediately
    }

    // 1. Load from cache (only if not skipping)
    if (!shouldSkipCache) {
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

    // 2. Refresh from network if online
    if (isOnline) {
      console.log("[TeamData] Fetching from network");
      // Only show loading on initial load (no data yet) or event change (skipped cache)
      // Don't show loading on background refreshes (prevents flickering)
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }
      try {
        const supabaseTeams = await getTeams(currentEvent);

        // TBA Failsafe: Check if desktop has synced recently (within last 5 minutes)
        // Desktop updates Supabase every 30s with TBA data (rank, EPA, OPR)
        // If no recent update, desktop is likely not running
        const now = Date.now();
        const hasRecentDesktopSync = (supabaseTeams ?? []).some((t: any) => {
          // Check if data.last_synced exists and is recent
          const lastSynced = t.data?.last_synced;
          if (lastSynced && typeof lastSynced === "number") {
            return now - lastSynced < 5 * 60 * 1000; // 5 minutes
          }
          return false;
        });

        // Fetch TBA statuses for rankings (with 2-minute caching for backup API calls)
        let tbaStatuses;
        const isTbaCacheValid =
          tbaCache.current && now - tbaCache.current.timestamp < TBA_CACHE_TTL;

        if (isTbaCacheValid) {
          // Use cached TBA data (within 2-minute window)
          tbaStatuses = tbaCache.current!.data;
        } else {
          // Cache expired or doesn't exist - fetch fresh data from TBA
          tbaStatuses = await fetchTBATeamStatuses(currentEvent);
          tbaCache.current = { data: tbaStatuses, timestamp: now };
        }

        if (hasRecentDesktopSync || (supabaseTeams ?? []).length === 0) {
          // Normal flow: Desktop is running, use Supabase + TBA
          console.log(
            "[TeamData] Desktop is active, using Supabase + TBA data"
          );

          const merged: TbaTeam[] = (supabaseTeams ?? []).map(
            (supabaseTeam: {
              event: string;
              team: string;
              data?: any;
              team_name?: string;
              rank?: number;
            }) => {
              const teamStatus = tbaStatuses?.[supabaseTeam.team];
              const teamNumber = parseInt(
                supabaseTeam.team.replace("frc", ""),
                10
              );

              return {
                event: currentEvent,
                team_key: supabaseTeam.team,
                team_number: teamNumber,
                name: supabaseTeam.team_name ?? `Team ${teamNumber}`,
                // Rankings from TBA (mobile's responsibility - freshest data with 2min polling)
                rank:
                  teamStatus?.qual?.ranking?.rank ??
                  supabaseTeam.data?.rank ??
                  0,
                wins:
                  teamStatus?.qual?.ranking?.record?.wins ??
                  supabaseTeam.data?.record?.wins ??
                  0,
                losses:
                  teamStatus?.qual?.ranking?.record?.losses ??
                  supabaseTeam.data?.record?.losses ??
                  0,
                ties:
                  teamStatus?.qual?.ranking?.record?.ties ??
                  supabaseTeam.data?.record?.ties ??
                  0,
                // EPA from Supabase (desktop keeps this fresh every 30s)
                epa: supabaseTeam.data?.epa ?? null,
                // OPR/DPR from Supabase (desktop keeps this fresh)
                opr: supabaseTeam.data?.opr ?? undefined,
                dpr: supabaseTeam.data?.dpr ?? undefined,
                next_match:
                  teamStatus?.next_match_key ||
                  supabaseTeam.data?.next_match ||
                  undefined,
                last_match:
                  teamStatus?.last_match_key ||
                  supabaseTeam.data?.last_match ||
                  undefined,
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
        } else {
          // TBA Failsafe: Desktop not running, use TBA-only data
          console.warn(
            "[TeamData] Desktop not detected (no recent sync), using TBA failsafe"
          );

          // Use Supabase teams for base info, but acknowledge EPA/OPR will be stale
          const merged: TbaTeam[] = (supabaseTeams ?? []).map(
            (supabaseTeam: {
              event: string;
              team: string;
              data?: any;
              team_name?: string;
              rank?: number;
            }) => {
              const teamStatus = tbaStatuses?.[supabaseTeam.team];
              const teamNumber = parseInt(
                supabaseTeam.team.replace("frc", ""),
                10
              );

              return {
                event: currentEvent,
                team_key: supabaseTeam.team,
                team_number: teamNumber,
                name: supabaseTeam.team_name ?? `Team ${teamNumber}`,
                // Use TBA for rankings
                rank: teamStatus?.qual?.ranking?.rank ?? 0,
                wins: teamStatus?.qual?.ranking?.record?.wins ?? 0,
                losses: teamStatus?.qual?.ranking?.record?.losses ?? 0,
                ties: teamStatus?.qual?.ranking?.record?.ties ?? 0,
                // EPA/OPR will be stale or null (desktop not running)
                epa: supabaseTeam.data?.epa ?? null,
                opr: supabaseTeam.data?.opr ?? undefined,
                dpr: supabaseTeam.data?.dpr ?? undefined,
                next_match: teamStatus?.next_match_key || undefined,
                last_match: teamStatus?.last_match_key || undefined,
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
        }
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    } else {
      // Offline: done after cache
      setInitialLoading(false);
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

    return () => pollingController.current?.stop();
  }, [dbInitialized, fetchTeamsStable]);

  // Handle event changes - fetch teams immediately
  useEffect(() => {
    if (!currentEvent) {
      setTeams([]);
      setTbaTeams([]);
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
      // Reset polling controller to trigger fresh fetches immediately
      if (pollingController.current) pollingController.current.forceRefresh();

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

  // Subscribe to Supabase realtime for event_team_data updates
  useEffect(() => {
    if (!currentEvent || !dbInitialized || !isOnline) return;

    // Disable realtime in development to save on Supabase free tier limits
    if (import.meta.env.DEV) {
      console.log(  
        "[TeamData] Realtime subscriptions disabled in development mode"
      );
      return;
    }

    console.log(
      "[TeamData] Setting up realtime subscription for event_team_data"
    );

    // Debounce timer to batch multiple realtime updates
    let debounceTimer: NodeJS.Timeout | null = null;
    let updateCount = 0;

    const channel = supabase
      .channel(`event-team-data-${currentEvent}`)
      // Monitor channel status for debugging
      .on("system", { event: "CHANNEL_STATE" }, (payload) => {
        console.log("[TeamData] Realtime channel state:", payload);
      })
      .on("system", { event: "CHANNEL_ERROR" }, (error) => {
        console.error("[TeamData] Realtime channel error:", error);
      })
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table: "event_team_data",
          filter: `event=eq.${currentEvent}`,
        },
        () => {
          updateCount++;

          // Clear existing timer
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          // Set new timer - only fetch after 2s of no updates
          debounceTimer = setTimeout(() => {
            console.log(
              `[TeamData] Realtime: Batched ${updateCount} updates, fetching now`
            );
            updateCount = 0;
            fetchTeams();
          }, 2000); // 2 second debounce
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("[TeamData] ✅ Realtime subscribed successfully");
        } else if (status === "CHANNEL_ERROR") {
          console.error("[TeamData] ❌ Realtime subscription error:", err);
        } else if (status === "TIMED_OUT") {
          console.warn("[TeamData] ⏱️ Realtime subscription timed out");
        } else if (status === "CLOSED") {
          console.log("[TeamData] 🔌 Realtime channel closed");
        }
      });

    return () => {
      console.log("[TeamData] Cleaning up realtime subscription");
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      supabase.removeChannel(channel);
    };
  }, [currentEvent, dbInitialized, isOnline, fetchTeams]);

  const refresh = useCallback(async () => {
    // Reset polling interval to trigger fresh fetches sooner
    if (pollingController.current) pollingController.current.forceRefresh();

    // Use ref to call current fetch function without changing callback identity
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
