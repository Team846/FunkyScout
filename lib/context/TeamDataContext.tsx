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
import { getTeams } from "@lib/data";
import { fetchTBAEventTeams } from "@lib/tba";
import {
  getTbaTeams,
  cacheTbaTeams,
  getEventTeamData,
  type TbaTeam,
} from "@lib/db";
import {
  PollingController,
  DEFAULT_POLLING_CONFIG,
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
}

interface TeamDataContextType {
  teams: Team[];
  tbaTeams: TBATeam[];
  loading: boolean;
  refresh: () => Promise<void>;
  scoutedTeams: Set<string>; // Team keys that have been pit scouted
}

const TeamDataContext = createContext<TeamDataContextType | undefined>(
  undefined,
);

export function TeamDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { forceSyncNow } = useSync();
  const [teams, setTeams] = useState<Team[]>([]);
  const [tbaTeams, setTbaTeams] = useState<TBATeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoutedTeams, setScoutedTeams] = useState<Set<string>>(new Set());
  const pollingController = useRef<PollingController | null>(null);

  const fetchTeams = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // 1. Load from cache first
    const cached = await getTbaTeams(currentEvent);
    if (cached.length > 0) {
      setTeams(
        cached.map((t) => ({
          key: t.team_key,
          num: t.team_number,
          name: t.name ?? "",
          rank: t.rank ?? 0,
        })),
      );
      setTbaTeams(
        cached.map((t) => ({
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
        })),
      );
    }

    // 2. Refresh from network if online
    if (isOnline) {
      console.log("[TeamData] Fetching from network");
      setLoading(true);
      try {
        const [supabaseTeams, tbaTeamsData] = await Promise.all([
          getTeams(currentEvent),
          fetchTBAEventTeams(currentEvent),
        ]);

        const tbaMap = new Map((tbaTeamsData ?? []).map((t) => [t.key, t]));

        const merged: TbaTeam[] = (supabaseTeams ?? []).map((t: any) => {
          const tbaTeam = tbaMap.get(t.team);
          return {
            event: currentEvent,
            team_key: t.team,
            team_number: parseInt(t.team.replace("frc", ""), 10),
            name:
              tbaTeam?.name ??
              t.team_name ??
              `Team ${t.team.replace("frc", "")}`,
            rank: tbaTeam?.rank ?? t.rank ?? 0,
            wins: tbaTeam?.record?.wins ?? 0,
            losses: tbaTeam?.record?.losses ?? 0,
            ties: tbaTeam?.record?.ties ?? 0,
            next_match: tbaTeam?.nextMatch || undefined,
            last_match: tbaTeam?.lastMatch || undefined,
            last_synced: Date.now(),
          };
        });

        // Handle B-teams or teams only in TBA
        const supabaseKeys = new Set(
          (supabaseTeams ?? []).map((t: any) => t.team),
        );
        for (const tbaTeam of tbaTeamsData ?? []) {
          if (!supabaseKeys.has(tbaTeam.key)) {
            merged.push({
              event: currentEvent,
              team_key: tbaTeam.key,
              team_number: tbaTeam.team,
              name: tbaTeam.name,
              rank: tbaTeam.rank,
              wins: tbaTeam.record?.wins ?? 0,
              losses: tbaTeam.record?.losses ?? 0,
              ties: tbaTeam.record?.ties ?? 0,
              next_match: tbaTeam.nextMatch || undefined,
              last_match: tbaTeam.lastMatch || undefined,
              last_synced: Date.now(),
            });
          }
        }

        merged.sort((a, b) => a.team_number - b.team_number);
        if (merged.length > 0) {
          await cacheTbaTeams(currentEvent, merged);
          setTeams(
            merged.map((t) => ({
              key: t.team_key,
              num: t.team_number,
              name: t.name ?? "",
              rank: t.rank ?? 0,
            })),
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
            })),
          );
        }
      } finally {
        setLoading(false);
      }
    }
  }, [currentEvent, dbInitialized, isOnline]);

  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      pollingController.current?.stop();
      setTeams([]);
      setTbaTeams([]);
      return;
    }

    if (!pollingController.current) {
      pollingController.current = new PollingController(
        "Teams",
        fetchTeams,
        DEFAULT_POLLING_CONFIG,
      );
    }

    pollingController.current.start();
    pollingController.current.forceRefresh(); // Initial fetch

    return () => pollingController.current?.stop();
  }, [currentEvent, dbInitialized, fetchTeams]);

  // Fetch scouted teams when event changes
  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      setScoutedTeams(new Set());
      return;
    }

    getEventTeamData(currentEvent).then((data) => {
      const scouted = new Set(
        data
          .filter((t) => {
            // Only count as scouted if data exists and is not empty
            if (!t.data) return false;
            if (Array.isArray(t.data)) return t.data.length > 0;
            if (typeof t.data === "object")
              return Object.keys(t.data).length > 0;
            return false;
          })
          .map((t) => t.team),
      );
      setScoutedTeams(scouted);
      console.log(`[TeamData] Found ${scouted.size} scouted teams`);
    });
  }, [currentEvent, dbInitialized]);

  const refresh = useCallback(async () => {
    // Trigger sync first, then refresh data
    await forceSyncNow();
    await pollingController.current?.forceRefresh();

    // Also refresh scouted teams
    if (currentEvent) {
      const data = await getEventTeamData(currentEvent);
      const scouted = new Set(
        data
          .filter((t) => {
            // Only count as scouted if data exists and is not empty
            if (!t.data) return false;
            if (Array.isArray(t.data)) return t.data.length > 0;
            if (typeof t.data === "object")
              return Object.keys(t.data).length > 0;
            return false;
          })
          .map((t) => t.team),
      );
      setScoutedTeams(scouted);
    }
  }, [forceSyncNow, currentEvent]);

  return (
    <TeamDataContext.Provider
      value={{ teams, tbaTeams, loading, refresh, scoutedTeams }}
    >
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
