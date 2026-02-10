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
  getTeams as getSQLiteTeams,
  type EventTeamData,
} from "../lib/db";
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
  ccwm?: number;
}

interface DesktopTeamDataContextType {
  teams: Team[];
  tbaTeams: TBATeam[];
  loading: boolean;
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
  const [loading, setLoading] = useState(false);

  // Refs for stable access in callbacks
  const skipCacheOnceRef = useRef(false);
  const hasLoadedDataRef = useRef(false);
  const fetchTeamsRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Three-step fetch pattern:
   * 1. Read from SQLite cache (fast, works offline)
   * 2. Refresh from Supabase if online
   * 3. Update SQLite cache with fresh data
   */
  const fetchTeams = useCallback(async () => {
    if (!currentEvent) return;

    const shouldSkipCache = skipCacheOnceRef.current;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false;
    }

    try {
      // Step 1: Read from SQLite cache (unless skipping)
      if (!shouldSkipCache) {
        const cached = await getSQLiteTeams(currentEvent);
        if (cached.length > 0) {
          processTeamData(cached);
          hasLoadedDataRef.current = true;
        }
      }

      // Step 2: Refresh from Supabase (desktop is always online)

      // Only show loading on initial load or event change (prevents flickering on background refreshes)
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }

      const { data: supabaseTeams, error } = await supabase
        .from("event_team_data")
        .select("event, team, team_name, data, last_modified")
        .eq("event", currentEvent)
        .is("deleted_at", null);

      if (error) throw error;

      if (supabaseTeams && supabaseTeams.length > 0) {
        // Process and display fresh data
        processTeamData(supabaseTeams as EventTeamData[]);
        hasLoadedDataRef.current = true;

        // Note: Backend handles writing to SQLite from TBA
        // Frontend just reads and displays the latest from Supabase
      }
    } catch (error) {
      console.error("[DesktopTeamData] Fetch failed:", error);
    } finally {
      setLoading(false);
    }
  }, [currentEvent]);

  /**
   * Process team data from SQLite or Supabase into display format
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
      hasLoadedDataRef.current = false;
      return;
    }

    // Skip cache when switching events (if has prior data)
    if (hasLoadedDataRef.current) {
      skipCacheOnceRef.current = true;
    }

    fetchTeams();
  }, [currentEvent, fetchTeams]);

  // Register refresh callback for realtime updates
  useEffect(() => {
    if (!currentEvent) return;

    const unregister = registerRefreshCallback(() => {
      skipCacheOnceRef.current = true; // Skip cache, fetch from Supabase
      if (fetchTeamsRef.current) {
        fetchTeamsRef.current();
      }
    });

    return unregister;
  }, [currentEvent, registerRefreshCallback]);

  const refresh = useCallback(async () => {
    if (fetchTeamsRef.current) {
      await fetchTeamsRef.current();
    }
  }, []);

  return (
    <DesktopTeamDataContext.Provider
      value={{ teams, tbaTeams, loading, refresh }}
    >
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
