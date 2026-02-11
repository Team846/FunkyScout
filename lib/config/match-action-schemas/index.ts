/**
 * Match action schema loader and utilities
 *
 * Provides functions to load year-specific match action schemas
 * and query action definitions.
 */

import schema2026 from "./2026.json";
import type { MatchActionSchema, ActionDefinition, ActionCategory } from "./actions.types";

// Re-export types for convenience
export * from "./actions.types";

/**
 * Map of year to schema
 * Add new years here as new schema files are created
 */
const schemaMap: Record<number, MatchActionSchema> = {
  2026: schema2026 as MatchActionSchema,
  // 2027: schema2027 as MatchActionSchema,  // Add when 2027.json is created
};

/**
 * Get match action schema for a given event key
 *
 * Extracts year from event key (e.g., "2026caav" → 2026)
 * Falls back to 2026 if year not found
 *
 * @param eventKey - Event key like "2026caav"
 * @returns Match action schema for the year
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * console.log(schema.game);  // "Rebuilt"
 */
export function getMatchActionSchema(eventKey: string): MatchActionSchema {
  const year = parseInt(eventKey.substring(0, 4));
  return schemaMap[year] || schemaMap[2026]; // Fallback to 2026
}

/**
 * Get action definition by ID
 *
 * @param schema - Match action schema
 * @param actionId - Action ID to find
 * @returns Action definition or undefined if not found
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * const action = getActionById(schema, "fuelScore2");
 * console.log(action?.label);  // "Fuel +2"
 */
export function getActionById(
  schema: MatchActionSchema,
  actionId: string
): ActionDefinition | undefined {
  return schema.actions.find((a) => a.id === actionId);
}

/**
 * Get all actions for a specific phase
 *
 * Returns actions where phase === specified phase OR phase === "both"
 *
 * @param schema - Match action schema
 * @param phase - Game phase ("auto" or "teleop")
 * @returns Array of action definitions
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * const autoActions = getActionsByPhase(schema, "auto");
 * // Returns actions with phase "auto" or "both"
 */
export function getActionsByPhase(
  schema: MatchActionSchema,
  phase: "auto" | "teleop"
): ActionDefinition[] {
  return schema.actions.filter((a) => a.phase === phase || a.phase === "both");
}

/**
 * Get all actions by category
 *
 * @param schema - Match action schema
 * @param category - Action category
 * @returns Array of action definitions
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * const userPlaced = getActionsByCategory(schema, "userPlaced");
 * // Returns ["groundIntake", "passing", "dropped"]
 */
export function getActionsByCategory(
  schema: MatchActionSchema,
  category: ActionCategory
): ActionDefinition[] {
  return schema.actions.filter((a) => a.category === category);
}

/**
 * Get all post-match actions
 *
 * Convenience function to get actions that should be filled in match summary page
 *
 * @param schema - Match action schema
 * @returns Array of post-match action definitions
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * const postMatch = getPostMatchActions(schema);
 * // Returns trough, bump, climbOrientation, ratings, etc.
 */
export function getPostMatchActions(
  schema: MatchActionSchema
): ActionDefinition[] {
  return getActionsByCategory(schema, "postMatch");
}

/**
 * Get all scoring actions (actions with points)
 *
 * @param schema - Match action schema
 * @returns Array of action definitions that have point values
 *
 * @example
 * const schema = getMatchActionSchema("2026caav");
 * const scoring = getScoringActions(schema);
 * // Returns fuelScore1, fuelScore2, climb actions, etc.
 */
export function getScoringActions(
  schema: MatchActionSchema
): ActionDefinition[] {
  return schema.actions.filter((a) => a.points !== undefined && a.points > 0);
}
