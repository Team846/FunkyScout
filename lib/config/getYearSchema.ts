/**
 * Schema loader for pit scouting forms
 *
 * Loads year-specific pit scouting configurations based on event keys.
 * Falls back to 2026 schema if year schema doesn't exist.
 */

import type {
  PitScoutingSchema,
  SchemaField,
  SchemaSection,
} from "./pit-scouting-schemas/schema.types";
import { findField, isFieldVisible } from "./pit-scouting-schemas/schema.types";

// Import schemas (add more as years are added)
import schema2026 from "./pit-scouting-schemas/2026.json";

/**
 * Extract year from event key
 * Event keys follow format: YYYYCODE (e.g., "2026caav" → "2026")
 *
 * @param eventKey - TBA event key
 * @returns Year as string
 */
export function getYearFromEvent(eventKey: string): string {
  return eventKey.slice(0, 4);
}

/**
 * Load pit scouting schema for a specific event
 *
 * @param eventKey - TBA event key (e.g., "2026caav")
 * @returns Promise resolving to pit scouting schema
 *
 * @example
 * const schema = await getPitScoutingSchema("2026caav");
 * console.log(schema.game); // "Reefscape"
 */
export async function getPitScoutingSchema(
  eventKey: string
): Promise<PitScoutingSchema> {
  const year = getYearFromEvent(eventKey);

  // Map year to schema (add new years here)
  const schemaMap: Record<string, PitScoutingSchema> = {
    "2026": schema2026 as PitScoutingSchema,
    // Add future years: "2027": schema2027,
  };

  const schema = schemaMap[year];

  if (schema) {
    return schema;
  }

  // Fallback to 2026 if year not found
  console.warn(
    `No pit scouting schema found for year ${year}, using 2026 default`
  );
  return schema2026 as PitScoutingSchema;
}

/**
 * Get display label for a specific field
 *
 * @param schema - Pit scouting schema
 * @param sectionId - Section ID (e.g., "movement", "intake")
 * @param fieldName - Field name (e.g., "depot", "ground")
 * @returns Display label or field name as fallback
 *
 * @example
 * const label = getFieldLabel(schema, "movement", "depot");
 * console.log(label); // "Depot"
 */
export function getFieldLabel(
  schema: PitScoutingSchema,
  sectionId: string,
  fieldName: string
): string {
  const field = findField(schema, sectionId, fieldName);
  return field?.label || fieldName;
}

/**
 * Get all fields for a specific section
 *
 * @param schema - Pit scouting schema
 * @param sectionId - Section ID
 * @returns Array of fields or empty array if section not found
 *
 * @example
 * const fields = getSectionFields(schema, "intake");
 * fields.forEach(field => console.log(field.label));
 */
export function getSectionFields(
  schema: PitScoutingSchema,
  sectionId: string
): SchemaField[] {
  const section = schema.customSections.find((s) => s.id === sectionId);
  return section?.fields || [];
}

/**
 * Get all sections from schema
 *
 * @param schema - Pit scouting schema
 * @returns Array of all sections
 */
export function getAllSections(
  schema: PitScoutingSchema
): SchemaSection[] {
  return schema.customSections;
}

/**
 * Check if a field should be displayed based on conditional rules
 *
 * @param schema - Pit scouting schema
 * @param sectionId - Section ID
 * @param fieldName - Field name
 * @param formData - Current form data (nested object)
 * @returns True if field should be shown, false otherwise
 *
 * @example
 * const formData = { intake: { ground: true } };
 * const show = shouldShowField(schema, "intake", "depot", formData);
 * console.log(show); // true (because ground is true)
 */
export function shouldShowField(
  schema: PitScoutingSchema,
  sectionId: string,
  fieldName: string,
  formData: Record<string, any>
): boolean {
  const field = findField(schema, sectionId, fieldName);

  if (!field) {
    return false; // Field not found = don't show
  }

  return isFieldVisible(field, formData);
}

/**
 * Get visible fields for a section based on current form state
 * Filters out fields that should be hidden due to conditional rules
 *
 * @param schema - Pit scouting schema
 * @param sectionId - Section ID
 * @param formData - Current form data
 * @returns Array of visible fields
 *
 * @example
 * const formData = { climb: { level: "None" } };
 * const visible = getVisibleFields(schema, "climb", formData);
 * // Returns only "level" field, hides "left", "right", "declimb"
 */
export function getVisibleFields(
  schema: PitScoutingSchema,
  sectionId: string,
  formData: Record<string, any>
): SchemaField[] {
  const fields = getSectionFields(schema, sectionId);
  return fields.filter((field) => isFieldVisible(field, formData));
}

/**
 * Validate if form data matches schema structure
 * Checks that all non-optional fields are present
 *
 * @param schema - Pit scouting schema
 * @param formData - Form data to validate
 * @returns Object with isValid flag and array of missing fields
 */
export function validateFormData(
  schema: PitScoutingSchema,
  formData: Record<string, any>
): { isValid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  for (const section of schema.customSections) {
    const sectionData = formData[section.id] || {};

    for (const field of section.fields) {
      // Skip optional fields
      if (field.optional) continue;

      // Skip fields that are hidden due to conditionals
      if (!isFieldVisible(field, formData)) continue;

      // Check if field has a value
      const value = sectionData[field.name];
      if (value === undefined || value === null || value === "") {
        missingFields.push(`${section.id}.${field.name}`);
      }
    }
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}
