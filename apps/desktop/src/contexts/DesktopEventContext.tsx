import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

interface DesktopEventContextType {
  currentEvent: string | null;
  setCurrentEvent: (event: string | null) => Promise<void>;
  homeTeam: number;
  setHomeTeam: (team: number) => Promise<void>;
  useTbaClimb: boolean;
  setUseTbaClimb: (value: boolean) => Promise<void>;
}

const DesktopEventContext = createContext<DesktopEventContextType | undefined>(
  undefined
);

export function DesktopEventProvider({ children }: { children: ReactNode }) {
  const [currentEvent, _setCurrentEvent] = useState<string | null>(null);
  const [homeTeam, _setHomeTeam] = useState<number>(846);
  const [useTbaClimb, _setUseTbaClimb] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Load current event, home team, and settings from Tauri store on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await invoke<any>("get_config");

        // Fresh install: Tauri store has empty API keys.
        // Seed from bundled env vars so the Rust sync can connect to Supabase.
        let needsSave = false;
        if (!config.supabase_url) {
          config.supabase_url = import.meta.env.VITE_SUPABASE_URL;
          needsSave = true;
        }
        if (!config.supabase_key) {
          config.supabase_key = import.meta.env.VITE_SUPABASE_ANON_KEY;
          needsSave = true;
        }
        if (!config.tba_key) {
          config.tba_key = import.meta.env.VITE_X_TBA_AUTH_KEY;
          needsSave = true;
        }
        if (needsSave) {
          await invoke("save_config", { config });
          console.log("[DesktopEvent] Seeded API keys from env vars (fresh install)");
        }

        _setCurrentEvent(config.event_key || null);
        const parsedTeam = parseInt(config.team_key || "846", 10);
        _setHomeTeam(isNaN(parsedTeam) ? 846 : parsedTeam);
        _setUseTbaClimb(config.use_tba_climb ?? false);
      } catch (error) {
        console.error(
          "[DesktopEvent] Failed to load config from Tauri store:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const setCurrentEvent = useCallback(async (event: string | null) => {
    try {
      const config = await invoke<any>("get_config");
      config.event_key = event || "";
      await invoke("save_config", { config });
      _setCurrentEvent(event);
      console.log("[DesktopEvent] Event changed to:", event);
    } catch (error) {
      console.error(
        "[DesktopEvent] Failed to save event to Tauri store:",
        error
      );
      throw error;
    }
  }, []);

  const setHomeTeam = useCallback(async (team: number) => {
    try {
      const config = await invoke<any>("get_config");
      config.team_key = String(team);
      await invoke("save_config", { config });
      _setHomeTeam(team);
      console.log("[DesktopEvent] Home team changed to:", team);
    } catch (error) {
      console.error(
        "[DesktopEvent] Failed to save home team to Tauri store:",
        error
      );
      throw error;
    }
  }, []);

  const setUseTbaClimb = useCallback(async (value: boolean) => {
    try {
      const config = await invoke<any>("get_config");
      config.use_tba_climb = value;
      await invoke("save_config", { config });
      _setUseTbaClimb(value);
      console.log("[DesktopEvent] Use TBA climb changed to:", value);
    } catch (error) {
      console.error(
        "[DesktopEvent] Failed to save use_tba_climb to Tauri store:",
        error
      );
      throw error;
    }
  }, []);

  // Don't render children until we've loaded the initial config
  if (loading) {
    return null;
  }

  return (
    <DesktopEventContext.Provider value={{ currentEvent, setCurrentEvent, homeTeam, setHomeTeam, useTbaClimb, setUseTbaClimb }}>
      {children}
    </DesktopEventContext.Provider>
  );
}

export function useDesktopEvent() {
  const context = useContext(DesktopEventContext);
  if (!context) {
    throw new Error("useDesktopEvent must be used within DesktopEventProvider");
  }
  return context;
}
