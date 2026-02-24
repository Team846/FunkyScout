/**
 * Match Statistics Calculation Utility
 *
 * Centralized, type-safe statistics calculation for match scouting data.
 * Provides both per-match and aggregate team statistics.
 *
 * Works identically on mobile and desktop platforms.
 */

import type { EventMatchData } from "@lib/db";
import type {
  MatchDataRaw,
  MatchAction,
  PostMatchData,
} from "@lib/config/match-action-schemas/actions.types";

// ============ TYPE DEFINITIONS ============

/**
 * Action counts by type
 */
interface ActionCounts {
  groundIntakes: number;
  stationIntakes: number;
  passes: number;
  shoots: number;
  stocking: number;
}

/**
 * Climb information
 */
interface ClimbInfo {
  hasAutoClimb: boolean;
  autoClimbTime: number | null;      // seconds robot climbed in auto (20 - start time)
  autoClimbOrientation: "left" | "right" | "center" | null;
  level: "L1" | "L2" | "L3" | null; // final teleop climb level
  teleopClimbTime: number | null;    // seconds robot climbed in teleop (140 - start time)
  teleopClimbOrientation: "left" | "right" | "center" | null;
  failedClimbCount: number;          // teleop failed climb attempts
  dismountTime: number | null;       // seconds from teleop start (11 = timeout)
}

/**
 * Per-match statistics
 */
export interface MatchStats {
  // Action counts by phase
  auto: ActionCounts;
  teleop: ActionCounts;

  // Climb statistics
  climb: ClimbInfo;

  // Ratings (from postMatch)
  ratings: {
    ground: number | null;    // 1-5
    shooting: number | null;  // 1-5 (was station)
    passing: number | null;   // 1-5
    driver: number | null;    // 1-5
  };

  // Capabilities
  capabilities: {
    bump: boolean;
    trough: boolean;
    canStation: boolean;
    canGround: boolean;
  };

  // Match info
  matchKey: string;
  team: string;
  alliance: "red" | "blue" | null;
  wasDisabled: boolean;
  didDefend: boolean;
  notes: string | null;

  // Timeline metrics
  timeline: {
    totalAutoActions: number;
    totalTeleopActions: number;
    autoActionDensity: number; // Actions per second (0-20s)
    teleopActionDensity: number; // Actions per second (20-160s)
  };

  // Success metrics (null if not tracked)
  successRates: {
    auto: {
      groundIntakes: number | null;
      passes: number | null;
      shoots: number | null;
    };
    teleop: {
      groundIntakes: number | null;
      passes: number | null;
      shoots: number | null;
    };
  };
}

/**
 * Aggregate team statistics across all matches
 */
export interface TeamStats {
  teamKey: string;
  matchCount: number; // Total matches scouted

  // Action averages per match
  averages: {
    auto: ActionCounts;
    teleop: ActionCounts;
  };

  // Climb statistics
  climb: {
    autoClimbPercentage: number; // % of matches with auto climb
    L1Percentage: number; // % ending at L1
    L2Percentage: number; // % ending at L2
    L3Percentage: number; // % ending at L3
    averageLevel: number; // Average climb level (0-3)
  };

  // Average ratings across all matches
  ratings: {
    ground: number | null;
    shooting: number | null;
    passing: number | null;
    driver: number | null;
    overall: number | null; // Average of all four ratings
  };

  // Percentages
  disabledPercentage: number; // % of matches disabled
  defendPercentage: number; // % of matches playing defense

  // Capabilities (any match where true)
  hasBump: boolean;
  hasTrough: boolean;
  hasStation: boolean;
  hasGround: boolean;

  // Consistency scores (variability across matches)
  consistency: {
    ratingStdDev: number; // Std deviation of overall ratings
    actionCountStdDev: number; // Std deviation of total actions per match
    climbConsistency: number; // % matches with same climb level as mode
  };

  // Success rates (requires success field in actions)
  successRates: {
    auto: {
      groundIntakes: number | null; // % successful (0-100)
      passes: number | null;
      shoots: number | null;
    };
    teleop: {
      groundIntakes: number | null;
      passes: number | null;
      shoots: number | null;
    };
  };

