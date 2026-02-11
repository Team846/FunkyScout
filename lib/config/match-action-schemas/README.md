# Match Action Schema System

This directory contains year-based configuration files for match scouting actions. Each year can have different actions while maintaining consistent data structure and storage.

## Overview

**Problem:** FRC game changes every year, requiring different match scouting actions and scoring mechanisms.
**Solution:** JSON schema files that define action types and metadata per year.
**Benefit:** Add/remove/modify actions by editing JSON, not TypeScript code.

## Directory Structure

```
lib/config/match-action-schemas/
├── 2026.json           # 2026 Rebuilt match action schema
├── 2027.json           # (Add for next year)
├── actions.types.ts    # TypeScript type definitions
├── index.ts            # Schema loader and helper functions
└── README.md           # This file
```

## Four Action Types

### Type 1: User-Placed Actions (During Match)
**Behavior:** User taps button → taps field to place location
**Examples:** Ground Intake, Passing, Dropped
**Used for:** Actions where location matters and varies (intakes, drops)

```json
{
  "id": "groundIntake",
  "label": "Ground Intake",
  "category": "userPlaced",
  "phase": "both"
}
```

### Type 2: Fixed-Location Actions (During Match)
**Behavior:** User taps button → location automatically assigned from config
**Examples:** Fuel Scored +1/+2/+5/+8, Station Intake, Station Stocked
**Used for:** Repeatable actions at fixed locations (scoring zones)

```json
{
  "id": "fuelScore2",
  "label": "Fuel +2",
  "category": "fixedLocation",
  "location": { "x": 100, "y": 200 },
  "points": 2,
  "phase": "both"
}
```

### Type 3: Toggle Actions (During Match)
**Behavior:** User taps button → toggles state on/off
**Examples:** Defend, Disable, Climb L1/L2/L3
**Used for:** Binary states or one-time events during match

```json
{
  "id": "teleopClimbL2",
  "label": "Climb L2",
  "category": "toggle",
  "location": { "x": 0, "y": 300 },
  "points": 6,
  "phase": "teleop"
}
```

### Type 4: Post-Match Clarifications (After Match)
**Behavior:** Selected in match summary page after match ends
**Examples:** Trough (crossed?), Bump (bumped?), Climb Orientation, Performance Ratings
**Used for:** Observations that are easier to answer after the match

```json
{
  "id": "trough",
  "label": "Trough",
  "category": "postMatch",
  "phase": "postMatch"
}
```

## Coordinate System

**Normalized coordinates (0.0 to 1.0) - Device Independent:**

All coordinates are stored as normalized values where:
- `(0, 0)` = top-left corner of field
- `(1, 1)` = bottom-right corner of field
- `(0.5, 0.5)` = center of field

**Why normalized?**
- Works across all device screen sizes
- Consistent with existing auto path drawer system
- Supabase stores standardized values for cross-device playback
- Analytics and calculations work on uniform coordinate space

**Conversion functions:**
```typescript
// Convert screen click to normalized coordinates (0-1)
function screenToNormalized(clientX: number, clientY: number, rect: DOMRect) {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
}

// Convert normalized back to screen pixels for display
function normalizedToScreen(x: number, y: number, width: number, height: number) {
  return {
    x: x * width,
    y: y * height,
  };
}
```

### Finding Coordinates for Fixed Locations

**Method: Coordinate picker tool (recommended)**

Add this temporary code to `match_start.tsx` during development:

