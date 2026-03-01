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
import { useDesktopRealtime } from "./DesktopRealtimeContext";
import { getUserProfiles, type UserProfile } from "../lib/db";

export type { UserProfile };

interface UserProfilesContextType {
  userProfiles: UserProfile[];
  refresh: () => Promise<void>;
}

const UserProfilesContext = createContext<UserProfilesContextType | undefined>(
  undefined
);

export function UserProfilesProvider({ children }: { children: ReactNode }) {
  const { registerRefreshCallback } = useDesktopRealtime();

  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const fetchRef = useRef<(() => Promise<void>) | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const profiles = await getUserProfiles();
      setUserProfiles(profiles);
    } catch (error) {
      console.error("[UserProfiles] Failed to read from SQLite:", error);
    }
  }, []);

  // Keep ref in sync
  useEffect(() => {
    fetchRef.current = fetchProfiles;
  }, [fetchProfiles]);

  // Fetch on mount + refresh every 135s (aligned with DesktopTeamDataContext)
  useEffect(() => {
    fetchProfiles();

    const timer = setInterval(() => {
      console.log("[UserProfiles] Post-sync SQLite refresh (135s)");
      fetchRef.current?.();
    }, 135_000);

    return () => clearInterval(timer);
  }, [fetchProfiles]);

  // Register refresh callback for realtime updates
  useEffect(() => {
    const unregister = registerRefreshCallback(() => {
      fetchRef.current?.();
    });
    return unregister;
  }, [registerRefreshCallback]);

  const refresh = useCallback(async () => {
    if (fetchRef.current) {
      await fetchRef.current();
    }
  }, []);

  const contextValue = useMemo(
    () => ({ userProfiles, refresh }),
    [userProfiles, refresh]
  );

  return (
    <UserProfilesContext.Provider value={contextValue}>
      {children}
    </UserProfilesContext.Provider>
  );
}

export function useUserProfiles() {
  const context = useContext(UserProfilesContext);
  if (!context) {
    throw new Error(
      "useUserProfiles must be used within UserProfilesProvider"
    );
  }
  return context;
}
