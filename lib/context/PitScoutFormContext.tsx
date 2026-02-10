/**
 * PitScoutFormContext - Manages pit scouting form state between pages
 *
 * Stores form data from /pitscout page to be used in /pitscout-images page
 * Cleaner than URL params for large form data
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// Type definitions for auto path drawer
interface Point {
  x: number;
  y: number;
}

interface Path {
  points: Point[];
  color: string;
  lineWidth: number;
}

interface DrawingData {
  paths: Path[];
  canvasWidth: number;
  canvasHeight: number;
}

export interface AutoEntry {
  id: number;
  climb: boolean;
  drawing: DrawingData | null;
  name?: string;
  description?: string;
}

export interface PitScoutFormData {
  teamNum: number;
  teamName: string;
  /* GENERATED:TYPES:START */
  movement: {
    depot: boolean;
    trough: boolean;
  };
  intake: {
    ground: boolean;
    station: boolean;
    depot: boolean;
    stocking: boolean;
  };
  fuel: {
    shootMoving: boolean;
    passing: boolean;
    bps?: string;
    capacity?: string;
  };
  climb: {
    level: string | null;
    left: boolean;
    right: boolean;
    declimb: boolean;
  };
    /* GENERATED:END */
  autos: AutoEntry[];
}

interface PitScoutFormContextType {
  formData: PitScoutFormData | null;
  setFormData: (data: PitScoutFormData) => void;
  clearFormData: () => void;
}

const PitScoutFormContext = createContext<
  PitScoutFormContextType | undefined
>(undefined);

export function PitScoutFormProvider({ children }: { children: ReactNode }) {
  const [formData, setFormData] = useState<PitScoutFormData | null>(null);

  const clearFormData = useCallback(() => {
    setFormData(null);
    console.log("[PitScoutForm] Form data cleared");
  }, []);

  const handleSetFormData = useCallback((data: PitScoutFormData) => {
    setFormData(data);
    console.log("[PitScoutForm] Form data saved for Team", data.teamNum);
  }, []);

  return (
    <PitScoutFormContext.Provider
      value={{
        formData,
        setFormData: handleSetFormData,
        clearFormData,
      }}
    >
      {children}
    </PitScoutFormContext.Provider>
  );
}

export function usePitScoutForm() {
  const context = useContext(PitScoutFormContext);
  if (!context) {
    throw new Error(
      "usePitScoutForm must be used within PitScoutFormProvider",
    );
  }
  return context;
}
