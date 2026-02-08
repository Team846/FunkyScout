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
  const { registerRefreshCallback } = useSync();
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

  // Ref for stable access in refresh callback
  const fetchAnalyticsRef = useRef<(() => Promise<void>) | null>(null);

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

  // Keep ref in sync
  useEffect(() => {
    fetchAnalyticsRef.current = fetchAnalytics;
  }, [fetchAnalytics]);

  // Stable wrapper for polling - always calls latest fetch function
  const fetchAnalyticsStable = useCallback(async () => {
    if (fetchAnalyticsRef.current) {
      await fetchAnalyticsRef.current();
    }
  }, []); // Never changes!

  // Start controller once when dbInitialized (never stop/start on event changes)
  useEffect(() => {
    if (!dbInitialized) return;

    if (!pollingController.current) {
      pollingController.current = new PollingController(
        "Analytics",
        fetchAnalyticsStable,
        DEFAULT_POLLING_CONFIG,
      );
      pollingController.current.start();
    }

    return () => pollingController.current?.stop();
  }, [dbInitialized, fetchAnalyticsStable]);

  // Handle event changes - fetch data immediately
  useEffect(() => {
    if (!currentEvent) {
      setTeamEPAs({});
      setMatchPreds({});
      return;
    }

    if (dbInitialized) {
      // Clear state to show empty UI while new data loads
      setTeamEPAs({});
      setMatchPreds({});
      // Fetch analytics immediately when event changes
      fetchAnalytics();
    }
  }, [currentEvent, dbInitialized, fetchAnalytics]);

  const refresh = useCallback(async () => {
    console.log("[AnalyticsDataContext] Refresh callback triggered");
    // Use ref to call current fetch function without changing callback identity
    if (fetchAnalyticsRef.current) {
      await fetchAnalyticsRef.current();
    }
  }, []); // Empty dependencies - callback never changes!

  // Register refresh callback with SyncContext
  useEffect(() => {
    if (!registerRefreshCallback) return;

    console.log(
      "[AnalyticsDataContext] Registering refresh callback with SyncContext",
    );
    const unregister = registerRefreshCallback(refresh);

    return () => {
      console.log("[AnalyticsDataContext] Unregistering refresh callback");
      unregister();
    };
  }, [registerRefreshCallback, refresh]);

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