  // Timeline analysis
  timeline: {
    autoActionDensity: number; // Actions per second in auto (0-20s)
    teleopActionDensity: number; // Actions per second in teleop (20-160s)
    averageActionTimestamp: {
      // Average time when each action type occurs
      auto: Record<string, number>; // e.g., { "ground_intake": 8.5 }
      teleop: Record<string, number>;
    };
  };
}

// ============ MAIN CALCULATION FUNCTIONS ============

/**
 * Calculate statistics for a single match
 */
export function calculateSingleMatchStats(
  matchData: EventMatchData
): MatchStats | null {
  if (!matchData.data_raw) return null;

  const raw = matchData.data_raw as MatchDataRaw;

  // Count actions by type and phase
  const autoCounts = countActions(raw.autoActions || []);
  const teleopCounts = countActions(raw.teleopActions || []);

  // Determine final climb state
  const climbInfo = analyzeClimbActions(
    raw.autoActions || [],
    raw.teleopActions || [],
    raw.postMatch
  );

  // Extract ratings
  const ratings = extractRatings(raw.postMatch, raw.driverRating);

  return {
    auto: autoCounts,
    teleop: teleopCounts,
    climb: climbInfo,
    ratings,
    capabilities: {
      bump: raw.postMatch?.bump || false,
      trough: raw.postMatch?.trough || false,
      canStation: raw.postMatch?.canStation || false,
      canGround: raw.postMatch?.canGround || false,
    },
    matchKey: matchData.match,
    team: matchData.team,
    alliance: (matchData.alliance as "red" | "blue") || null,
    wasDisabled: detectToggleState(
      raw.autoActions || [],
      raw.teleopActions || [],
      "disable"
    ),
    didDefend: detectToggleState(
      raw.autoActions || [],
      raw.teleopActions || [],
      "defend"
    ),
    notes: raw.notes || null,
    timeline: calculateSingleMatchTimeline(
      raw.autoActions || [],
      raw.teleopActions || []
    ),
    successRates: calculateSingleMatchSuccessRates(
      raw.autoActions || [],
      raw.teleopActions || []
    ),
  };
}

/**
 * Calculate aggregate statistics for a team across multiple matches
 */
export function calculateTeamStats(
  teamKey: string,
  matchDataArray: EventMatchData[]
): TeamStats | null {
  // Filter to this team and only matches with data_raw
  const teamMatches = matchDataArray.filter(
    (m) => m.team === teamKey && m.data_raw && Object.keys(m.data_raw).length > 0
  );

  if (teamMatches.length === 0) return null;

  // Calculate stats for each match
  const matchStats = teamMatches
    .map(calculateSingleMatchStats)
    .filter((s): s is MatchStats => s !== null);

  if (matchStats.length === 0) return null;

  // Aggregate across all matches
  return {
    teamKey,
    matchCount: matchStats.length,
    averages: calculateAverageActions(matchStats),
    climb: calculateClimbStats(matchStats),
    ratings: calculateAverageRatings(matchStats),
    disabledPercentage: calculatePercentage(matchStats, (s) => s.wasDisabled),
    defendPercentage: calculatePercentage(matchStats, (s) => s.didDefend),
    hasBump: matchStats.some((s) => s.capabilities.bump),
    hasTrough: matchStats.some((s) => s.capabilities.trough),
    hasStation: matchStats.some((s) => s.capabilities.canStation),
    hasGround: matchStats.some((s) => s.capabilities.canGround),
    consistency: calculateConsistencyScores(matchStats),
    successRates: calculateSuccessRates(matchStats),
    timeline: calculateTimelineAnalysis(matchStats),
  };
}

/**
 * Get stats for all teams at an event
 */
export function calculateAllTeamStats(
  matchDataArray: EventMatchData[]
): Record<string, TeamStats> {
  const teamKeys = [...new Set(matchDataArray.map((m) => m.team))];
  const stats: Record<string, TeamStats> = {};

  for (const teamKey of teamKeys) {
    const teamStats = calculateTeamStats(teamKey, matchDataArray);
    if (teamStats) {
      stats[teamKey] = teamStats;
    }
  }

  return stats;
}

// ============ HELPER FUNCTIONS ============

/**
 * Count actions by type
 */
