/**
 * Match Scouting Data Types
 *
 * Flexible structure for FRC match scouting that supports:
 * 1. Repeatable intake actions with user-selected field locations
 * 2. Repeatable fuel actions with preset locations
 * 3. On/off toggle actions (disable, defend, climb)
 * 4. Post-match ratings and selections
 *
 * Action IDs match the schema in lib/config/match-action-schemas/2026.json exactly.
 */

// ============================================================================
// Category 1: Location Actions with User-Selected Field Position
// ============================================================================

export type LocationActionType = 'groundIntake' | 'passing' | 'shootPassing' | 'shoot' | 'camp' | 'disrupt';

export interface LocationAction {
  type: LocationActionType;
  timestamp: number;
  coords: [number, number]; // [x, y] normalized 0-1 coordinates (device-independent)
  phase: 'auto' | 'teleop';
  success?: boolean; // Optional: track if action was successful
  onOpponentField?: boolean; // true when action is placed on opponent's half (defend mode)
}

// ============================================================================
// Category 2: Preset Actions (Fixed Location)
// ============================================================================

export type PresetActionType =
  | 'stationIntake'   // Station intake (fixed location)
  | 'stationStocked'  // Stocking (fixed location)
  // Fuel actions - kept in structure but not used in UI currently
  | 'fuelScore1'
  | 'fuelScore2'
  | 'fuelScore5'
  | 'fuelScore8';

export interface PresetAction {
  type: PresetActionType;
  timestamp: number;
  phase: 'auto' | 'teleop';
}

// ============================================================================
// Category 3: On/Off Toggle Actions
// ============================================================================

// TIMING CONSTRAINTS:
// - autoDisable / teleopDisable: Available in both auto and teleop
// - teleopDefend: TELEOP ONLY
// - block: TELEOP ONLY (hold action during defend mode)
// - autoClimbL1: Auto phase only
// - teleopClimbL1/L2/L3: Teleop/endgame only

export type ToggleActionType =
  | 'autoDisable'     // No location needed (auto phase)
  | 'teleopDisable'   // No location needed (teleop phase)
  | 'autoDefend'      // No location needed (auto phase, rare)
  | 'teleopDefend'    // No location needed (TELEOP ONLY)
  | 'block'           // Hold action during defend mode (TELEOP ONLY)
  | 'autoClimbL1'     // Has preset location (auto phase)
  | 'teleopClimbL1'   // Has preset location (TELEOP ONLY)
  | 'teleopClimbL2'   // Has preset location (TELEOP ONLY)
  | 'teleopClimbL3';  // Has preset location (TELEOP ONLY)

export interface ToggleAction {
  type: ToggleActionType;
  timestamp: number;
  active: boolean; // true = started/enabled, false = stopped/disabled
  phase: 'auto' | 'teleop' | 'endgame';
}

// ============================================================================
// Category 4: Post-Match Selections (After Match Summary)
// ============================================================================

export interface PostMatchData {
  // Capability toggles
  bump?: boolean;
  through?: boolean;
  canStation?: boolean;  // demonstrated station intake this match
  canGround?: boolean;   // demonstrated ground intake this match

  // Climb orientation (separate for auto and teleop)
  autoClimbOrientation?: 'left' | 'right' | 'center';
  autoClimbFailed?: boolean;
  teleopClimbOrientation?: 'left' | 'right' | 'center';

  // Dismount time in seconds from teleop start (11 = timed out at 10s)
  teleopDismountTime?: number;

  // Number of failed teleop climb attempts
  teleopFailedClimbCount?: number;

  // 1-5 ratings for various abilities
  ratings?: {
    ground?: 1 | 2 | 3 | 4 | 5;
    shooting?: 1 | 2 | 3 | 4 | 5;
    passing?: 1 | 2 | 3 | 4 | 5;
    driver?: 1 | 2 | 3 | 4 | 5;
  };
}

// ============================================================================
// Complete Match Scouting Data Structure
// ============================================================================

export interface MatchScoutingData {
  // Action arrays (empty if not used)
  locationActions: LocationAction[];
  presetActions: PresetAction[];
  toggleActions: ToggleAction[];

