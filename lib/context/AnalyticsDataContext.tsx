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
import { useTeamData } from "./TeamDataContext";
import { useCompetition } from "./CompetitionDataContext";
import {
  fetchEventMatches,
  fetchEventTeamYears,
  type StatboticsTeamEPAs,
  type StatboticsMatch,
} from "@lib/statbotics";
import {
  getStatboticsEpa,
  cacheStatboticsEpa,
  getStatboticsMatchPred,
  cacheStatboticsMatchPred,
} from "@lib/db";
import {
  PollingController,
  DEFAULT_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";

interface AnalyticsDataContextType {
  teamEPAs: Record<string, StatboticsTeamEPAs>;
  matchPreds: Record<string, StatboticsMatch>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AnalyticsDataContext = createContext<
  AnalyticsDataContextType | undefined
>(undefined);

export function AnalyticsDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { teams } = useTeamData();
  const { tbaSchedule } = useCompetition();

  const [teamEPAs, setTeamEPAs] = useState<Record<string, StatboticsTeamEPAs>>(
    {},
  );
  const [matchPreds, setMatchPreds] = useState<Record<string, StatboticsMatch>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const pollingController = useRef<PollingController | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // 1. Load from cache
    const [cachedEpas, cachedPreds] = await Promise.all([
      getStatboticsEpa(currentEvent),
      getStatboticsMatchPred(currentEvent),
    ]);

    if (cachedEpas.length > 0) {
      const map: Record<string, StatboticsTeamEPAs> = {};
      for (const item of cachedEpas) map[item.team] = item.epa;
      setTeamEPAs(map);
    }
    if (cachedPreds.length > 0) {
      const map: Record<string, StatboticsMatch> = {};
      for (const item of cachedPreds) map[item.match] = item.pred;
      setMatchPreds(map);
    }

    // 2. Network refresh
    if (isOnline && teams.length > 0) {
      console.log("[AnalyticsData] Fetching from Statbotics");
      setLoading(true);
      try {
        const [rawEpas, rawMatches] = await Promise.all([
          fetchEventTeamYears(currentEvent),
          fetchEventMatches(currentEvent),
        ]);

        const epaMap: Record<string, StatboticsTeamEPAs> = {};
        for (const raw of rawEpas) epaMap[`frc${raw.team}`] = raw;
        setTeamEPAs(epaMap);
        await cacheStatboticsEpa(
          Object.entries(epaMap).map(([team, epa]) => ({
            event: currentEvent,
            team,
            epa,
          })),
        );

        const predMap: Record<string, StatboticsMatch> = {};
        for (const raw of rawMatches) predMap[raw.key] = raw;
        setMatchPreds(predMap);
        await cacheStatboticsMatchPred(
          Object.entries(predMap).map(([match, pred]) => ({
            event: currentEvent,
            match,
            pred,
          })),
        );
      } finally {
        setLoading(false);
      }
    }
  }, [currentEvent, dbInitialized, isOnline, teams.length]);

  useEffect(() => {
    if (!currentEvent || !dbInitialized) {
      pollingController.current?.stop();
      setTeamEPAs({});
      setMatchPreds({});
      return;
    }

    if (!pollingController.current) {
      pollingController.current = new PollingController(
        "Analytics",
        fetchAnalytics,
        DEFAULT_POLLING_CONFIG,
      );
    }

    pollingController.current.start();
    pollingController.current.forceRefresh();

    return () => pollingController.current?.stop();
  }, [currentEvent, dbInitialized, fetchAnalytics]);

  const refresh = useCallback(async () => {
    await pollingController.current?.forceRefresh();
  }, []);

  return (
    <AnalyticsDataContext.Provider
      value={{ teamEPAs, matchPreds, loading, refresh }}
    >
      {children}
    </AnalyticsDataContext.Provider>
  );
}

export function useAnalytics() {
  const context = useContext(AnalyticsDataContext);
  if (context === undefined) {
    throw new Error(
      "useAnalytics must be used within an AnalyticsDataProvider",
    );
  }
  return context;
}