function countActions(actions: MatchAction[]): ActionCounts {
  const counts: ActionCounts = {
    groundIntakes: 0,
    stationIntakes: 0,
    passes: 0,
    shoots: 0,
    stocking: 0,
  };

  for (const action of actions) {
    if (action.actionId === "ground_intake") counts.groundIntakes++;
    else if (action.actionId === "station_intake") counts.stationIntakes++;
    else if (action.actionId === "passing") counts.passes++;
    else if (action.actionId === "shoot") counts.shoots++;
    else if (action.actionId === "stocking") counts.stocking++;
  }

  return counts;
}

/**
 * Analyze climb actions to determine final state.
 * Toggle actions use enabled=true (start) / enabled=false (fail/end).
 * A climb is "successful" if the last enabled=true has no subsequent enabled=false.
 */
function analyzeClimbActions(
  autoActions: MatchAction[],
  teleopActions: MatchAction[],
  postMatch?: PostMatchData
): ClimbInfo {
  // --- Auto climb (climb_L1 only in auto) ---
  const autoClimbActions = autoActions.filter((a) => a.actionId === "climb_L1");
  let hasAutoClimb = false;
  let autoClimbTime: number | null = null;

  if (autoClimbActions.length > 0) {
    const lastStart = [...autoClimbActions].reverse().find((a) => a.enabled === true);
    if (lastStart) {
      // Check if there's a fail (enabled=false) after the last start
      const lastStartIdx = autoClimbActions.indexOf(lastStart);
      const failAfter = autoClimbActions.slice(lastStartIdx + 1).some((a) => a.enabled === false);
      if (!failAfter) {
        hasAutoClimb = true;
        // timestamp is ms from match start during auto (0-20000ms)
        autoClimbTime = Math.max(0, 20 - lastStart.timestamp / 1000);
      }
    }
  }

  // --- Teleop climb (L1/L2/L3) ---
  const teleopClimbActions = teleopActions.filter((a) => a.actionId.startsWith("climb_L"));
  let level: "L1" | "L2" | "L3" | null = null;
  let teleopClimbTime: number | null = null;

  if (teleopClimbActions.length > 0) {
    const lastStart = [...teleopClimbActions].reverse().find((a) => a.enabled === true);
    if (lastStart) {
      const lastStartIdx = teleopClimbActions.indexOf(lastStart);
      const failAfter = teleopClimbActions.slice(lastStartIdx + 1).some((a) => a.enabled === false);
      if (!failAfter) {
        if (lastStart.actionId === "climb_L1") level = "L1";
        else if (lastStart.actionId === "climb_L2") level = "L2";
        else if (lastStart.actionId === "climb_L3") level = "L3";
        // timestamp is ms from teleop start (0-140000ms)
        teleopClimbTime = Math.max(0, 140 - lastStart.timestamp / 1000);
      }
    }
  }

  // Count failed teleop climb attempts (enabled=true with a subsequent enabled=false)
  let failedClimbCount = postMatch?.teleopFailedClimbCount ?? 0;

  return {
    hasAutoClimb,
    autoClimbTime,
    autoClimbOrientation: postMatch?.autoClimbOrientation ?? null,
    level,
    teleopClimbTime,
    teleopClimbOrientation: postMatch?.teleopClimbOrientation ?? null,
    failedClimbCount,
    dismountTime: postMatch?.teleopDismountTime ?? null,
  };
}

/**
 * Extract ratings from post-match data
 */
function extractRatings(
  postMatch: PostMatchData | undefined,
  driverRating: number | undefined
): MatchStats["ratings"] {
  return {
    ground: postMatch?.ratings?.groundIntake ?? null,
    shooting: postMatch?.ratings?.shooting ?? null,
    passing: postMatch?.ratings?.passing ?? null,
    driver: driverRating ?? null,
  };
}

/**
 * Detect if a toggle action was activated at any point
 */
function detectToggleState(
  autoActions: MatchAction[],
  teleopActions: MatchAction[],
  actionId: string
): boolean {
  const allActions = [...autoActions, ...teleopActions];
  return allActions.some((a) => a.actionId === actionId && a.enabled === true);
}

/**
 * Calculate timeline metrics for a single match
 */
