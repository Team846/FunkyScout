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
  type EventTeamData,
  type PitScoutingData,
} from "../lib/db";
import { setDesktopTeamRefresh } from "@lib/data/writes";

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
  ccwm?: number;
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
  const [tbaTeams, setTbaTeams] = useState<TBATeam[]>([]);
  const [pitScoutingData, setPitScoutingData] = useState<PitScoutingData[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState(0);

  const hasLoadedDataRef = useRef(false);
  const fetchTeamsRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Read team data from local SQLite cache.
   * Rust sync service (120s, incremental) is the sole Supabase reader —
   * the frontend never calls Supabase directly for team data.
   *
   * Shows whatever SQLite has immediately (offline-safe). Rust sync updates
   * SQLite in the background; subsequent polls pick up fresh data silently.
   */
  const fetchTeams = useCallback(async () => {
    if (!currentEvent) return;

    try {
      const [cached, pitData] = await Promise.all([
        getSQLiteTeams(currentEvent),
        getPitScoutingData(currentEvent),
      ]);
      if (cached.length > 0) {
        processTeamData(cached);
        hasLoadedDataRef.current = true;
      }
      setPitScoutingData(pitData);
    } catch (error) {
      console.error("[DesktopTeamData] Failed to read from SQLite:", error);
    } finally {
      setLoading(false);
      setLastDataRefreshAt(Date.now());
    }
  }, [currentEvent]);

  /**
   * Process team data from SQLite into display format
   */
  const processTeamData = (teamData: EventTeamData[]) => {
    const sortedTeams = [...teamData].sort((a, b) => {
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
          rank: t.data?.rank ?? 0,
        };
      })
    );

    setTbaTeams(
      sortedTeams.map((t) => {
        const teamNumber = parseInt(t.team.replace("frc", ""), 10);
        return {
          key: t.team,
          team: teamNumber,
          name: t.team_name || `Team ${teamNumber}`,
          rank: t.data?.rank ?? 0,
          record: {
            wins: t.data?.record?.wins ?? 0,
            losses: t.data?.record?.losses ?? 0,
            ties: t.data?.record?.ties ?? 0,
          },
          nextMatch: t.data?.next_match || null,
          lastMatch: t.data?.last_match || null,
          epa: (typeof t.data?.epa === "object" ? t.data?.epa : null) ?? null,
          opr: t.data?.opr ?? undefined,
          dpr: t.data?.dpr ?? undefined,
          ccwm: t.data?.ccwm ?? undefined,
        };
      })
    );
  };

  // Keep ref in sync
  useEffect(() => {
    fetchTeamsRef.current = fetchTeams;
  }, [fetchTeams]);

  // Handle event changes
  useEffect(() => {
    if (!currentEvent) {
      setTeams([]);
      setTbaTeams([]);
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

  // Every 135s: re-read SQLite.
  // DesktopCompetitionDataContext triggers Rust sync every 120s + waits 15s
  // before re-reading. We align to 135s so team data updates at the same
  // cadence as schedule/picklist data (after each Rust sync cycle).
  useEffect(() => {
    if (!currentEvent) return;

    const timer = setInterval(() => {
      console.log("[DesktopTeamData] Post-sync SQLite refresh (135s)");
      fetchTeamsRef.current?.();
    }, 135_000);

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
      // Re-read SQLite after sync has had time to pull new data.
      setTimeout(() => fetchTeamsRef.current?.(), 7_000);
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
