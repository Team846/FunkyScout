import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getTeams, getSchedule } from "@lib/data";
import { getNexusEventStatus, type NexusMatch } from "@lib/nexus";
import { fetchTBAEventTeams, fetchTBAMatchSchedule } from "@lib/tba";

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

  // Refresh functions
  refreshTeams: () => Promise<void>;
  refreshSchedule: () => Promise<void>;
  refreshNexus: () => Promise<void>;
  refreshAll: () => Promise<void>;
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

  // Loading states
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [nexusLoading, setNexusLoading] = useState(false);

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
  }, []);

  const refreshTeams = useCallback(async () => {
    if (!currentEvent) return;
    setTeamsLoading(true);
    try {
      console.log("[Teams] Fetching for event:", currentEvent);
      const [supabaseTeams, tbaTeamsData] = await Promise.all([
        getTeams(currentEvent),
        fetchTBAEventTeams(currentEvent),
      ]);

      // Transform supabase teams
      const transformedTeams: Team[] = (supabaseTeams ?? []).map((t) => ({
        key: t.team,
        num: parseInt(t.team.replace("frc", ""), 10),
        name: t.team_name ?? `Team ${t.team.replace("frc", "")}`,
        rank: (t as any).rank ?? 0,
      }));
      transformedTeams.sort((a, b) => a.num - b.num);
      setTeams(transformedTeams);
      console.log("[Teams] Supabase teams:", transformedTeams.length);

      // Store TBA teams
      if (tbaTeamsData) {
        setTbaTeams(
          tbaTeamsData.map((t) => ({
            key: t.key,
            team: t.team,
            name: t.name,
            rank: t.rank,
            record: t.record,
            nextMatch: t.nextMatch,
            lastMatch: t.lastMatch,
          }))
        );
        console.log("[Teams] TBA teams:", tbaTeamsData.length);
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
      console.log("[Schedule] Fetching for event:", currentEvent);
      const [supabaseSchedule, tbaScheduleData] = await Promise.all([
        getSchedule(currentEvent),
        fetchTBAMatchSchedule(currentEvent),
      ]);

      // Store supabase schedule
      const scheduleEntries = (supabaseSchedule ?? []).map((s) => ({
        match: s.match,
        team: s.team,
        alliance: s.alliance as "red" | "blue",
      }));
      setSchedule(scheduleEntries);
      console.log("[Schedule] Supabase entries:", scheduleEntries.length);

      // Store TBA schedule
      if (tbaScheduleData) {
        setTbaSchedule(tbaScheduleData);
        console.log("[Schedule] TBA matches:", Object.keys(tbaScheduleData).length);
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
      console.log("[Nexus] Fetching data for event:", currentEvent);
      const nexusData = await getNexusEventStatus(currentEvent);

      // getNexusEventStatus returns false on error/no data
      if (nexusData) {
        console.log("[Nexus] Received data:", {
          eventKey: nexusData.eventKey,
          matchCount: nexusData.matches?.length ?? 0,
          nowQueuing: nexusData.nowQueuing,
        });
        setNexusMatches(nexusData.matches ?? []);
      } else {
        console.log("[Nexus] No data available for event (may not be live yet)");
        setNexusMatches([]);
      }
    } catch (e) {
      console.error("[Nexus] Failed to fetch data:", e);
      setNexusMatches([]);
    } finally {
      setNexusLoading(false);
    }
  }, [currentEvent]);

  const refreshAll = useCallback(async () => {
    console.log("[EventData] Refreshing all data...");
    await Promise.all([refreshTeams(), refreshSchedule(), refreshNexus()]);
    console.log("[EventData] All data refreshed");
  }, [refreshTeams, refreshSchedule, refreshNexus]);

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
        refreshTeams,
        refreshSchedule,
        refreshNexus,
        refreshAll,
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