function calculateSingleMatchTimeline(
  autoActions: MatchAction[],
  teleopActions: MatchAction[]
) {
  const AUTO_DURATION = 20; // seconds
  const TELEOP_DURATION = 140; // seconds

  return {
    totalAutoActions: autoActions.length,
    totalTeleopActions: teleopActions.length,
    autoActionDensity: autoActions.length / AUTO_DURATION,
    teleopActionDensity: teleopActions.length / TELEOP_DURATION,
  };
}

/**
 * Calculate success rates for a single match (returns null if not tracked)
 */
function calculateSingleMatchSuccessRates(
  _autoActions: MatchAction[],
  _teleopActions: MatchAction[]
) {
  // Placeholder - returns null until success field is added to actions
  return {
    auto: {
      groundIntakes: null,
      passes: null,
      shoots: null,
    },
    teleop: {
      groundIntakes: null,
      passes: null,
      shoots: null,
    },
  };
}

/**
 * Calculate average action counts across matches
 */
function calculateAverageActions(matchStats: MatchStats[]) {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const avg = (values: number[]) => (values.length > 0 ? sum(values) / values.length : 0);

  return {
    auto: {
      groundIntakes: avg(matchStats.map((s) => s.auto.groundIntakes)),
      stationIntakes: avg(matchStats.map((s) => s.auto.stationIntakes)),
      passes: avg(matchStats.map((s) => s.auto.passes)),
      shoots: avg(matchStats.map((s) => s.auto.shoots)),
      stocking: avg(matchStats.map((s) => s.auto.stocking)),
    },
    teleop: {
      groundIntakes: avg(matchStats.map((s) => s.teleop.groundIntakes)),
      stationIntakes: avg(matchStats.map((s) => s.teleop.stationIntakes)),
      passes: avg(matchStats.map((s) => s.teleop.passes)),
      shoots: avg(matchStats.map((s) => s.teleop.shoots)),
      stocking: avg(matchStats.map((s) => s.teleop.stocking)),
    },
  };
}

/**
 * Calculate climb statistics across matches
 */
function calculateClimbStats(matchStats: MatchStats[]) {
  const total = matchStats.length;
  if (total === 0) {
    return {
      autoClimbPercentage: 0,
      L1Percentage: 0,
      L2Percentage: 0,
      L3Percentage: 0,
      averageLevel: 0,
    };
  }

  // Calculate average climb level
  const levelValues: number[] = matchStats.map((s) => {
    if (s.climb.level === "L1") return 1;
    if (s.climb.level === "L2") return 2;
    if (s.climb.level === "L3") return 3;
    return 0;
  });
  const avgLevel = levelValues.reduce((a: number, b: number) => a + b, 0) / total;

  return {
    autoClimbPercentage:
      (matchStats.filter((s) => s.climb.hasAutoClimb).length / total) * 100,
    L1Percentage:
      (matchStats.filter((s) => s.climb.level === "L1").length / total) * 100,
    L2Percentage:
      (matchStats.filter((s) => s.climb.level === "L2").length / total) * 100,
    L3Percentage:
      (matchStats.filter((s) => s.climb.level === "L3").length / total) * 100,
    averageLevel: avgLevel,
  };
}

/**
 * Calculate average ratings across matches
 */
function calculateAverageRatings(matchStats: MatchStats[]) {
  const validRatings = (values: (number | null)[]) =>
    values.filter((v): v is number => v !== null);

  const groundRatings = validRatings(matchStats.map((s) => s.ratings.ground));
  const shootingRatings = validRatings(matchStats.map((s) => s.ratings.shooting));
  const passingRatings = validRatings(matchStats.map((s) => s.ratings.passing));
  const driverRatings = validRatings(matchStats.map((s) => s.ratings.driver));

  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const ground = avg(groundRatings);
  const shooting = avg(shootingRatings);
  const passing = avg(passingRatings);
  const driver = avg(driverRatings);

  // Calculate overall rating from all valid ratings
  const allRatings = [
    ...groundRatings,
    ...shootingRatings,
    ...passingRatings,
    ...driverRatings,
  ];
  const overall = avg(allRatings);

  return { ground, shooting, passing, driver, overall };
}

/**
 * Calculate percentage of matches matching a condition
 */