  // Robot starting position — normalized [x, y] in 0-1 space (canonical red-alliance orientation)
  startPosition?: [number, number];

  // Post-match data (all optional)
  postMatch: PostMatchData;

  /** Selected auto name from team's pit autos (or null if none ran) */
  selectedAuto?: string | null;

  /** Short auto description when "None" selected (custom auto not in pit list) */
  autoDescription?: string | null;

  // Free-form notes
  notes?: string;

  // Metadata
  scoutName?: string;
  scoutUid?: string;
}

// ============================================================================
// Helper Types for UI State Management
// ============================================================================

/**
 * Active toggle states during the match (UI keys — phase-agnostic)
 * Multiple stored action types (e.g. autoDisable + teleopDisable) map to a single UI key.
 */
export interface ActiveToggles {
  disable: boolean;
  defend: boolean;
  block: boolean;
  climbL1: boolean;
  climbL2: boolean;
  climbL3: boolean;
}

/**
 * Fuel counter state
 * Aggregates fuel actions for quick display
 */
export interface FuelCounters {
  auto: number;
  teleop: number;
  total: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create empty match scouting data
 */
export function createEmptyMatchData(): MatchScoutingData {
  return {
    locationActions: [],
    presetActions: [],
    toggleActions: [],
    postMatch: {},
  };
}

/**
 * Calculate total fuel scored from preset actions
 */
export function calculateFuelTotal(actions: PresetAction[]): FuelCounters {
  const fuelMap: Record<string, number> = {
    fuelScore1: 1,
    fuelScore2: 2,
    fuelScore5: 5,
    fuelScore8: 8,
  };

  let auto = 0;
  let teleop = 0;

  actions.forEach(action => {
    const value = fuelMap[action.type] || 0;
    if (action.phase === 'auto') {
      auto += value;
    } else {
      teleop += value;
    }
  });

  return {
    auto,
    teleop,
    total: auto + teleop,
  };
}

/** Maps stored ToggleActionType to the corresponding ActiveToggles UI key */
const TOGGLE_TYPE_TO_KEY: Record<string, keyof ActiveToggles> = {
  autoDisable:   'disable',
  teleopDisable: 'disable',
  autoDefend:    'defend',
  teleopDefend:  'defend',
  block:         'block',
  autoClimbL1:   'climbL1',
  teleopClimbL1: 'climbL1',
  teleopClimbL2: 'climbL2',
  teleopClimbL3: 'climbL3',
};

/**
 * Get currently active toggles from action history
 */
export function getActiveToggles(actions: ToggleAction[]): ActiveToggles {
  const state: ActiveToggles = {
    disable: false,
    defend: false,
    block: false,
    climbL1: false,
    climbL2: false,
    climbL3: false,
  };

  actions.forEach(action => {
    const key = TOGGLE_TYPE_TO_KEY[action.type];
    if (key !== undefined) {
      state[key] = action.active;
    }
  });

  return state;
}

/**
 * Convert pixel coordinates to normalized 0-1 coordinates
 * @param pixelX - X pixel position
 * @param pixelY - Y pixel position
 * @param containerWidth - Width of the container in pixels
 * @param containerHeight - Height of the container in pixels
 * @returns Normalized [x, y] coordinates between 0 and 1
 */
export function pixelToNormalized(
  pixelX: number,
  pixelY: number,
  containerWidth: number,
  containerHeight: number
): [number, number] {
  return [
    Math.max(0, Math.min(1, pixelX / containerWidth)),
    Math.max(0, Math.min(1, pixelY / containerHeight))
  ];
}

/**
 * Convert normalized 0-1 coordinates to pixel coordinates
 * @param normalizedX - Normalized X position (0-1)
 * @param normalizedY - Normalized Y position (0-1)
 * @param containerWidth - Width of the container in pixels
 * @param containerHeight - Height of the container in pixels
 * @returns Pixel [x, y] coordinates
 */
export function normalizedToPixel(
  normalizedX: number,
  normalizedY: number,
  containerWidth: number,
  containerHeight: number
): [number, number] {
  return [
    normalizedX * containerWidth,
    normalizedY * containerHeight
  ];
}
