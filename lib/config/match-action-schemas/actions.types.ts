/**
 * Type definitions for match action schemas
 *
 * These types define the structure for year-based match scouting configurations.
 * Each year can have different actions while maintaining consistent data structure.
 */

/**
 * Match action categories
 *
 * - userPlaced: User taps button, then taps field to place location (e.g., "Ground Intake")
 * - fixedLocation: User taps button, location auto-assigned from config (e.g., "Fuel +2")
 * - toggle: User taps button to toggle state, fixed location (e.g., "Climb L2")
 * - postMatch: Filled in match summary page after match ends (e.g., "Trough", ratings)
 */
export type ActionCategory =
  | "userPlaced"
  | "fixedLocation"
  | "toggle"
  | "postMatch";

/**
 * Game phase for action
 */
export type ActionPhase = "auto" | "teleop" | "both" | "postMatch";

/**
 * Base action definition in config
 */
export interface ActionDefinition {
  /** Unique action ID (e.g., "groundIntake", "fuelScore2", "trough") */
  id: string;

  /** Display label shown to users (e.g., "Ground Intake", "Fuel +2", "Trough") */
  label: string;

  /** Action category determining behavior */
  category: ActionCategory;

  /** Field location in normalized coordinates 0-1 (for fixedLocation and toggle only) */
  location?: { x: number; y: number };

  /** Scoring value for this action (if applicable) */
  points?: number;

  /** Which game phase this action applies to */
  phase?: ActionPhase;
}

/**
 * Year-specific match action config file structure
 */
export interface MatchActionSchema {
  /** Year this schema applies to (e.g., 2026) */
  year: number;

  /** Game name for this year (e.g., "Rebuilt") */
  game: string;

  /** All available actions for this year */
  actions: ActionDefinition[];
}

/**
 * Recorded action in data_raw (during match)
 */
export interface MatchAction {
  /** References ActionDefinition.id from schema */
  actionId: string;

  /** Milliseconds since match start (0-163000: 20s auto + 3s transition + 140s teleop) */
  timestamp: number;

  /** Location in normalized coordinates 0-1 - user-provided (Type 1) or from schema (Type 2/3) */
  location?: { x: number; y: number };

  /** Toggle state (only for toggle actions) */
  enabled?: boolean;
}

/**
 * Post-match clarification data (filled in match summary page)
 */
export interface PostMatchData {
  /** Did robot cross trough? */
  trough?: boolean;

  /** Did robot demonstrate bump capability? */
  bump?: boolean;

  /** Did robot demonstrate station intake this match? */
  canStation?: boolean;

  /** Did robot demonstrate ground intake this match? */
  canGround?: boolean;

  /** Where did robot climb during auto? */
  autoClimbOrientation?: "left" | "right" | "center";

  /** Did the auto climb attempt fail? */
  autoClimbFailed?: boolean;

  /** Where did robot climb during teleop? */
  teleopClimbOrientation?: "left" | "right" | "center";

  /** Dismount time in seconds from teleop start (11 = timed out at 10s) */
  teleopDismountTime?: number;

  /** Number of failed teleop climb attempts */
  teleopFailedClimbCount?: number;

  /** Performance ratings (1-5 scale) */
  ratings?: {
    /** How well did ground intake work? */
    groundIntake?: number;

    /** How well did shooting work? */
    shooting?: number;

    /** How well did passing work? */
    passing?: number;
  };
}

/**
 * Complete data_raw structure stored in event_match_data
 */
export interface MatchDataRaw {
  /** Game year (e.g., 2026) */
  gameYear: number;

  /** Epoch milliseconds when scouting started */
  epochTime: number;

  /** Robot starting position from match_start.tsx (normalized 0-1) */
  startPosition?: { x: number; y: number };

  /** Robot ending position from match_end.tsx (normalized 0-1) */
  endPosition?: { x: number; y: number };

  /** Actions during auto phase (0-20s) */
  autoActions: MatchAction[];

  /** Actions during teleop phase (20-160s) */
  teleopActions: MatchAction[];

  /** Post-match clarifications (from match summary page) */
  postMatch?: PostMatchData;

  /** Overall driver performance rating (1-5 scale) */
  driverRating?: number;

  /** Scouter notes/observations */
  notes?: string;

  /** Auto name from team's pit autos that the robot ran this match (or null) */
  selectedAuto?: string | null;

  /** Short auto description when no preset auto selected */
  autoDescription?: string | null;
}

/**
 * Helper function: Get action definition by ID
 */
export function getActionById(
  schema: MatchActionSchema,
  actionId: string
): ActionDefinition | undefined {
  return schema.actions.find((a) => a.id === actionId);
}

/**
 * Helper function: Get all actions for a specific phase
 */
export function getActionsByPhase(
  schema: MatchActionSchema,
  phase: "auto" | "teleop"
): ActionDefinition[] {
  return schema.actions.filter((a) => a.phase === phase || a.phase === "both");
}

/**
 * Helper function: Get all actions by category
 */
export function getActionsByCategory(
  schema: MatchActionSchema,
  category: ActionCategory
): ActionDefinition[] {
  return schema.actions.filter((a) => a.category === category);
}
