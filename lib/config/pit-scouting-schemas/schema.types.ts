/**
 * Type definitions for pit scouting form schemas
 *
 * These types define the structure for year-based pit scouting configurations.
 * Each year can have different fields while maintaining consistent data structure.
 */

/**
 * Field types supported in pit scouting forms
 * - boolean: Toggle/checkbox (e.g., "Can climb?")
 * - text: Text input (e.g., "Balls per second")
 * - select: Dropdown/radio group (e.g., "Climb level: L1, L2, L3")
 */
export type FieldType = "boolean" | "text" | "select";

/**
 * Conditional rule for showing/hiding fields based on other field values
 *
 * Examples:
 * - Show "depot intake" only if "ground intake" is true
 * - Show climb side options only if climb level is NOT "None"
 */
export interface ConditionalRule {
  /** Field path to check (e.g., "intake.ground", "climb.level") */
  field: string;
  /** Show this field if the referenced field equals this value */
  equals?: boolean | string | number;
  /** Show this field if the referenced field does NOT equal this value */
  notEquals?: boolean | string | number;
}

/**
 * Individual field definition in a pit scouting form
 */
export interface SchemaField {
  /** Internal field name (e.g., "depot", "shootMoving") */
  name: string;
  /** Display label shown to users (e.g., "Depot", "Shoot as moving") */
  label: string;
  /** Field type (toggle, text input, or dropdown) */
  type: FieldType;
  /** Optional: field is not required for form submission */
  optional?: boolean;
  /** Options for select fields (e.g., ["L1", "L2", "L3", "None"]) */
  options?: string[];
  /** Conditional visibility rules */
  conditional?: ConditionalRule;
  /** Info tooltip text (optional) */
  info?: string;
}

/**
 * A section of the pit scouting form (e.g., "Movement", "Intake", "Fuel")
 */
export interface SchemaSection {
  /** Internal section ID (e.g., "movement", "intake") */
  id: string;
  /** Display title shown to users (e.g., "Movement", "Intake") */
  title: string;
  /** Fields within this section */
  fields: SchemaField[];
}

/**
 * Fixed sections that appear in all years
 * These are managed separately and don't need schema definitions
 */
export interface FixedSections {
  /** Auto routines with path drawings */
  autos: boolean;
  /** Robot images from camera */
  images: boolean;
  /** Overall robot rating (1-5 scale) */
  rating: boolean;
  /** Scouter notes/description */
  description: boolean;
}

/**
 * Complete pit scouting schema for a specific year
 */
export interface PitScoutingSchema {
  /** Year this schema applies to (e.g., 2026) */
  year: number;
  /** Game name for this year (e.g., "Reefscape") */
  game: string;
  /** Fixed sections that always appear */
  fixedSections: FixedSections;
  /** Year-specific custom sections */
  customSections: SchemaSection[];
}

/**
 * Helper type: Extract all field names from a schema
 * Useful for type-safe form data access
 */
export type ExtractFieldNames<T extends SchemaSection[]> = {
  [K in T[number]["id"]]: {
    [F in Extract<T[number], { id: K }>["fields"][number]["name"]]: any;
  };
};

/**
 * Helper function: Get a field by section and name
 */
export function findField(
  schema: PitScoutingSchema,
  sectionId: string,
  fieldName: string
): SchemaField | undefined {
  const section = schema.customSections.find((s) => s.id === sectionId);
  return section?.fields.find((f) => f.name === fieldName);
}

/**
 * Helper function: Check if a field should be visible based on conditionals
 */
export function isFieldVisible(
  field: SchemaField,
  formData: Record<string, any>
): boolean {
  if (!field.conditional) {
    return true; // No conditional = always visible
  }

  const { field: fieldPath, equals, notEquals } = field.conditional;
  const value = getNestedValue(formData, fieldPath);

  if (equals !== undefined) {
    return value === equals;
  }

  if (notEquals !== undefined) {
    return value !== notEquals;
  }

  return true;
}

/**
 * Helper function: Get nested value from object by path
 * Example: getNestedValue({ intake: { ground: true } }, "intake.ground") => true
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}
