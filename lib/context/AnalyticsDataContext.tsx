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
import { useTeamData } from "./TeamDataContext";
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
  LIVE_POLLING_CONFIG,
} from "@lib/utils/fetchUtils";

interface AnalyticsDataContextType {
  teamEPAs: Record<string, StatboticsTeamEPAs>;
  matchPreds: Record<string, StatboticsMatch>;
  loading: boolean;
  initialLoading: boolean;
  refresh: () => Promise<void>;
}

const AnalyticsDataContext = createContext<
  AnalyticsDataContextType | undefined
>(undefined);

export function AnalyticsDataProvider({ children }: { children: ReactNode }) {
  const { currentEvent, dbInitialized, isOnline } = useEvent();
  const { registerRefreshCallback } = useSync();
  const { teams } = useTeamData();

  const [teamEPAs, setTeamEPAs] = useState<Record<string, StatboticsTeamEPAs>>(
    {},
  );
  const [matchPreds, setMatchPreds] = useState<Record<string, StatboticsMatch>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const pollingController = useRef<PollingController | null>(null);

  // Ref for stable access in refresh callback
  const fetchAnalyticsRef = useRef<(() => Promise<void>) | null>(null);
  const skipCacheOnceRef = useRef(false);
  const hasLoadedDataRef = useRef(false);

  const fetchAnalytics = useCallback(async () => {
    if (!currentEvent || !dbInitialized) return;

    // Check if we should skip cache this time (only on event change when online)
    const shouldSkipCache = skipCacheOnceRef.current && isOnline;
    if (shouldSkipCache) {
      skipCacheOnceRef.current = false; // Clear immediately
    }

    // 1. Load from cache only on first load (no live data yet) and if not skipping.
    // Once hasLoadedDataRef is true we have live data in state — don't overwrite it
    // with potentially stale cache.
    if (!shouldSkipCache && !hasLoadedDataRef.current) {
      const [cachedEpas, cachedPreds] = await Promise.all([
        getStatboticsEpa(currentEvent),
        getStatboticsMatchPred(currentEvent),
      ]);

      if (cachedEpas.length > 0) {
        const map: Record<string, StatboticsTeamEPAs> = {};
        for (const item of cachedEpas) map[item.team] = item.epa;
        setTeamEPAs(map);
        hasLoadedDataRef.current = true;
      }
      if (cachedPreds.length > 0) {
        const map: Record<string, StatboticsMatch> = {};
        for (const item of cachedPreds) map[item.match] = item.pred;
        setMatchPreds(map);
      }
    }

    // 2. Network refresh
    if (isOnline && teams.length > 0) {
      console.log("[AnalyticsData] Fetching from Statbotics");
      // Only show loading on initial load or event change (prevents flickering on background refreshes)
      const isInitialLoad = !hasLoadedDataRef.current;
      if (isInitialLoad || shouldSkipCache) {
        setLoading(true);
      }
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
        hasLoadedDataRef.current = true;
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    } else {
      // Offline or no teams: done after cache
      setInitialLoading(false);
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
        LIVE_POLLING_CONFIG, // 5min — Statbotics EPA/match predictions change slowly
      );
      pollingController.current.start();
    }

    return () => {
      pollingController.current?.stop();
      pollingController.current = null;
    };
  }, [dbInitialized, fetchAnalyticsStable]);

  // Handle event changes - fetch data immediately
  useEffect(() => {
    if (!currentEvent) {
      setTeamEPAs({});
      setMatchPreds({});
      setInitialLoading(false);
      hasLoadedDataRef.current = false;
      return;
    }

    if (dbInitialized) {
      // Set skip flag when changing events (only if online and has prior data)
      if (isOnline && hasLoadedDataRef.current) {
        skipCacheOnceRef.current = true;
        setInitialLoading(true);
      }
      fetchAnalytics();
    }
  }, [currentEvent, dbInitialized, fetchAnalytics, isOnline]);

  const refresh = useCallback(async () => {
    console.log("[AnalyticsDataContext] Refresh callback triggered");
    // Use ref to call current fetch function without changing callback identity.
    // forceRefresh() is NOT called — that would duplicate this fetch.
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

  // Memoize context value to prevent unnecessary re-renders when polling runs but data hasn't changed
  const contextValue = useMemo(
    () => ({ teamEPAs, matchPreds, loading, initialLoading, refresh }),
    [teamEPAs, matchPreds, loading, initialLoading, refresh]
  );

  return (
    <AnalyticsDataContext.Provider value={contextValue}>
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
