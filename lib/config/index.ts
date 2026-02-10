/**
 * Configuration module exports
 *
 * Provides year-based pit scouting schemas and utilities.
 */

// Export all utilities from schema loader
export {
  getYearFromEvent,
  getPitScoutingSchema,
  getFieldLabel,
  getSectionFields,
  getAllSections,
  shouldShowField,
  getVisibleFields,
  validateFormData,
} from "./getYearSchema";

// Export all types from schema types
export type {
  FieldType,
  ConditionalRule,
  SchemaField,
  SchemaSection,
  FixedSections,
  PitScoutingSchema,
  ExtractFieldNames,
} from "./pit-scouting-schemas/schema.types";

// Export type-level utilities
export { findField, isFieldVisible } from "./pit-scouting-schemas/schema.types";
