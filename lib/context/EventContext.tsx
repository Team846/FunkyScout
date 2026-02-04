import { createContext, useContext, useState, type ReactNode } from "react";

type EventContextType = {
  currentEvent: string | null;
  setCurrentEvent: (event: string | null) => void;
};

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: ReactNode }) {
  const [currentEvent, setCurrentEvent] = useState<string | null>(null);

  return (
    <EventContext.Provider value={{ currentEvent, setCurrentEvent }}>
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
