/**
 * Fixed field locations for preset actions
 * Coordinates are normalized [x, y] where:
 * - [0, 0] = top-left
 * - [1, 0] = top-right
 * - [0, 1] = bottom-left
 * - [1, 1] = bottom-right
 * - [0.5, 0.5] = center
 *
 * NOTE: Red and blue alliances use the SAME coordinates.
 * Different field maps handle alliance-specific visualization.
 * Coordinates are inverted when the user rotates the field (via rotate button).
 */

export type FieldCoords = [number, number];

/**
 * Fixed locations for preset actions on the field
 * All coordinates are the same for red/blue - inversion happens on field rotation
 *
 * STATION_INTAKE & STOCKING: [0.05, 0.9] - Bottom-left area
 * CLIMB: [0.05, 0.5] - Left side, vertical center
 * DEPOT: [0.05, 0.3] - Left side, upper area
 * SHOOT: [0.5, 0.5] - Center field
 */
export const PRESET_ACTION_LOCATIONS = {
  station_intake: [0.05, 0.9] as FieldCoords,
  stocking: [0.05, 0.9] as FieldCoords,
  climb: [0.05, 0.5] as FieldCoords,
  bump: [0.05, 0.3] as FieldCoords,
  shoot: [0.5, 0.5] as FieldCoords,
};

/**
 * Get the field location for a preset action type
 * @param actionType - The preset action type
 * @param isRotated - Whether the field is currently rotated (inverts coordinates)
 * @returns Normalized [x, y] coordinates
 */
export function getPresetActionLocation(
  actionType: keyof typeof PRESET_ACTION_LOCATIONS,
  isRotated: boolean = false
): FieldCoords {
  const [x, y] = PRESET_ACTION_LOCATIONS[actionType];

  // Invert coordinates when field is rotated
  if (isRotated) {
    return [1 - x, 1 - y];
  }

  return [x, y];
}
