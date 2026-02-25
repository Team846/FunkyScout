/**
 * Match Data Transformation
 *
 * Converts MatchScoutingData (UI format) to MatchDataRaw (database format)
 * - Separates actions by game phase (auto vs teleop)
 * - Transforms action types to MatchAction format
 * - Maps field names and extracts ratings
 */

import type {
  MatchScoutingData,
  PresetAction,
  PresetActionType,
  LocationAction,
  LocationActionType,
  ToggleAction,
  ToggleActionType,
} from '@lib/types/matchScouting';
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
    startPosition: scoutingData.startPosition
      ? { x: scoutingData.startPosition[0], y: scoutingData.startPosition[1] }
      : undefined,
    postMatch: {
      trough: scoutingData.postMatch?.through, // Field name mapping: through → trough
      bump: scoutingData.postMatch?.bump,
      canStation: scoutingData.postMatch?.canStation,
      canGround: scoutingData.postMatch?.canGround,
      autoClimbOrientation: scoutingData.postMatch?.autoClimbOrientation,
      autoClimbFailed: scoutingData.postMatch?.autoClimbFailed,
      teleopClimbOrientation: scoutingData.postMatch?.teleopClimbOrientation,
      teleopDismountTime: scoutingData.postMatch?.teleopDismountTime,
      teleopFailedClimbCount: scoutingData.postMatch?.teleopFailedClimbCount,
      ratings: {
        groundIntake: scoutingData.postMatch?.ratings?.ground,
        shooting: scoutingData.postMatch?.ratings?.shooting,
        passing: scoutingData.postMatch?.ratings?.passing,
      }
    },
    driverRating: scoutingData.postMatch?.ratings?.driver, // Extract driver rating to top level
    notes: scoutingData.notes,
    selectedAuto: scoutingData.selectedAuto ?? undefined,
    autoDescription: scoutingData.autoDescription ?? undefined
  };
}

/**
 * Reverse transform match data from database format back to UI format
 * Used when editing existing match scouting data
 * @param dataRaw - Match data from database (data_raw field)
 * @returns MatchScoutingData in UI format
 */
export function reverseTransformMatchData(dataRaw: MatchDataRaw): MatchScoutingData {
  const presetActions: PresetAction[] = [];
  const locationActions: LocationAction[] = [];
  const toggleActions: ToggleAction[] = [];

  // Process auto actions
  dataRaw.autoActions?.forEach(action => {
    if (action.actionId === 'station_intake' || action.actionId === 'stocking') {
      // Preset action (no location)
      presetActions.push({
        type: action.actionId as PresetActionType,
        timestamp: action.timestamp,
        phase: 'auto'
      });
    } else if (action.location) {
      // Location action (ground_intake, passing, shoot)
      locationActions.push({
        type: action.actionId as LocationActionType,
        timestamp: action.timestamp,
        coords: [action.location.x, action.location.y],
        phase: 'auto'
      });
    } else if (action.enabled !== undefined) {
      // Toggle action (climb, disable, defend, etc.)
      toggleActions.push({
        type: action.actionId as ToggleActionType,
        timestamp: action.timestamp,
        active: action.enabled,
        phase: 'auto'
      });
    }
  });

  // Process teleop actions
  dataRaw.teleopActions?.forEach(action => {
    if (action.actionId === 'station_intake' || action.actionId === 'stocking') {
      presetActions.push({
        type: action.actionId as PresetActionType,
        timestamp: action.timestamp,
        phase: 'teleop'
      });
    } else if (action.location) {
      locationActions.push({
        type: action.actionId as LocationActionType,
        timestamp: action.timestamp,
        coords: [action.location.x, action.location.y],
        phase: 'teleop'
      });
    } else if (action.enabled !== undefined) {
      toggleActions.push({
        type: action.actionId as ToggleActionType,
        timestamp: action.timestamp,
        active: action.enabled,
        phase: action.actionId.startsWith('climb_') ? 'endgame' : 'teleop'
      });
    }
  });

  return {
    presetActions,
    locationActions,
    toggleActions,
    startPosition: dataRaw.startPosition
      ? [dataRaw.startPosition.x, dataRaw.startPosition.y] as [number, number]
      : undefined,
    postMatch: {
      ratings: {
        ground: dataRaw.postMatch?.ratings?.groundIntake as 1|2|3|4|5 | undefined,
        shooting: dataRaw.postMatch?.ratings?.shooting as 1|2|3|4|5 | undefined,
        passing: dataRaw.postMatch?.ratings?.passing as 1|2|3|4|5 | undefined,
        driver: dataRaw.driverRating as 1|2|3|4|5 | undefined,
      },
      through: dataRaw.postMatch?.trough, // Field name mapping: trough → through
      bump: dataRaw.postMatch?.bump,
      canStation: dataRaw.postMatch?.canStation,
      canGround: dataRaw.postMatch?.canGround,
      autoClimbOrientation: dataRaw.postMatch?.autoClimbOrientation,
      autoClimbFailed: dataRaw.postMatch?.autoClimbFailed,
      teleopClimbOrientation: dataRaw.postMatch?.teleopClimbOrientation,
      teleopDismountTime: dataRaw.postMatch?.teleopDismountTime,
      teleopFailedClimbCount: dataRaw.postMatch?.teleopFailedClimbCount,
    },
    notes: dataRaw.notes || '',
    selectedAuto: dataRaw.selectedAuto ?? undefined,
    autoDescription: dataRaw.autoDescription ?? undefined
  };
}
