import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { initDatabase } from "@lib/db";

interface EventContextType {
  currentEvent: string | null;
  setCurrentEvent: (event: string | null) => void;
  isOnline: boolean;
  dbInitialized: boolean;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: ReactNode }) {
  const [currentEvent, _setCurrentEvent] = useState<string | null>(() => {
    return localStorage.getItem("current_event");
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dbInitialized, setDbInitialized] = useState(false);
  const initInFlight = useRef(false);

  // Initialize database once
  useEffect(() => {
    if (!initInFlight.current) {
      initInFlight.current = true;
      initDatabase()
        .then(() => {
          console.log("[EventContext] DB Initialized");
          setDbInitialized(true);
        })
        .catch((e) => {
          console.error("[EventContext] Failed to initialize DB:", e);
        });
    }
  }, []);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
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
  }, []);

  return (
    <EventContext.Provider
      value={{ currentEvent, setCurrentEvent, isOnline, dbInitialized }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  const context = useContext(EventContext);
  if (context === undefined) {
    throw new Error("useEvent must be used within an EventProvider");
  }
  return context;
}
