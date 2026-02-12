/**
 * Match Data Transformation
 *
 * Converts MatchScoutingData (UI format) to MatchDataRaw (database format)
 * - Separates actions by game phase (auto vs teleop)
 * - Transforms action types to MatchAction format
 * - Maps field names and extracts ratings
 */

import type { MatchScoutingData } from '@lib/types/matchScouting';
import type { MatchDataRaw, MatchAction } from '@lib/config/match-action-schemas/actions.types';

/**
 * Transform match scouting data from UI format to database format
 * @param scoutingData - Match data collected during scouting
 * @param gameYear - Current FRC game year (default: 2025)
 * @returns Transformed data ready for database storage
 */
export function transformMatchData(
  scoutingData: MatchScoutingData,
  gameYear: number = 2025
): MatchDataRaw {
  const epochTime = Date.now();
  const autoActions: MatchAction[] = [];
  const teleopActions: MatchAction[] = [];

  // Transform locationActions (ground_intake, passing, shoot)
  // These have user-selected field coordinates
  scoutingData.locationActions.forEach(action => {
    const matchAction: MatchAction = {
      actionId: action.type,
      timestamp: action.timestamp,
      location: { x: action.coords[0], y: action.coords[1] }
    };

    if (action.phase === 'auto') {
      autoActions.push(matchAction);
    } else {
      teleopActions.push(matchAction);
    }
  });

  // Transform presetActions (station_intake, stocking)
  // These have fixed locations defined in fieldLocations.ts
  scoutingData.presetActions.forEach(action => {
    const matchAction: MatchAction = {
      actionId: action.type,
      timestamp: action.timestamp
    };

    if (action.phase === 'auto') {
      autoActions.push(matchAction);
    } else {
      teleopActions.push(matchAction);
    }
  });

  // Transform toggleActions (disable, defend, climb_L1/L2/L3, climb_dismount)
  // These track on/off states with timestamps
  scoutingData.toggleActions.forEach(action => {
    const matchAction: MatchAction = {
      actionId: action.type,
      timestamp: action.timestamp,
      enabled: action.active
    };

    if (action.phase === 'auto') {
      autoActions.push(matchAction);
    } else {
      teleopActions.push(matchAction);
    }
  });

  // Sort actions by timestamp within each phase
  autoActions.sort((a, b) => a.timestamp - b.timestamp);
  teleopActions.sort((a, b) => a.timestamp - b.timestamp);

  return {
    gameYear,
    epochTime,
    autoActions,
    teleopActions,
    postMatch: {
      trough: scoutingData.postMatch?.through, // Field name mapping: through → trough
      climbOrientation: scoutingData.postMatch?.climb_orientation,
      ratings: {
        groundIntake: scoutingData.postMatch?.ratings?.ground,
        stationIntake: scoutingData.postMatch?.ratings?.station,
        passing: scoutingData.postMatch?.ratings?.passing,
      }
    },
    driverRating: scoutingData.postMatch?.ratings?.driver, // Extract driver rating to top level
    notes: scoutingData.notes
  };
}