```typescript
onClick={(e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width).toFixed(2);
  const y = ((e.clientY - rect.top) / rect.height).toFixed(2);
  console.log(`{ "x": ${x}, "y": ${y} },  // ${actionName}`);
  // Copy-paste directly into 2026.json
}}
```

**Example output (normalized 0-1):**
```
{ "x": 0.35, "y": 0.65 },  // Fuel scoring zone (center-right)
{ "x": 0.10, "y": 0.30 },  // Station intake (left side)
{ "x": 0.50, "y": 0.90 },  // Climb location (bottom center)
```

**Quick reference for common positions:**
- Top-left: `(0.0, 0.0)`
- Top-right: `(1.0, 0.0)`
- Center: `(0.5, 0.5)`
- Bottom-left: `(0.0, 1.0)`
- Bottom-right: `(1.0, 1.0)`

## Schema Format

### Complete Structure

```json
{
  "year": 2026,
  "game": "Rebuilt",
  "actions": [
    {
      "id": "string",           // Unique identifier (camelCase)
      "label": "string",        // Display name (Title Case)
      "category": "string",     // "userPlaced" | "fixedLocation" | "toggle" | "postMatch"
      "location": { "x": 0, "y": 0 },  // Optional: for fixedLocation and toggle
      "points": 0,              // Optional: scoring value
      "phase": "string"         // "auto" | "teleop" | "both" | "postMatch"
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (e.g., `"fuelScore2"`, `"groundIntake"`) |
| `label` | string | Yes | Display name shown to users (e.g., `"Fuel +2"`, `"Ground Intake"`) |
| `category` | string | Yes | Action type: `"userPlaced"`, `"fixedLocation"`, `"toggle"`, `"postMatch"` |
| `location` | object | No | Normalized coordinates `{ x: 0-1, y: 0-1 }` for fixedLocation and toggle actions |
| `points` | number | No | Scoring value (e.g., `2` for Fuel +2, `6` for Climb L2) |
| `phase` | string | No | Game phase: `"auto"`, `"teleop"`, `"both"`, or `"postMatch"` |

## Data Structure

### MatchDataRaw (Stored in event_match_data.data_raw)

```typescript
interface MatchDataRaw {
  gameYear: number;                           // 2026
  epochTime: number;                          // Unix timestamp ms
  startPosition?: { x: number; y: number };   // From match_start.tsx (normalized 0-1)
  endPosition?: { x: number; y: number };     // From match_end.tsx (normalized 0-1)
  autoActions: MatchAction[];                 // Auto phase (0-20s)
  teleopActions: MatchAction[];               // Teleop phase (20-160s)
  postMatch?: PostMatchData;                  // Post-match clarifications
  driverRating?: number;                      // 1-5 scale
  notes?: string;                             // Scouter notes
}
```

### MatchAction (Individual action during match)

```typescript
interface MatchAction {
  actionId: string;                   // References action ID from schema
  timestamp: number;                  // Milliseconds since match start
  location?: { x: number; y: number }; // Normalized 0-1 (user-placed OR from schema)
  enabled?: boolean;                  // Only for toggle actions
}
```

### PostMatchData (Post-match clarifications)

```typescript
interface PostMatchData {
  trough?: boolean;
  bump?: boolean;
  climbOrientation?: "left" | "right" | "center";
  ratings?: {
    groundIntake?: number;      // 1-5
    stationIntake?: number;     // 1-5
    stationStocking?: number;   // 1-5
    passing?: number;           // 1-5
  };
}
```

## Usage Examples

### Load Schema for an Event

```typescript
import { getMatchActionSchema } from "@lib/config/match-action-schemas";

const eventKey = "2026caav";
const schema = getMatchActionSchema(eventKey);

console.log(schema.year);  // 2026
console.log(schema.game);  // "Rebuilt"
console.log(schema.actions.length);  // 25
```

### Get Action by ID

```typescript
import { getActionById } from "@lib/config/match-action-schemas";

const action = getActionById(schema, "fuelScore2");
console.log(action?.label);      // "Fuel +2"
console.log(action?.points);     // 2
console.log(action?.location);   // { x: 100, y: 200 }
```

### Get Actions by Phase

```typescript
import { getActionsByPhase } from "@lib/config/match-action-schemas";

const autoActions = getActionsByPhase(schema, "auto");
// Returns actions with phase "auto" or "both"

const teleopActions = getActionsByPhase(schema, "teleop");
// Returns actions with phase "teleop" or "both"
```

### Get Actions by Category

```typescript
import { getActionsByCategory } from "@lib/config/match-action-schemas";

const userPlaced = getActionsByCategory(schema, "userPlaced");
// ["groundIntake", "passing", "dropped"]

const fixedLocation = getActionsByCategory(schema, "fixedLocation");
// ["fuelScore1", "fuelScore2", "fuelScore5", "fuelScore8", "stationIntake", "stationStocked"]
```

### Get Post-Match Actions

```typescript
import { getPostMatchActions } from "@lib/config/match-action-schemas";

const postMatch = getPostMatchActions(schema);
// ["trough", "bump", "climbOrientation", "ratingGroundIntake", ...]
```

### Get Scoring Actions

```typescript
import { getScoringActions } from "@lib/config/match-action-schemas";

const scoring = getScoringActions(schema);
// All actions with points > 0
```

## Implementation Guide (Phase 2)

### Recording Actions in match_play.tsx

```typescript
import { getMatchActionSchema, getActionById } from "@lib/config/match-action-schemas";
import type { MatchAction } from "@lib/config/match-action-schemas";

const schema = getMatchActionSchema(eventKey);
const [autoActions, setAutoActions] = useState<MatchAction[]>([]);
const [teleopActions, setTeleopActions] = useState<MatchAction[]>([]);

// Type 1: User-placed action
function handleUserPlacedAction(actionId: string, clientX: number, clientY: number, rect: DOMRect) {
  const action: MatchAction = {
    actionId,
    timestamp: Date.now() - matchStartTime,
    location: {
      x: (clientX - rect.left) / rect.width,   // Normalize to 0-1
      y: (clientY - rect.top) / rect.height,   // Normalize to 0-1
    }
  };

  if (isAuto) {
    setAutoActions([...autoActions, action]);
  } else {
    setTeleopActions([...teleopActions, action]);
  }
}

// Type 2: Fixed-location action
function handleFixedLocationAction(actionId: string) {
  const actionDef = getActionById(schema, actionId);
  if (!actionDef) return;

  const action: MatchAction = {
    actionId,
    timestamp: Date.now() - matchStartTime,
    location: actionDef.location  // From schema
  };

  if (isAuto) {
    setAutoActions([...autoActions, action]);
  } else {
    setTeleopActions([...teleopActions, action]);
  }
}

// Type 3: Toggle action
function handleToggleAction(actionId: string, enabled: boolean) {
  const actionDef = getActionById(schema, actionId);
  if (!actionDef) return;

  const action: MatchAction = {
    actionId,
    timestamp: Date.now() - matchStartTime,
    location: actionDef.location,
    enabled
  };

  if (isAuto) {
    setAutoActions([...autoActions, action]);
  } else {
    setTeleopActions([...teleopActions, action]);
  }
}
```

### Saving Match Data in match_end.tsx

```typescript
import { putMatchData } from "@lib/data/writes";
import type { MatchDataRaw } from "@lib/config/match-action-schemas";

// Convert screen coordinates to normalized before saving
const rect = fieldElement.getBoundingClientRect();
const normalizedStart = startPos ? {
  x: startPos.x / rect.width,
  y: startPos.y / rect.height
} : undefined;

const normalizedEnd = endPos ? {
  x: endPos.x / rect.width,
  y: endPos.y / rect.height
} : undefined;

const dataRaw: MatchDataRaw = {
  gameYear: 2026,
  epochTime: Date.now(),
  startPosition: normalizedStart,
  endPosition: normalizedEnd,
  autoActions: autoActions,
  teleopActions: teleopActions,
  // postMatch, driverRating, notes added later in match summary page
};

await putMatchData(
  eventKey,
  matchNum,
  teamNum,
  dataRaw,
  uid,
  alliance
);
```

## Adding a New Year

When a new FRC game is released, follow these steps:

### Step 1: Copy Previous Year's Schema

```bash
cd lib/config/match-action-schemas
cp 2026.json 2027.json
```

### Step 2: Update Year and Game Name

```json
{
  "year": 2027,
  "game": "GameName2027",
  "actions": [ ... ]
}
```

### Step 3: Modify Actions

**Add new actions:**
```json
{
  "id": "newAction",
  "label": "New Action",
  "category": "fixedLocation",
  "location": { "x": 250, "y": 300 },
  "points": 5,
  "phase": "teleop"
}
```

**Remove obsolete actions:**
Delete entire action objects that are no longer relevant.

**Update existing actions:**
Change labels, points, locations, or phases as needed.

### Step 4: Update Field Coordinates

Use the coordinate picker tool (see "Finding Coordinates" section above) to get accurate pixel coordinates for all `fixedLocation` and `toggle` actions.

### Step 5: Register Schema in Loader

Edit `index.ts`:

```typescript
import schema2027 from "./2027.json";

const schemaMap: Record<number, MatchActionSchema> = {
  2026: schema2026 as MatchActionSchema,
  2027: schema2027 as MatchActionSchema,  // Add this line
};
```

### Step 6: Test the Schema

```typescript
import { getMatchActionSchema } from "@lib/config";

const schema = getMatchActionSchema("2027caav");
console.log(schema.game);  // Should print "GameName2027"
console.log(schema.actions.length);
```

## Calculations & Metrics (Phase 3)

With this structured data, metric calculations become straightforward:

### Total Points Scored

```typescript
import { getActionById } from "@lib/config/match-action-schemas";

function calculatePoints(dataRaw: MatchDataRaw, eventKey: string): number {
  const schema = getMatchActionSchema(eventKey);
  let total = 0;

  for (const action of [...dataRaw.autoActions, ...dataRaw.teleopActions]) {
    const def = getActionById(schema, action.actionId);
    if (def?.points) {
      total += def.points;
    }
  }

  return total;
}
```

### Cycle Time

```typescript
function calculateCycleTime(dataRaw: MatchDataRaw): number {
  const intakeActions = dataRaw.teleopActions.filter(
    a => a.actionId === "groundIntake" || a.actionId === "stationIntake"
  );

  const scoreActions = dataRaw.teleopActions.filter(
    a => a.actionId.startsWith("fuelScore")
  );

  // Calculate time between intake and score pairs
  // Return average cycle time in seconds
}
```

### Dropped Pieces (Accuracy)

```typescript
function getDroppedCount(dataRaw: MatchDataRaw): number {
  return dataRaw.teleopActions.filter(a => a.actionId === "dropped").length;
}
```

### Performance Rating vs Pit Scouting

```typescript
function compareWithPitScouting(
  matchData: MatchDataRaw,
  pitData: PitScoutingData
): Comparison {
  return {
    groundIntake: {
      expected: pitData.intake.ground,
      actual: matchData.postMatch?.ratings?.groundIntake
    },
    passing: {
      expected: pitData.fuel.passing,
      actual: matchData.postMatch?.ratings?.passing
    }
  };
}
```

## Best Practices

### Naming Conventions
- **Action IDs:** camelCase (e.g., `"fuelScore2"`, `"groundIntake"`)
- **Labels:** Title Case with spaces (e.g., `"Fuel +2"`, `"Ground Intake"`)
- **Category values:** lowercase (e.g., `"userPlaced"`, `"fixedLocation"`)

### Action Design
- Use descriptive IDs that explain the action
- Include point values for all scoring actions
- Set accurate coordinates for fixed locations using the picker tool
- Mark actions that work in both phases as `"phase": "both"`
- Group related actions with consistent naming (e.g., all fuel scores start with "fuelScore")

### Schema Maintenance
- Comment out actions instead of deleting them (for historical data compatibility)
- Document coordinate changes in git commits
- Test schema loading before deploying to production
- Keep placeholder coordinates (0, 0) until you determine actual field positions

## Troubleshooting

### Schema Not Loading

```typescript
// Error: Cannot find schema for year 2027
```

**Solution:** Add the year to `schemaMap` in `index.ts`.

### Wrong Coordinates

```typescript
// Action appears in wrong location on field
```

**Solution:** Use the coordinate picker tool to find correct pixel coordinates. Field dimensions may change between devices/screen sizes - test on target device.

### TypeScript Errors

```typescript
// Type error when importing JSON
```

**Solution:** Ensure `resolveJsonModule: true` is set in `tsconfig.json`.

## Future Enhancements

Potential improvements for Phase 3+:
- **Visual Schema Editor:** Web UI to create/edit schemas without JSON editing
- **Coordinate visualizer:** Overlay action locations on field image
- **Schema validation:** Type-check schemas at build time
- **Action templates:** Reusable action patterns across years
- **Advanced metrics:** Auto-calculated EPA, defense ratings, consistency scores

## Support

Questions? Check these resources:
- **Type Definitions:** `actions.types.ts` - Full TypeScript API
- **Schema Loader:** `index.ts` - Helper functions
- **Example Schema:** `2026.json` - Reference implementation
- **Plan File:** `/Users/mihirshankar/.claude/plans/zippy-puzzling-boot.md`

---

**Last Updated:** February 2026
**Game Year:** 2026 Rebuilt
**Maintainer:** FunkyScout Team
