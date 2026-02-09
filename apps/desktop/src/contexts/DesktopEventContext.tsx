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
}

const DesktopEventContext = createContext<DesktopEventContextType | undefined>(
  undefined
);

export function DesktopEventProvider({ children }: { children: ReactNode }) {
  const [currentEvent, _setCurrentEvent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load current event from Tauri store on mount
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const config = await invoke<any>("get_config");
        _setCurrentEvent(config.event_key || null);
      } catch (error) {
        console.error(
          "[DesktopEvent] Failed to load event from Tauri store:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadEvent();
  }, []);

  const setCurrentEvent = useCallback(async (event: string | null) => {
    try {
      // Save to Tauri store
      const config = await invoke<any>("get_config");
      config.event_key = event || "";
      await invoke("save_config", { config });

      // Update local state
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

  // Don't render children until we've loaded the initial event
  if (loading) {
    return null;
  }

  return (
    <DesktopEventContext.Provider value={{ currentEvent, setCurrentEvent }}>
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
