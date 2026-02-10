# Pit Scouting Schema System

This directory contains year-based configuration files for pit scouting forms. Each year can have different fields while maintaining consistent data structure and storage.

## Overview

**Problem:** FRC game changes every year, requiring different pit scouting fields.
**Solution:** JSON schema files that define form structure per year.
**Benefit:** Add new fields by editing JSON, not TypeScript code.

## Directory Structure

```
lib/config/pit-scouting-schemas/
├── 2026.json           # 2026 Reefscape pit scouting schema
├── 2027.json           # (Add for next year)
├── schema.types.ts     # TypeScript type definitions
└── README.md           # This file
```

## Schema Format

Each year's schema follows this structure:

```json
{
  "year": 2026,
  "game": "Reefscape",
  "fixedSections": {
    "autos": true,
    "images": true,
    "rating": true,
    "description": true
  },
  "customSections": [
    {
      "id": "movement",
      "title": "Movement",
      "fields": [
        {
          "name": "depot",
          "label": "Depot",
          "type": "boolean",
          "info": "Can the robot traverse through the depot area?"
        }
      ]
    }
  ]
}
```

### Fixed Sections

These sections appear in **every year** and don't need schema definitions:
- **autos**: Auto routines with path drawings
- **images**: Robot photos from camera
- **rating**: Overall robot rating (1-5 scale)
- **description**: Scouter notes/observations

### Custom Sections

Year-specific sections defined in the schema. Each section contains:
- **id**: Internal identifier (e.g., `"movement"`, `"intake"`)
- **title**: Display name shown to users (e.g., `"Movement"`, `"Intake"`)
- **fields**: Array of field definitions

### Field Types

Three field types are supported:

#### 1. Boolean (Toggles)
```json
{
  "name": "depot",
  "label": "Depot",
  "type": "boolean",
  "info": "Optional tooltip text"
}
```
Renders as a toggle button (Yes/No, On/Off).

#### 2. Text (Inputs)
```json
{
  "name": "bps",
  "label": "Balls Per Sec",
  "type": "text",
  "optional": true,
  "info": "Estimated shooting rate"
}
```
Renders as a text input field. Use `optional: true` for non-required fields.

#### 3. Select (Dropdowns/Radio Groups)
```json
{
  "name": "level",
  "label": "Max Level",
  "type": "select",
  "options": ["L1", "L2", "L3", "None"],
  "info": "Maximum climb level"
}
```
Renders as a set of toggle buttons or dropdown.

### Conditional Fields

Fields can be shown/hidden based on other field values using `conditional` rules:

#### Show if another field equals a value:
```json
{
  "name": "depot",
  "label": "Depot",
  "type": "boolean",
  "conditional": {
    "field": "intake.ground",
    "equals": true
  }
}
```
This field only appears when `intake.ground` is `true`.

#### Show if another field does NOT equal a value:
```json
{
  "name": "left",
  "label": "Left",
  "type": "boolean",
  "conditional": {
    "field": "climb.level",
    "notEquals": "None"
  }
}
```
This field only appears when `climb.level` is NOT `"None"`.

## Adding a New Year

When a new FRC game is released, follow these steps:

### Step 1: Copy Previous Year's Schema
```bash
cd lib/config/pit-scouting-schemas
cp 2026.json 2027.json
```

### Step 2: Update Year and Game Name
```json
{
  "year": 2027,
  "game": "GameName2027",
  "fixedSections": { ... },
  "customSections": [ ... ]
}
```

### Step 3: Modify Custom Sections

**Add new sections:**
```json
{
  "id": "new_section",
  "title": "New Section",
  "fields": [
    {
      "name": "new_field",
      "label": "New Field",
      "type": "boolean"
    }
  ]
}
```

**Remove old sections:**
Delete entire section objects that are no longer relevant.

**Modify existing sections:**
Add, remove, or update fields within sections.

### Step 4: Register Schema in Loader
Edit `lib/config/getYearSchema.ts`:

```typescript
import schema2027 from "./pit-scouting-schemas/2027.json";

const schemaMap: Record<string, PitScoutingSchema> = {
  "2026": schema2026 as PitScoutingSchema,
  "2027": schema2027 as PitScoutingSchema, // Add this line
};
```

### Step 5: Test the Schema
```typescript
import { getPitScoutingSchema } from "@lib/config";

const schema = await getPitScoutingSchema("2027caav");
console.log(schema.game); // Should print "GameName2027"
```

## Usage Examples

### Load Schema for an Event
```typescript
import { getPitScoutingSchema } from "@lib/config";

const eventKey = "2026caav";
const schema = await getPitScoutingSchema(eventKey);

console.log(schema.year);  // 2026
console.log(schema.game);  // "Reefscape"
```

### Get Field Label
```typescript
import { getFieldLabel } from "@lib/config";

const label = getFieldLabel(schema, "movement", "depot");
console.log(label); // "Depot"
```

