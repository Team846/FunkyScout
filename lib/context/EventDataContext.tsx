import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getTeams, getSchedule } from "@lib/data";
import { getNexusEventStatus, type NexusMatch } from "@lib/nexus";
import { fetchTBAEventTeams, fetchTBAMatchSchedule } from "@lib/tba";
import {
  initDatabase,
  getCachedTeams,
  cacheTeams,
  getCachedMatches,
  cacheMatches,
  getCachedSchedule,
  cacheSchedule,
  type LocalTeam,
  type LocalMatch,
  type LocalScheduleEntry,
} from "@lib/db";
import {
  fetchEventTeamEPAs,
  fetchStatboticsMatch,
  type StatboticsTeamEPAs,
  type StatboticsMatch,
} from "@lib/statbotics";

// Shared team interface
export interface Team {
  key: string;
  num: number;
  name: string;
  rank: number;
}

// Shared schedule entry interface
export interface ScheduleEntry {
  match: string;
  team: string;
  alliance: "red" | "blue";
}

// TBA team data
export interface TBATeam {
  key: string;
  team: number;
  name: string;
  rank: number;
  record: { wins: number; losses: number; ties: number };
  nextMatch: string | null;
  lastMatch: string | null;
}

// TBA schedule entry
export interface TBAMatchData {
  redTeams: string[];
  blueTeams: string[];
  est_time: number;
  redScore: number | null;
  blueScore: number | null;
}

type EventDataContextType = {
  // Current event
  currentEvent: string | null;
  setCurrentEvent: (event: string | null) => void;

  // Shared data
  teams: Team[];
  schedule: ScheduleEntry[];
  nexusMatches: NexusMatch[];
  tbaTeams: TBATeam[];
  tbaSchedule: Record<string, TBAMatchData>;

  // Loading states
  teamsLoading: boolean;
  scheduleLoading: boolean;
  nexusLoading: boolean;

  // Network status
  isOnline: boolean;

  // Refresh functions
  refreshTeams: () => Promise<void>;
  refreshSchedule: () => Promise<void>;
  refreshNexus: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Statbotics
  teamEPAs: Record<string, StatboticsTeamEPAs>;
  matchPreds: Record<string, StatboticsMatch>;
  statboticsLoading: boolean;
  refreshStatbotics: () => Promise<void>;
};

const EventDataContext = createContext<EventDataContextType | undefined>(
  undefined
);

