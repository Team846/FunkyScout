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
import { useDesktopEvent } from "./DesktopEventContext";
import { useDesktopRealtime } from "./DesktopRealtimeContext";
import {
  getTeams as getSQLiteTeams,
  getPitScoutingData,
  type PitScoutingData,
} from "../lib/db";
import { setDesktopTeamRefresh } from "@lib/data/writes";
import { invoke } from "@tauri-apps/api/core";

export type { PitScoutingData };

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

interface DesktopTeamDataContextType {
  teams: Team[];
  tbaTeams: TBATeam[];
  pitScoutingData: PitScoutingData[];
  loading: boolean;
  lastDataRefreshAt: number; // Bumped each time SQLite is re-read; watch this to react to syncs
  refresh: () => Promise<void>;
}

const DesktopTeamDataContext = createContext<
  DesktopTeamDataContextType | undefined
>(undefined);

export function DesktopTeamDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent } = useDesktopEvent();
  const { registerRefreshCallback } = useDesktopRealtime();

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamStatsData, setTeamStatsData] = useState<Record<string, TeamStatsEntry>>({});
  const [pitScoutingData, setPitScoutingData] = useState<PitScoutingData[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState(0);

  const hasLoadedDataRef = useRef(false);
  const fetchTeamsRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Read team data from local SQLite cache and fetch live stats from TBA/Statbotics.
   * SQLite (via Rust sync) provides pit scouting data and team names.
   * TBA/Statbotics stats use stale-while-revalidate: cached stats show immediately,
   * then a live fetch runs in the background and updates the UI when done.
   */
  const fetchTeams = useCallback(async () => {
    if (!currentEvent) return;

    try {
      // Phase 1: read SQLite team names + stale cached stats simultaneously (fast, offline-safe)
      const [[cached, pitData], cachedStats] = await Promise.all([
        Promise.all([
          getSQLiteTeams(currentEvent),
          getPitScoutingData(currentEvent),
        ]),
        invoke<Record<string, TeamStatsEntry>>("get_cached_team_stats", { event: currentEvent })
          .catch(() => ({} as Record<string, TeamStatsEntry>)),
      ]);

      if (cached.length > 0) {
        const sortedTeams = [...cached].sort((a, b) => {
          const aNum = parseInt(a.team.replace("frc", ""), 10);
          const bNum = parseInt(b.team.replace("frc", ""), 10);
          return aNum - bNum;
        });
        setTeams(
          sortedTeams.map((t) => {
            const teamNumber = parseInt(t.team.replace("frc", ""), 10);
            return {
              key: t.team,
              num: teamNumber,
              name: t.team_name || `Team ${teamNumber}`,
              rank: 0,
            };
          })
        );
        hasLoadedDataRef.current = true;
      }

      setPitScoutingData(pitData);

      // Apply stale cache immediately so stats are visible before the live fetch completes
      if (Object.keys(cachedStats).length > 0) {
        setTeamStatsData(cachedStats);
      }
    } catch (error) {
      console.error("[DesktopTeamData] Failed to fetch team data:", error);
    } finally {
      setLoading(false);
      setLastDataRefreshAt(Date.now());
    }

    // Phase 2: fetch live stats in background — updates UI when done, writes to cache on success
    invoke<Record<string, TeamStatsEntry>>("fetch_team_stats", { event: currentEvent })
      .then((live) => {
        if (Object.keys(live).length > 0) {
          setTeamStatsData(live);
          setLastDataRefreshAt(Date.now());
        }
      })
      .catch((e) =>
        console.warn("[DesktopTeamData] live stats fetch failed, using cached stats", e)
      );
  }, [currentEvent]);

  // Keep ref in sync
  useEffect(() => {
    fetchTeamsRef.current = fetchTeams;
  }, [fetchTeams]);

  // Handle event changes
  useEffect(() => {
    if (!currentEvent) {
      setTeams([]);
      setTeamStatsData({});
      setPitScoutingData([]);
      hasLoadedDataRef.current = false;
      return;
    }

    // Show loading when switching events (if we had data from a prior event)
    if (hasLoadedDataRef.current) {
      setLoading(true);
      hasLoadedDataRef.current = false;
    }

    // 1. Read SQLite immediately — shows cached/stale data (offline-safe)
    fetchTeams();

    // 2. Re-read SQLite after Rust sync has had time to write.
    //    DesktopCompetitionDataContext calls trigger_sync_now on event change
    //    and re-reads at these same intervals — team data will be fresh from
    //    the same Rust sync cycle.
    const pollDelays = [5_000, 10_000, 20_000];
    const timers = pollDelays.map((delay) =>
      setTimeout(() => {
        fetchTeamsRef.current?.();
      }, delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [currentEvent, fetchTeams]);

  // Every 125s: re-read SQLite (aligned with DesktopCompetitionDataContext).
  useEffect(() => {
    if (!currentEvent) return;

    const timer = setInterval(() => {
      console.log("[DesktopTeamData] Post-sync SQLite refresh (125s)");
      fetchTeamsRef.current?.();
    }, 125_000);

    return () => clearInterval(timer);
  }, [currentEvent]);

  // Register refresh callback for realtime updates (when realtime is re-enabled)
  // and for manual sync button (via DesktopSyncContext.forceSyncNow).
  // Mirrors DesktopCompetitionDataContext: trigger Rust sync then re-read SQLite
  // after 15s so fresh Supabase data has time to land in SQLite before we read.
  useEffect(() => {
    if (!currentEvent) return;

    const unregister = registerRefreshCallback(() => {
      // Rust sync is triggered once centrally in DesktopRealtimeContext.
      // Re-read SQLite at 7s (fast path), 15s (slow: TBA + Statbotics), and 25s
      // (queued-trigger case: trigger arrived while Rust was mid-sync).
      setTimeout(() => fetchTeamsRef.current?.(), 7_000);
      setTimeout(() => fetchTeamsRef.current?.(), 15_000);
      setTimeout(() => fetchTeamsRef.current?.(), 25_000);
    });

    return unregister;
  }, [currentEvent, registerRefreshCallback]);

  // Register global callback so writes.ts can trigger an immediate SQLite re-read
  // after local writes (putTeamData, setTeamPriority, assignPitTeams, etc.) without
  // waiting for the realtime postgres_changes event (~7-15s delay).
  useEffect(() => {
    setDesktopTeamRefresh(() => fetchTeamsRef.current?.());
    return () => setDesktopTeamRefresh(null);
  }, []);

  const refresh = useCallback(async () => {
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }
  }, []);

  // Derive tbaTeams by merging base team list with live TBA/Statbotics stats
  const tbaTeams = useMemo<TBATeam[]>(
    () =>
      teams.map((t) => ({
        key: t.key,
        team: t.num,
        name: t.name,
        rank: teamStatsData[t.key]?.rank ?? 0,
        record: teamStatsData[t.key]?.record ?? { wins: 0, losses: 0, ties: 0 },
        nextMatch: teamStatsData[t.key]?.nextMatch ?? null,
        lastMatch: teamStatsData[t.key]?.lastMatch ?? null,
        epa: teamStatsData[t.key]?.epa ?? null,
        opr: teamStatsData[t.key]?.opr,
        dpr: teamStatsData[t.key]?.dpr,
      })),
    [teams, teamStatsData]
  );

  const contextValue = useMemo(
    () => ({ teams, tbaTeams, pitScoutingData, loading, lastDataRefreshAt, refresh }),
    [teams, tbaTeams, pitScoutingData, loading, lastDataRefreshAt, refresh]
  );

  return (
    <DesktopTeamDataContext.Provider value={contextValue}>
      {children}
    </DesktopTeamDataContext.Provider>
  );
}

export function useDesktopTeamData() {
  const context = useContext(DesktopTeamDataContext);
  if (!context) {
    throw new Error(
      "useDesktopTeamData must be used within DesktopTeamDataProvider"
    );
  }
  return context;
}