function calculatePercentage(
  matchStats: MatchStats[],
  predicate: (s: MatchStats) => boolean
): number {
  if (matchStats.length === 0) return 0;
  return (matchStats.filter(predicate).length / matchStats.length) * 100;
}

/**
 * Calculate consistency scores across matches
 */
function calculateConsistencyScores(matchStats: MatchStats[]) {
  // Rating standard deviation
  const overallRatings = matchStats.map((s) => {
    const validRatings = [
      s.ratings.ground,
      s.ratings.shooting,
      s.ratings.passing,
      s.ratings.driver,
    ].filter((x): x is number => x !== null);
    return validRatings.length > 0
      ? validRatings.reduce((a, b) => a + b, 0) / validRatings.length
      : 0;
  });
  const ratingStdDev = calculateStdDev(overallRatings);

  // Total action count standard deviation
  const actionCounts = matchStats.map(
    (s) =>
      s.auto.groundIntakes +
      s.auto.stationIntakes +
      s.auto.passes +
      s.auto.shoots +
      s.auto.stocking +
      s.teleop.groundIntakes +
      s.teleop.stationIntakes +
      s.teleop.passes +
      s.teleop.shoots +
      s.teleop.stocking
  );
  const actionCountStdDev = calculateStdDev(actionCounts);

  // Climb consistency (% of matches with most common climb level)
  const climbLevels = matchStats.map((s) => s.climb.level);
  const modeClimbLevel = findMode(climbLevels);
  const climbConsistency =
    matchStats.length > 0
      ? (climbLevels.filter((l) => l === modeClimbLevel).length /
          matchStats.length) *
        100
      : 0;

  return {
    ratingStdDev,
    actionCountStdDev,
    climbConsistency,
  };
}

/**
 * Calculate success rates across matches (returns null if no success data tracked)
 */
function calculateSuccessRates(_matchStats: MatchStats[]) {
  // This requires actions to have a success field (not currently implemented)
  // For now, return null - can be implemented when success tracking is added
  return {
    auto: {
      groundIntakes: null,
      passes: null,
      shoots: null,
    },
    teleop: {
      groundIntakes: null,
      passes: null,
      shoots: null,
    },
  };
}

/**
 * Calculate timeline analysis across matches
 */
function calculateTimelineAnalysis(matchStats: MatchStats[]) {
  const total = matchStats.length;
  if (total === 0) {
    return {
      autoActionDensity: 0,
      teleopActionDensity: 0,
      averageActionTimestamp: {
        auto: {},
        teleop: {},
      },
    };
  }

  // Average action density (actions per second)
  const autoActionDensity =
    matchStats.reduce((sum, s) => sum + s.timeline.autoActionDensity, 0) / total;
  const teleopActionDensity =
    matchStats.reduce((sum, s) => sum + s.timeline.teleopActionDensity, 0) / total;

  // Average timestamps for when each action type occurs
  // This shows when teams typically perform certain actions
  const averageActionTimestamp = {
    auto: calculateAverageActionTimestamps(matchStats, "auto"),
    teleop: calculateAverageActionTimestamps(matchStats, "teleop"),
  };

  return {
    autoActionDensity,
    teleopActionDensity,
    averageActionTimestamp,
  };
}

/**
 * Calculate average timestamps for each action type in a phase
 */
function calculateAverageActionTimestamps(
  _matchStats: MatchStats[],
  _phase: "auto" | "teleop"
): Record<string, number> {
  // This would require access to raw action timestamps
  // For now, return empty object - can be implemented if needed
  return {};
}

// ============ UTILITY FUNCTIONS ============

/**
 * Calculate standard deviation of a set of values
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * Find mode (most common value) in an array
 */
function findMode<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  const counts = new Map<T, number>();
  arr.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  let maxCount = 0;
  let mode: T | null = null;
  counts.forEach((count, item) => {
    if (count > maxCount) {
      maxCount = count;
      mode = item;
    }
  });
  return mode;
}

// ============ GRAPHABLE STATS ============

/**
 * Optional context passed to GraphableStat.getValue for stats that need
 * team-level information not present in per-match scouting data.
 *
 * tbaClimbData: Record<matchKey, Record<teamKey, { auto_climb, teleop_climb }>>
 * Used by climb/fuel point stats to use TBA as the authoritative climb source.
 */