### Check Field Visibility
```typescript
import { shouldShowField } from "@lib/config";

const formData = {
  intake: { ground: true },
};

const isVisible = shouldShowField(schema, "intake", "depot", formData);
console.log(isVisible); // true (because ground is true)
```

### Get Visible Fields for a Section
```typescript
import { getVisibleFields } from "@lib/config";

const formData = {
  climb: { level: "None" },
};

const fields = getVisibleFields(schema, "climb", formData);
// Returns only "level" field, hides "left", "right", "declimb"
```

### Validate Form Data
```typescript
import { validateFormData } from "@lib/config";

const formData = {
  movement: { depot: true },
  intake: { ground: false },
  // Missing fuel and climb sections...
};

const result = validateFormData(schema, formData);
if (!result.isValid) {
  console.error("Missing fields:", result.missingFields);
  // ["fuel.shootMoving", "fuel.passing", "climb.level"]
}
```

## Migration Guide (Phase 2)

**Current Status:** Schema system is implemented but NOT yet used by the UI.
**Phase 1 (Done):** Schema files and utilities exist alongside current hardcoded forms.
**Phase 2 (Future):** Migrate UI to use schemas dynamically.

### When to Migrate

Consider migrating when:
- A new FRC season starts (2027 kickoff)
- You need to add/remove many fields
- Multiple events need different forms
- Non-developers need to modify forms

### Migration Steps

1. **Create Dynamic Form Renderer**
   - Build `DynamicPitScoutForm.tsx` component
   - Load schema via `getPitScoutingSchema()`
   - Render sections and fields from schema
   - Handle conditional field visibility

2. **Create Dynamic Display Component**
   - Build `DynamicPitScoutDisplay.tsx` component
   - Load schema for the event
   - Render pit data based on schema structure

3. **Update Existing Pages**
   - Replace hardcoded form in `apps/mobile/src/routes/pitscout.tsx`
   - Replace hardcoded display in `apps/mobile/src/routes/team-info.tsx`

4. **Test Thoroughly**
   - Verify all field types render correctly
   - Test conditional field visibility
   - Ensure offline sync still works
   - Verify backward compatibility with existing data

5. **Deprecate Old Code**
   - Remove hardcoded field definitions
   - Keep TypeScript interfaces for type safety

## Best Practices

### Naming Conventions
- **Section IDs:** lowercase, underscores (e.g., `"movement"`, `"fuel_system"`)
- **Field names:** camelCase (e.g., `"shootMoving"`, `"bps"`)
- **Labels:** Title Case with spaces (e.g., `"Shoot as moving"`, `"Balls Per Sec"`)

### Field Design
- Keep sections small (3-7 fields per section)
- Use descriptive labels and info tooltips
- Group related fields in the same section
- Use conditionals to reduce clutter
- Mark non-critical fields as optional

### Testing New Schemas
Before deploying a new year's schema:
1. Load it using `getPitScoutingSchema()`
2. Verify all sections and fields parse correctly
3. Test conditional logic with sample form data
4. Check that validation catches missing required fields
5. Ensure JSON syntax is valid (use a linter)

## Troubleshooting

### Schema Not Loading
```typescript
// Error: No schema found for year 2027
```
**Solution:** Add the year to `schemaMap` in `getYearSchema.ts`.

### Conditional Field Not Showing
```typescript
// Field "depot" should show when "ground" is true, but doesn't
```
**Solution:** Check that the field path in `conditional.field` matches the form data structure exactly (e.g., `"intake.ground"` not just `"ground"`).

### TypeScript Errors
```typescript
// Type error when importing JSON
```
**Solution:** Ensure `resolveJsonModule: true` is set in `tsconfig.json`.

### Missing Field Labels
```typescript
// Field renders as "shootMoving" instead of "Shoot as moving"
```
**Solution:** Check that the `label` property is set in the schema. If missing, the field `name` is used as fallback.

## Future Enhancements

Potential improvements for Phase 3+:
- **Visual Schema Editor:** Web UI to create/edit schemas without JSON
- **Schema Validation:** Enforce schema structure at build time
- **Multi-Language Support:** Translate labels based on user locale
- **Field Dependencies:** More complex conditional logic (AND/OR rules)
- **Custom Field Types:** Sliders, date pickers, multi-select, etc.
- **Schema Versioning:** Track changes over time for auditing

## Support

Questions? Check these resources:
- **Type Definitions:** `schema.types.ts` - Full TypeScript API
- **Schema Loader:** `getYearSchema.ts` - Helper functions
- **Example Schema:** `2026.json` - Reference implementation
- **Project Memory:** `/Users/mihirshankar/.claude/projects/-Users-mihirshankar-strata/memory/MEMORY.md`

---

**Last Updated:** February 2026
**Maintainer:** FunkyScout Team
