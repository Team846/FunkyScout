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
import { getSchedule } from "@lib/data";
import { fetchTBAMatchSchedule } from "@lib/tba";
import { getNexusEventStatus, type NexusMatch } from "@lib/nexus";
import {
  getEventSchedule,
  cacheEventSchedule,
  getTbaMatches,
  cacheTbaMatches,
  type TbaMatch,
  type EventScheduleEntry,
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
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [tbaSchedule, setTbaSchedule] = useState<Record<string, TBAMatchData>>(
    {},
  );
  const [nexusMatches, setNexusMatches] = useState<NexusMatch[]>([]);
  const [loading, setLoading] = useState(false);

  const schedulePolling = useRef<PollingController | null>(null);
  const nexusPolling = useRef<PollingController | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // 1. Load from cache
    const [cachedSchedule, cachedTba] = await Promise.all([
      getEventSchedule(currentEvent),
      getTbaMatches(currentEvent),
    ]);

    if (cachedSchedule.length > 0) {
      setSchedule(
        cachedSchedule.map((s) => ({
          match: s.match,
          team: s.team,
          alliance: s.alliance as "red" | "blue",
        })),
      );
    }

    if (cachedTba.length > 0) {
      const map: Record<string, TBAMatchData> = {};
      for (const m of cachedTba) {
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
          const entries = supabaseSchedule.map((s: any) => ({
            match: s.match,
            team: s.team,
            alliance: s.alliance as "red" | "blue",
          }));
          setSchedule(entries);
          await cacheEventSchedule(
            entries.map((s) => ({ ...s, event: currentEvent })),
          );
        }

        if (tbaData) {
          setTbaSchedule(tbaData);
          const tbaMatches: TbaMatch[] = Object.entries(tbaData).map(
            ([key, m]) => ({
              event: currentEvent,
              match_key: key,
              red_teams: m.redTeams,
              blue_teams: m.blueTeams,
              est_time: m.est_time,
              red_score: m.redScore ?? undefined,
              blue_score: m.blueScore ?? undefined,
              last_synced: Date.now(),
            }),
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

  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      schedulePolling.current?.stop();
      nexusPolling.current?.stop();
      setSchedule([]);
      setTbaSchedule({});
      setNexusMatches([]);
      return;
    }

    if (!schedulePolling.current) {
      schedulePolling.current = new PollingController(
        "Schedule",
        fetchSchedule,
        DEFAULT_POLLING_CONFIG,
      );
    }
    if (!nexusPolling.current) {
      nexusPolling.current = new PollingController(
        "Nexus",
        fetchNexus,
        LIVE_POLLING_CONFIG,
      );
    }

    schedulePolling.current.start();
    schedulePolling.current.forceRefresh();
    nexusPolling.current.start();
    nexusPolling.current.forceRefresh();

    return () => {
      schedulePolling.current?.stop();
      nexusPolling.current?.stop();
    };
  }, [currentEvent, dbInitialized, fetchSchedule, fetchNexus]);

  const refresh = useCallback(async () => {
    await Promise.all([
      schedulePolling.current?.forceRefresh(),
      nexusPolling.current?.forceRefresh(),
    ]);
  }, []);

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
      "useCompetition must be used within a CompetitionDataProvider",
    );
  }
  return context;
}