export interface GraphableStatContext {
  epa?: number | null;
  tbaClimbData?: Record<
    string,
    Record<string, { auto_climb: "L1" | "L2" | "L3" | null; teleop_climb: "L1" | "L2" | "L3" | null }>
  >;
}

/** Shorthand for the TBA climb entry shape used in context and getTbaStatDataPoints. */
type TbaClimbEntry = { auto_climb: "L1" | "L2" | "L3" | null; teleop_climb: "L1" | "L2" | "L3" | null };

/**
 * A stat that can be extracted from a single match and graphed over time.
 *
 * source:
 *   "scouting" (default) — computed from scouted MatchStats; use getStatDataPoints().
 *                           Denominator = matches scouted.
 *   "tba"                — computed from TBA climb data; use getTbaStatDataPoints().
 *                           Denominator = all matches played (correct for TBA-sourced data).
 *
 * getValueFromTba: required when source === "tba". Takes a raw TBA climb entry and optional
 *   EPA — no scouted MatchStats needed. getTbaStatDataPoints() calls this.
 *
 * getValue: always present. For "tba" stats this can be used as a fallback when passing
 *   through getStatDataPoints() with tbaClimbData in context, but the denominator will be
 *   matches-scouted rather than matches-played.
 */
export interface GraphableStat {
  key: string;
  label: string;
  group: "Auto" | "Teleop" | "Combined" | "Climb" | "Ratings";
  source?: "scouting" | "tba";
  getValue: (stats: MatchStats, context?: GraphableStatContext) => number | null;
  getValueFromTba?: (entry: TbaClimbEntry, epa?: number | null) => number | null;
  normalize: (value: number, allValues: number[]) => number;
}

/** Scale relative to the observed max. Safe when all values are 0. */
function relativeNorm(value: number, allValues: number[]): number {
  const max = Math.max(...allValues);
  return max > 0 ? value / max : 0;
}

/** Scale within a fixed known range [min, max] → [0, 1]. */
function absoluteNorm(min: number, max: number) {
  return (value: number, _allValues: number[]) =>
    max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
}

