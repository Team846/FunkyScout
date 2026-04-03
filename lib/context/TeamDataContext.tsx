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
import { getUserProfiles } from "@lib/data/scouterRatings";
import {
  PollingController,
  LIVE_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";
import { fetchTBATeamStatuses, fetchTBAEventOPRs } from "@lib/tba/event";
import { fetchStatboticsEventTeams } from "@lib/statbotics/event";

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

interface TeamStatsEntry {
  rank: number;
  record: { wins: number; losses: number; ties: number };
  nextMatch: string | null;
  lastMatch: string | null;
  epa: TBATeam["epa"] | null;
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
  assignmentNames: Map<string, string>; // Map of teamKey -> assigned scouter name
}

const TeamDataContext = createContext<TeamDataContextType | undefined>(
  undefined
);

export function TeamDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { registerRefreshCallback } = useSync();
  // Base team list from Supabase (pit scouting fields, team_name, assignments)
  const [baseTbaTeams, setBaseTbaTeams] = useState<TBATeam[]>([]);
  // Live computed stats from TBA/Statbotics direct polling
  const [teamStatsData, setTeamStatsData] = useState<Record<string, TeamStatsEntry>>({});
  const [loading, setLoading] = useState(false);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const [teamAssignments, setTeamAssignments] = useState<Map<string, string>>(
    new Map()
  );
  const [assignmentNames, setAssignmentNames] = useState<Map<string, string>>(
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

  const resolveAssignmentNames = useCallback(async (assignments: Map<string, string>) => {
    const uniqueUids = [...new Set(assignments.values())];
    if (uniqueUids.length === 0) {
      setAssignmentNames(new Map());
      return;
    }
    try {
      const profiles = await getUserProfiles(uniqueUids);
      const uidToName = new Map(profiles.map((p) => [p.uid, p.name]));
      const names = new Map<string, string>();
      assignments.forEach((uid, teamKey) => {
        const name = uidToName.get(uid);
        if (name) names.set(teamKey, name);
      });
      setAssignmentNames(names);
    } catch (err) {
      console.warn("[TeamData] Failed to resolve assignment names:", err);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Prevent concurrent fetches — if one is already in progress, skip this call.
    if (isFetchingRef.current) {
      console.log("[TeamData] Skipping fetch — already in progress");
      return;
    }
    isFetchingRef.current = true;

    // Check if we should skip cache this time (only on event change when online)
    const shouldSkipCache = skipCacheOnceRef.current && isOnline;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false;
    }

    // 1. Load from cache only on first load (no live data yet) and if not skipping.
    if (!shouldSkipCache && !hasLoadedDataRef.current) {
      const cached = await getTbaTeams(currentEvent);
      if (cached.length > 0) {
        setBaseTbaTeams(
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

    if (isOnline) {
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }
      try {
        // Fetch Supabase team data (pit scouting fields, team_name, assignments)
        // AND TBA/Statbotics stats in parallel — same poll cycle, same 5-min interval.
        // Use allSettled for API calls so one failure doesn't block the Supabase update.
        const [supabaseTeams, [statusResult, epaResult, oprResult]] = await Promise.all([
          getTeams(currentEvent),
          Promise.allSettled([
            fetchTBATeamStatuses(currentEvent),
            fetchStatboticsEventTeams(currentEvent),
            fetchTBAEventOPRs(currentEvent),
          ]),
        ]);

        const statuses = statusResult.status === "fulfilled" ? statusResult.value : undefined;
        const epaMap = epaResult.status === "fulfilled" ? (epaResult.value as Record<string, any>) : {};
        const oprMap = oprResult.status === "fulfilled" ? oprResult.value : undefined;

        // Build live stats map from TBA + Statbotics.
        // rank, record, next/last match, EPA, OPR are NOT read from Supabase data —
        // mobile polls TBA and Statbotics directly to avoid triggering unnecessary
        // last_modified bumps on event_team_data during competition.
        if (statuses) {
          const stats: Record<string, TeamStatsEntry> = {};
          for (const [teamKey, status] of Object.entries(statuses as Record<string, any>)) {
            stats[teamKey] = {
              rank: status.qual?.ranking?.rank ?? 0,
              record: status.qual?.ranking?.record ?? { wins: 0, losses: 0, ties: 0 },
              nextMatch: status.next_match_key ?? null,
              lastMatch: status.last_match_key ?? null,
              epa: (epaMap as Record<string, any>)[teamKey] ?? null,
              opr: oprMap?.oprs[teamKey],
              dpr: oprMap?.dprs[teamKey],
            };
          }
          console.log(`[TeamData] Stats: updated ${Object.keys(stats).length} teams from TBA/Statbotics`);
          setTeamStatsData(stats);
        }

        // Update base team list from Supabase (team_name only — no computed stats).
        // The data column is still fetched and cached by getTeams() for pit scouting display.
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
              rank: 0,
              wins: 0,
              losses: 0,
              ties: 0,
              epa: null,
              opr: undefined,
              dpr: undefined,
              next_match: undefined,
              last_match: undefined,
              last_synced: Date.now(),
            };
          }
        );

        merged.sort((a, b) => a.team_number - b.team_number);
        if (merged.length > 0) {
          await cacheTbaTeams(currentEvent, merged);
          setBaseTbaTeams(
            merged.map((t) => ({
              key: t.team_key,
              team: t.team_number,
              name: t.name ?? "",
              rank: 0,
              record: { wins: 0, losses: 0, ties: 0 },
              nextMatch: null,
              lastMatch: null,
            }))
          );
          hasLoadedDataRef.current = true;
        }

        // Keep scoutedTeams and teamAssignments in sync after every poll.
        const scouted = new Set(
          (supabaseTeams ?? [])
            .filter((t: EventTeamData) => !!t.name)
            .map((t: EventTeamData) => t.team)
        );
        setScoutedTeams(scouted);
        const assignments = new Map<string, string>();
        (supabaseTeams ?? []).forEach((t: EventTeamData) => {
          if (t.assigned) assignments.set(t.team, t.assigned);
        });
        setTeamAssignments(assignments);
        resolveAssignmentNames(assignments);
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

  // Stable wrapper for polling
  const fetchTeamsStable = useCallback(async () => {
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }
  }, []);

  // Single polling controller — Supabase + TBA/Statbotics all run in the same cycle
  useEffect(() => {
    if (!dbInitialized) return;

    if (!pollingController.current) {
      pollingController.current = new PollingController(
        "Teams (Supabase + TBA + Statbotics)",
        fetchTeamsStable,
        LIVE_POLLING_CONFIG
      );
      pollingController.current.start();
    }

    return () => {
      pollingController.current?.stop();
      pollingController.current = null;
    };
  }, [dbInitialized, fetchTeamsStable]);

  // Handle event changes - fetch immediately
  useEffect(() => {
    if (!currentEvent) {
      setBaseTbaTeams([]);
      setTeamStatsData({});
      setInitialLoading(false);
      hasLoadedDataRef.current = false;
      isFetchingRef.current = false;
      return;
    }

    if (dbInitialized) {
      hasLoadedDataRef.current = false;
      if (isOnline) {
        skipCacheOnceRef.current = true;
        setInitialLoading(true);
      }
      isFetchingRef.current = false;
      fetchTeams();
    }
  }, [currentEvent, dbInitialized, fetchTeams, isOnline]);

  // Fetch scouted teams and assignments when event changes AND after initial load completes
  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      setScoutedTeams(new Set());
      setTeamAssignments(new Map());
      return;
    }

    getEventTeamData(currentEvent).then((data: EventTeamData[]) => {
      const scouted = new Set(
        data.filter((t: EventTeamData) => !!t.name).map((t: EventTeamData) => t.team)
      );
      setScoutedTeams(scouted);

      const assignments = new Map<string, string>();
      data.forEach((t: EventTeamData) => {
        if (t.assigned) assignments.set(t.team, t.assigned);
      });
      setTeamAssignments(assignments);
      resolveAssignmentNames(assignments);
    });
  }, [currentEvent, dbInitialized, initialLoading, resolveAssignmentNames]);

  const refresh = useCallback(async () => {
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }

    if (currentEventRef.current) {
      const data = await getEventTeamData(currentEventRef.current);
      const scouted = new Set(
        data.filter((t: EventTeamData) => !!t.name).map((t: EventTeamData) => t.team)
      );
      setScoutedTeams(scouted);

      const assignments = new Map<string, string>();
      data.forEach((t: EventTeamData) => {
        if (t.assigned) assignments.set(t.team, t.assigned);
      });
      setTeamAssignments(assignments);
      resolveAssignmentNames(assignments);
    }
  }, [resolveAssignmentNames]);

  // Register refresh callback with SyncContext
  useEffect(() => {
    if (!registerRefreshCallback) return;
    console.log("[TeamDataContext] Registering refresh callback with SyncContext");
    const unregister = registerRefreshCallback(refresh);
    return () => {
      console.log("[TeamDataContext] Unregistering refresh callback");
      unregister();
    };
  }, [registerRefreshCallback, refresh]);

  // Merge base team list with live TBA/Statbotics stats
  const mergedTbaTeams = useMemo<TBATeam[]>(
    () =>
      baseTbaTeams.map((t) => {
        const s = teamStatsData[t.key];
        return {
          ...t,
          rank: s?.rank ?? t.rank,
          record: s?.record ?? t.record,
          nextMatch: s?.nextMatch ?? t.nextMatch,
          lastMatch: s?.lastMatch ?? t.lastMatch,
          epa: s?.epa ?? null,
          opr: s?.opr,
          dpr: s?.dpr,
        };
      }),
    [baseTbaTeams, teamStatsData]
  );

  const mergedTeams = useMemo<Team[]>(
    () =>
      baseTbaTeams.map((t) => ({
        key: t.key,
        num: t.team,
        name: t.name,
        rank: teamStatsData[t.key]?.rank ?? t.rank,
      })),
    [baseTbaTeams, teamStatsData]
  );

  const contextValue = useMemo(
    () => ({
      teams: mergedTeams,
      tbaTeams: mergedTbaTeams,
      loading,
      initialLoading,
      refresh,
      scoutedTeams,
      teamAssignments,
      assignmentNames,
    }),
    [mergedTeams, mergedTbaTeams, loading, initialLoading, refresh, scoutedTeams, teamAssignments, assignmentNames]
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