export function EventDataProvider({ children }: { children: ReactNode }) {
  // Current event state
  const [currentEvent, _setCurrentEvent] = useState<string | null>(() => {
    return localStorage.getItem("current_event");
  });

  // Data states
  const [teams, setTeams] = useState<Team[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [nexusMatches, setNexusMatches] = useState<NexusMatch[]>([]);
  const [tbaTeams, setTbaTeams] = useState<TBATeam[]>([]);
  const [tbaSchedule, setTbaSchedule] = useState<Record<string, TBAMatchData>>(
    {}
  );

  const [teamEPAs, setTeamEPAs] = useState<Record<string, StatboticsTeamEPAs>>(
    {}
  );
  const [matchPreds, setMatchPreds] = useState<Record<string, StatboticsMatch>>(
    {}
  );
  const [statboticsLoading, setStatboticsLoading] = useState(false);

  // Loading states
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [nexusLoading, setNexusLoading] = useState(false);

  // Network status
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // DB initialization ref
  const dbInitialized = useRef(false);

  // Initialize database on mount
  useEffect(() => {
    if (!dbInitialized.current) {
      dbInitialized.current = true;
      initDatabase().catch((e) => {
        console.error("[EventData] Failed to initialize database:", e);
      });
    }
  }, []);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log("[EventData] Network: online");
      setIsOnline(true);
    };
    const handleOffline = () => {
      console.log("[EventData] Network: offline");
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const setCurrentEvent = useCallback((event: string | null) => {
    if (event) {
      localStorage.setItem("current_event", event);
    } else {
      localStorage.removeItem("current_event");
    }
    _setCurrentEvent(event);
    // Clear data when event changes
    setTeams([]);
    setSchedule([]);
    setNexusMatches([]);
    setTbaTeams([]);
    setTbaSchedule({});
    setTeamEPAs({});
    setMatchPreds({});
  }, []);

  const refreshTeams = useCallback(async () => {
    if (!currentEvent) return;
    setTeamsLoading(true);

    try {
      // 1. Load cached data first (instant)
      const cachedTeams = await getCachedTeams(currentEvent);
      if (cachedTeams.length > 0) {
        console.log("[Teams] Using cached data:", cachedTeams.length);
        // Convert LocalTeam to Team and TBATeam
        const transformedTeams: Team[] = cachedTeams.map((t) => ({
          key: t.team_key,
          num: t.team_number,
          name: t.name,
          rank: t.rank,
        }));
        setTeams(transformedTeams);

        const transformedTbaTeams: TBATeam[] = cachedTeams.map((t) => ({
          key: t.team_key,
          team: t.team_number,
          name: t.name,
          rank: t.rank,
          record: { wins: t.wins, losses: t.losses, ties: t.ties },
          nextMatch: t.next_match,
          lastMatch: t.last_match,
        }));
        setTbaTeams(transformedTbaTeams);
      }

      // 2. If online, fetch fresh data
      if (navigator.onLine) {
        console.log("[Teams] Fetching fresh data for event:", currentEvent);
        const [supabaseTeams, tbaTeamsData] = await Promise.all([
          getTeams(currentEvent),
          fetchTBAEventTeams(currentEvent),
        ]);

        // Merge TBA data with Supabase data
        type TBATeamData = NonNullable<typeof tbaTeamsData>[number];
        const tbaMap = new Map<string, TBATeamData>(
          (tbaTeamsData ?? []).map((t: TBATeamData) => [t.key, t])
        );

        // Transform and merge
        const mergedTeams: LocalTeam[] = (supabaseTeams ?? []).map(
          (t: { team: string; team_name: string | null; rank?: number }) => {
            const tbaTeam = tbaMap.get(t.team);
            return {
              team_key: t.team,
              event_key: currentEvent,
              team_number: parseInt(t.team.replace("frc", ""), 10),
              name:
                tbaTeam?.name ??
                t.team_name ??
                `Team ${t.team.replace("frc", "")}`,
              rank: tbaTeam?.rank ?? t.rank ?? 0,
              wins: tbaTeam?.record?.wins ?? 0,
              losses: tbaTeam?.record?.losses ?? 0,
              ties: tbaTeam?.record?.ties ?? 0,
              next_match: tbaTeam?.nextMatch ?? null,
              last_match: tbaTeam?.lastMatch ?? null,
              last_synced: Date.now(),
            };
          }
        );

        // Add any TBA teams not in Supabase (B-team handling)
        const supabaseKeys = new Set(
          (supabaseTeams ?? []).map((t: { team: string }) => t.team)
        );
        for (const tbaTeam of tbaTeamsData ?? []) {
          if (!supabaseKeys.has(tbaTeam.key)) {
            mergedTeams.push({
              team_key: tbaTeam.key,
              event_key: currentEvent,
              team_number: tbaTeam.team,
              name: tbaTeam.name,
              rank: tbaTeam.rank,
              wins: tbaTeam.record?.wins ?? 0,
              losses: tbaTeam.record?.losses ?? 0,
              ties: tbaTeam.record?.ties ?? 0,
              next_match: tbaTeam.nextMatch,
              last_match: tbaTeam.lastMatch,
              last_synced: Date.now(),
            });
          }
        }

        mergedTeams.sort((a, b) => a.team_number - b.team_number);

        // Cache the merged data
        await cacheTeams(currentEvent, mergedTeams);

        // Update state
        const transformedTeams: Team[] = mergedTeams.map((t) => ({
          key: t.team_key,
          num: t.team_number,
          name: t.name,
          rank: t.rank,
        }));
        setTeams(transformedTeams);

        const transformedTbaTeams: TBATeam[] = mergedTeams.map((t) => ({
          key: t.team_key,
          team: t.team_number,
          name: t.name,
          rank: t.rank,
          record: { wins: t.wins, losses: t.losses, ties: t.ties },
          nextMatch: t.next_match,
          lastMatch: t.last_match,
        }));
        setTbaTeams(transformedTbaTeams);

        console.log("[Teams] Fresh data cached:", mergedTeams.length);
      } else {
        console.log("[Teams] Offline, using cached data only");
      }
    } catch (e) {
      console.error("[Teams] Failed to fetch:", e);
    } finally {
      setTeamsLoading(false);
    }
  }, [currentEvent]);

  const refreshSchedule = useCallback(async () => {
    if (!currentEvent) return;
    setScheduleLoading(true);

    try {
      // 1. Load cached data first
      const [cachedSchedule, cachedMatches] = await Promise.all([
        getCachedSchedule(currentEvent),
        getCachedMatches(currentEvent),
      ]);

      if (cachedSchedule.length > 0) {
        console.log("[Schedule] Using cached schedule:", cachedSchedule.length);
        setSchedule(
          cachedSchedule.map((s) => ({
            match: s.match_key,
            team: s.team_key,
            alliance: s.alliance,
          }))
        );
      }

      if (cachedMatches.length > 0) {
        console.log("[Schedule] Using cached matches:", cachedMatches.length);
        const tbaScheduleMap: Record<string, TBAMatchData> = {};
        for (const m of cachedMatches) {
          tbaScheduleMap[m.match_key] = {
            redTeams: m.red_teams,
            blueTeams: m.blue_teams,
            est_time: m.est_time,
            redScore: m.red_score,
            blueScore: m.blue_score,
          };
        }
        setTbaSchedule(tbaScheduleMap);
      }

      // 2. If online, fetch fresh data
      if (navigator.onLine) {
        console.log("[Schedule] Fetching fresh data for event:", currentEvent);
        const [supabaseSchedule, tbaScheduleData] = await Promise.all([
          getSchedule(currentEvent),
          fetchTBAMatchSchedule(currentEvent),
        ]);

        // Store supabase schedule
        const scheduleEntries = (supabaseSchedule ?? []).map(
          (s: { match: string; team: string; alliance: string }) => ({
            match: s.match,
            team: s.team,
            alliance: s.alliance as "red" | "blue",
          })
        );
        setSchedule(scheduleEntries);

        // Cache schedule entries
        const localScheduleEntries: LocalScheduleEntry[] = scheduleEntries.map(
          (s: ScheduleEntry) => ({
            event_key: currentEvent,
            match_key: s.match,
            team_key: s.team,
            alliance: s.alliance,
          })
        );
        await cacheSchedule(currentEvent, localScheduleEntries);

        // Store TBA schedule
        if (tbaScheduleData) {
          setTbaSchedule(tbaScheduleData);

          // Cache matches
          const localMatches: LocalMatch[] = (
            Object.entries(tbaScheduleData) as [string, TBAMatchData][]
          ).map(([matchKey, match]) => {
            // Parse match key for comp level and number
            const parts = matchKey.split("_");
            const matchPart = parts[1] || matchKey;
            const compLevel = matchPart.replace(/[0-9]/g, "");
            const matchNumber = parseInt(matchPart.replace(/\D/g, ""), 10) || 0;

            return {
              match_key: matchKey,
              event_key: currentEvent,
              comp_level: compLevel,
              match_number: matchNumber,
              est_time: match.est_time,
              red_teams: match.redTeams,
              blue_teams: match.blueTeams,
              red_score: match.redScore,
              blue_score: match.blueScore,
              last_synced: Date.now(),
            };
          });
          await cacheMatches(currentEvent, localMatches);

          console.log(
            "[Schedule] TBA matches cached:",
            Object.keys(tbaScheduleData).length
          );
        }

        console.log("[Schedule] Fresh data cached");
      } else {
        console.log("[Schedule] Offline, using cached data only");
      }
    } catch (e) {
      console.error("[Schedule] Failed to fetch:", e);
    } finally {
      setScheduleLoading(false);
    }
  }, [currentEvent]);

  const refreshNexus = useCallback(async () => {
    if (!currentEvent) return;
    setNexusLoading(true);
    try {
      // Nexus is always live data - no caching
      if (!navigator.onLine) {
        console.log("[Nexus] Offline, skipping live data fetch");
        setNexusMatches([]);
        return;
      }

      console.log("[Nexus] Fetching live data for event:", currentEvent);
      const nexusData = await getNexusEventStatus(currentEvent);

      if (nexusData) {
        console.log("[Nexus] Received data:", {
          eventKey: nexusData.eventKey,
          matchCount: nexusData.matches?.length ?? 0,
          nowQueuing: nexusData.nowQueuing,
        });
        setNexusMatches(nexusData.matches ?? []);
      } else {
        console.log(
          "[Nexus] No data available for event (may not be live yet)"
        );
        setNexusMatches([]);
      }
    } catch (e) {
      console.error("[Nexus] Failed to fetch data:", e);
      setNexusMatches([]);
    } finally {
      setNexusLoading(false);
    }
  }, [currentEvent]);

  const refreshStatbotics = useCallback(async () => {
    if (!currentEvent) return;

    if (!navigator.onLine) {
      console.log("[Statbotics] Offline, skipping Statbotics fetch");
      return;
    }

    setStatboticsLoading(true);
    try {
      const teamKeys = teams.map((t) => t.key);
      if (teamKeys.length === 0) {
        console.log("[Statbotics] No teams loaded yet, skipping EPA fetch");
      } else {
        console.log("[Statbotics] Fetching team EPAs for event:", currentEvent);
        const epaMap = await fetchEventTeamEPAs(currentEvent, teamKeys);
        setTeamEPAs(epaMap);
      }

      const matchKeys = Object.keys(tbaSchedule);
      if (matchKeys.length === 0) {
        console.log("[Statbotics] No matches loaded yet, skipping match preds");
      } else {
        console.log(
          "[Statbotics] Fetching match predictions:",
          matchKeys.length
        );
        const results = await Promise.all(
          matchKeys.map(async (mk) => {
            const data = await fetchStatboticsMatch(mk);
            return [mk, data] as const;
          })
        );

        const predMap: Record<string, StatboticsMatch> = {};
        for (const [mk, data] of results) {
          if (data) {
            predMap[mk] = data;
          }
        }
        setMatchPreds(predMap);
      }

      console.log("[Statbotics] Updated Statbotics state");
    } catch (e) {
      console.error("[Statbotics] Failed to fetch:", e);
    } finally {
      setStatboticsLoading(false);
    }
  }, [currentEvent, teams, tbaSchedule]);

  const refreshAll = useCallback(async () => {
    console.log(
      "[EventData] Refreshing all data...",
      navigator.onLine ? "(online)" : "(offline)"
    );

    // Load/cache core data first
    await Promise.all([refreshTeams(), refreshSchedule(), refreshNexus()]);

    // Then fetch Statbotics using the loaded team/match keys
    await refreshStatbotics();

    console.log("[EventData] All data refreshed");
  }, [refreshTeams, refreshSchedule, refreshNexus, refreshStatbotics]);

  // Auto-fetch data when event changes
  useEffect(() => {
    if (currentEvent) {
      console.log("[EventData] Event changed to:", currentEvent);
      refreshAll();
    }
  }, [currentEvent, refreshAll]);

  return (
    <EventDataContext.Provider
      value={{
        currentEvent,
        setCurrentEvent,
        teams,
        schedule,
        nexusMatches,
        tbaTeams,
        tbaSchedule,
        teamsLoading,
        scheduleLoading,
        nexusLoading,
        isOnline,
        refreshTeams,
        refreshSchedule,
        refreshNexus,
        refreshAll,
        teamEPAs,
        matchPreds,
        statboticsLoading,
        refreshStatbotics,
      }}
    >
      {children}
    </EventDataContext.Provider>
  );
}

export function useEventData() {
  const context = useContext(EventDataContext);
  if (context === undefined) {
    throw new Error("useEventData must be used within an EventDataProvider");
  }
  return context;
}
