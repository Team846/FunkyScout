/**
 * Match Scouting Data Types
 *
 * Flexible structure for FRC match scouting that supports:
 * 1. Repeatable intake actions with user-selected field locations
 * 2. Repeatable fuel actions with preset locations
 * 3. On/off toggle actions (disable, defend, climb)
 * 4. Post-match ratings and selections
 */

// ============================================================================
// Category 1: Location Actions with User-Selected Field Position
// ============================================================================

export type LocationActionType = 'ground_intake' | 'passing' | 'shoot';

export interface LocationAction {
  type: LocationActionType;
  timestamp: number;
  coords: [number, number]; // [x, y] normalized 0-1 coordinates (device-independent)
  phase: 'auto' | 'teleop';
  success?: boolean; // Optional: track if action was successful
}

// ============================================================================
// Category 2: Preset Actions (Fixed Location)
// ============================================================================

export type PresetActionType =
  | 'station_intake'  // Station intake (fixed location)
  | 'stocking'        // Stocking (fixed location)
  // Fuel actions - kept in structure but not used in UI currently
  | 'fuel_1'
  | 'fuel_2'
  | 'fuel_5'
  | 'fuel_8';

export interface PresetAction {
  type: PresetActionType;
  timestamp: number;
  phase: 'auto' | 'teleop';
}

// ============================================================================
// Category 3: On/Off Toggle Actions
// ============================================================================

// TIMING CONSTRAINTS:
// - disable: Available in both auto and teleop
// - defend: TELEOP ONLY
// - climb_L1: Available in both auto and teleop
// - climb_L2: TELEOP ONLY
// - climb_L3: TELEOP ONLY

export type ToggleActionType =
  | 'disable'         // No location needed (both phases)
  | 'defend'          // No location needed (TELEOP ONLY)
  | 'climb_L1'        // Has preset location (both phases)
  | 'climb_L2'        // Has preset location (TELEOP ONLY)
  | 'climb_L3';       // Has preset location (TELEOP ONLY)

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

  // Post-match data (all optional)
  postMatch: PostMatchData;

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
 * Active toggle states during the match
 * Tracks which toggles are currently "on"
 */
export interface ActiveToggles {
  disable: boolean;
  defend: boolean;
  climb_L1: boolean;
  climb_L2: boolean;
  climb_L3: boolean;
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
    fuel_1: 1,
    fuel_2: 2,
    fuel_5: 5,
    fuel_8: 8,
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

/**
 * Get currently active toggles from action history
 */
export function getActiveToggles(actions: ToggleAction[]): ActiveToggles {
  const state: ActiveToggles = {
    disable: false,
    defend: false,
    climb_L1: false,
    climb_L2: false,
    climb_L3: false,
  };

  // Process actions in order to get final state
  actions.forEach(action => {
    if (action.type in state) {
      (state as unknown as Record<string, boolean>)[action.type] = action.active;
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