export const GRAPHABLE_STATS: GraphableStat[] = [
  // Auto
  { key: "auto_shoots",           label: "Auto Shoots",           group: "Auto",     getValue: (s) => s.auto.shoots,          normalize: relativeNorm },
  { key: "auto_ground_intakes",   label: "Auto Ground Intakes",   group: "Auto",     getValue: (s) => s.auto.groundIntakes,   normalize: relativeNorm },
  { key: "auto_station_intakes",  label: "Auto Outpost Intakes",  group: "Auto",     getValue: (s) => s.auto.stationIntakes,  normalize: relativeNorm },
  { key: "auto_passes",           label: "Auto Passes",           group: "Auto",     getValue: (s) => s.auto.passes,          normalize: relativeNorm },
  {
    key: "auto_total_actions", label: "Auto Total Actions", group: "Auto",
    getValue: (s) => s.auto.groundIntakes + s.auto.stationIntakes + s.auto.passes + s.auto.shoots + s.auto.stocking,
    normalize: relativeNorm,
  },

  // Teleop
  { key: "teleop_shoots",          label: "Teleop Shoots",          group: "Teleop",  getValue: (s) => s.teleop.shoots,         normalize: relativeNorm },
  { key: "teleop_ground_intakes",  label: "Teleop Ground Intakes",  group: "Teleop",  getValue: (s) => s.teleop.groundIntakes,  normalize: relativeNorm },
  { key: "teleop_station_intakes", label: "Teleop Outpost Intakes", group: "Teleop",  getValue: (s) => s.teleop.stationIntakes, normalize: relativeNorm },
  { key: "teleop_passes",          label: "Teleop Passes",          group: "Teleop",  getValue: (s) => s.teleop.passes,         normalize: relativeNorm },
  {
    key: "teleop_total_actions", label: "Teleop Total Actions", group: "Teleop",
    getValue: (s) => s.teleop.groundIntakes + s.teleop.stationIntakes + s.teleop.passes + s.teleop.shoots + s.teleop.stocking,
    normalize: relativeNorm,
  },

  // Combined
  {
    key: "total_shoots", label: "Total Shoots", group: "Combined",
    getValue: (s) => s.auto.shoots + s.teleop.shoots,
    normalize: relativeNorm,
  },
  {
    key: "total_intakes", label: "Total Intakes", group: "Combined",
    getValue: (s) => s.auto.groundIntakes + s.auto.stationIntakes + s.teleop.groundIntakes + s.teleop.stationIntakes,
    normalize: relativeNorm,
  },
  {
    key: "total_actions", label: "Total Actions", group: "Combined",
    getValue: (s) =>
      s.auto.groundIntakes + s.auto.stationIntakes + s.auto.passes + s.auto.shoots + s.auto.stocking +
      s.teleop.groundIntakes + s.teleop.stationIntakes + s.teleop.passes + s.teleop.shoots + s.teleop.stocking,
    normalize: relativeNorm,
  },

  // Climb
  {
    // source: "tba" — use getTbaStatDataPoints() so denominator = all played matches.
    key: "avg_climb_points", label: "Avg Climb Points", group: "Climb",
    source: "tba",
    getValueFromTba: (entry) => {
      let pts = entry.auto_climb != null ? 15 : 0;
      if (entry.teleop_climb === "L1") pts += 10;
      else if (entry.teleop_climb === "L2") pts += 20;
      else if (entry.teleop_climb === "L3") pts += 30;
      return pts;
    },
    // Fallback via getStatDataPoints (denominator = matches scouted — less accurate)
    getValue: (s, ctx) => {
      const tba = ctx?.tbaClimbData?.[s.matchKey]?.[s.team];
      if (!tba) return null;
      let pts = tba.auto_climb != null ? 15 : 0;
      if (tba.teleop_climb === "L1") pts += 10;
      else if (tba.teleop_climb === "L2") pts += 20;
      else if (tba.teleop_climb === "L3") pts += 30;
      return pts;
    },
    normalize: absoluteNorm(0, 45),
  },
  {
    // source: "tba" — use getTbaStatDataPoints() so denominator = all played matches.
    key: "avg_fuel_points", label: "Avg Fuel Points", group: "Climb",
    source: "tba",
    getValueFromTba: (entry, epa) => {
      if (epa == null) return null;
      let climbPts = entry.auto_climb != null ? 15 : 0;
      if (entry.teleop_climb === "L1") climbPts += 10;
      else if (entry.teleop_climb === "L2") climbPts += 20;
      else if (entry.teleop_climb === "L3") climbPts += 30;
      return epa - climbPts;
    },
    getValue: (s, ctx) => {
      if (ctx?.epa == null) return null;
      const tba = ctx?.tbaClimbData?.[s.matchKey]?.[s.team];
      if (!tba) return null;
      let climbPts = tba.auto_climb != null ? 15 : 0;
      if (tba.teleop_climb === "L1") climbPts += 10;
      else if (tba.teleop_climb === "L2") climbPts += 20;
      else if (tba.teleop_climb === "L3") climbPts += 30;
      return ctx.epa - climbPts;
    },
    normalize: relativeNorm,
  },
  {
    // Teleop climb in points (L1=10, L2=20, L3=30) from TBA. source: "tba".
    key: "climb_level", label: "Avg Teleop Climb Pts", group: "Climb",
    source: "tba",
    getValueFromTba: (entry) => {
      if (entry.teleop_climb === "L1") return 10;
      if (entry.teleop_climb === "L2") return 20;
      if (entry.teleop_climb === "L3") return 30;
      return 0;
    },
    getValue: (s) =>
      s.climb.level === "L1" ? 10 : s.climb.level === "L2" ? 20 : s.climb.level === "L3" ? 30 : 0,
    normalize: absoluteNorm(0, 30),
  },
  {
    // Auto climb in points (15 if any level, 0 if none) from TBA. source: "tba".
    key: "auto_climb", label: "Avg Auto Climb Pts", group: "Climb",
    source: "tba",
    getValueFromTba: (entry) => entry.auto_climb != null ? 15 : 0,
    getValue: (s) => s.climb.hasAutoClimb ? 15 : 0,
    normalize: absoluteNorm(0, 15),
  },
  {
    // Time on cage in auto (20s - press time). Null when no auto climb.
    // Higher = started earlier = better.
    key: "auto_climb_time", label: "Auto Climb Time (s)", group: "Climb",
    getValue: (s) => s.climb.autoClimbTime,
    normalize: absoluteNorm(0, 20),
  },
  {
    // Time on cage in teleop (140s - press time). Null when no teleop climb.
    // Higher = started earlier = better.
    key: "teleop_climb_time", label: "Teleop Climb Time (s)", group: "Climb",
    getValue: (s) => s.climb.teleopClimbTime,
    normalize: absoluteNorm(0, 140),
  },
  {
    // Seconds into teleop before dismount pressed. Null when no dismount.
    // Inverted: higher bar = faster dismount (lower time = better).
    key: "dismount_time", label: "Dismount Speed", group: "Climb",
    getValue: (s) => s.climb.dismountTime,
    normalize: (value, _) => 1 - absoluteNorm(0, 11)(value, _),
  },

  // Ratings (1-5 scale → 0-1)
  { key: "rating_ground",    label: "Ground Intake Rating", group: "Ratings", getValue: (s) => s.ratings.ground,    normalize: absoluteNorm(1, 5) },
  { key: "rating_shooting",  label: "Shooting Rating",      group: "Ratings", getValue: (s) => s.ratings.shooting,  normalize: absoluteNorm(1, 5) },
  { key: "rating_passing",   label: "Passing Rating",       group: "Ratings", getValue: (s) => s.ratings.passing,   normalize: absoluteNorm(1, 5) },
  { key: "rating_driver",    label: "Driver Rating",        group: "Ratings", getValue: (s) => s.ratings.driver,    normalize: absoluteNorm(1, 5) },
  {
    key: "rating_overall",
    label: "Overall Rating",
    group: "Ratings",
    getValue: (s) => {
      const vals = [s.ratings.ground, s.ratings.shooting, s.ratings.passing, s.ratings.driver]
        .filter((v): v is number => v !== null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    },
    normalize: absoluteNorm(1, 5),
  },
];

/**
 * Extract normalized data points for one stat across a team's matches,
 * ordered by match key. Matches where the stat is unavailable are omitted.
 */
export function getStatDataPoints(
  statKey: string,
  matchDataArray: EventMatchData[],
  context?: GraphableStatContext
): Array<{ matchKey: string; raw: number; normalized: number }> {
  const stat = GRAPHABLE_STATS.find((s) => s.key === statKey);
  if (!stat) return [];

  const points: Array<{ matchKey: string; raw: number }> = [];
  for (const matchData of matchDataArray) {
    const stats = calculateSingleMatchStats(matchData);
    if (!stats) continue;
    const raw = stat.getValue(stats, context);
    if (raw === null) continue;
    points.push({ matchKey: matchData.match, raw });
  }

  const allValues = points.map((p) => p.raw);
  return points.map((p) => ({
    matchKey: p.matchKey,
    raw: p.raw,
    normalized: stat.normalize(p.raw, allValues),
  }));
}

/**
 * For stats with source === "tba":
 * Iterates ALL matches in tbaClimbData that have an entry for teamKey.
 * Denominator = total matches played (from TBA), NOT matches scouted.
 *
 * Use this instead of getStatDataPoints() for avg_climb_points / avg_fuel_points.
 */
export function getTbaStatDataPoints(
  statKey: string,
  teamKey: string,
  tbaClimbData: Record<string, Record<string, TbaClimbEntry>>,
  epa?: number | null
): Array<{ matchKey: string; raw: number; normalized: number }> {
  const stat = GRAPHABLE_STATS.find((s) => s.key === statKey);
  if (!stat?.getValueFromTba) return [];

  const points: Array<{ matchKey: string; raw: number }> = [];
  for (const [matchKey, teamEntries] of Object.entries(tbaClimbData)) {
    const entry = teamEntries[teamKey];
    if (!entry) continue;
    const raw = stat.getValueFromTba(entry, epa);
    if (raw === null) continue;
    points.push({ matchKey, raw });
  }

  const allValues = points.map((p) => p.raw);
  return points.map((p) => ({
    matchKey: p.matchKey,
    raw: p.raw,
    normalized: stat.normalize(p.raw, allValues),
  }));
}
