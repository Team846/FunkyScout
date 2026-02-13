# FunkyScout Database Architecture

**Last Updated:** 2025-02-13
**Source of Truth:** App code references (Supabase schema matches app, migration files are outdated)

## Core Tables (Both Supabase PostgreSQL and Local SQLite)

### 1. event_list
**Purpose:** Parent table for all event data
**Primary Key:** `event` (TEXT) - Format: "2025cada", "2025flor"
**Columns:**
- `event` - Event code (PK)
- `alias` - Display name
- `date` - Event date
- `last_modified` - Timestamp (Supabase: timestamptz, SQLite: INTEGER ms)
- `deleted_at` - Soft delete timestamp

**Critical:** ALL event-related tables have FK to this table. Must be inserted BEFORE any child records.

---

### 2. event_team_data
**Purpose:** Team information, pit scouting, EPA, OPR from TBA
**Primary Key:** `(event, team)`
**Columns:**
- `event` - FK to event_list(event)
- `team` - Team key (e.g., "frc233")
- `team_name` - Team nickname from TBA (e.g., "Pink Team")
- `data` - JSONB containing:
  - Pit scouting data (when `name` is set)
  - TBA stats: `rank`, `record.wins/losses/ties`, `next_match`, `last_match`
  - `epa` - Statbotics EPA data (total_points, auto, teleop, endgame)
  - `opr`, `dpr`, `ccwm` - TBA calculated stats
  - `last_synced` - Desktop sync timestamp (for mobile detection)
- `name` - Scouter username who submitted pit data (NULL if not scouted)
- `uid` - Scouter user ID
- `assigned` - Boolean (pit scouting assignment)
- `timestamp` - When pit scouting was submitted
- `last_modified` - Last update timestamp
- `deleted_at` - Soft delete

**Scouting Badge Logic:** Show "SCOUTED" badge ONLY if `name` field exists (human pit scouting)

**Data Sources:**
- Desktop Rust sync: TBA rankings + Statbotics EPA + TBA OPR (every 60s)
- Mobile/Desktop: Pit scouting data (user submissions)

---

### 3. event_schedule
**Purpose:** Match schedule with shift assignments and TBA match data
**Primary Key:** `(event, match, team)`
**Columns:**
- `event` - FK to event_list(event)
- `match` - Match key (e.g., "2025cada_qm1", "2025cada_sf1m1")
- `team` - Team key (e.g., "frc233")
- `alliance` - "red" or "blue"
- `name` - Assigned scouter username (shift assignment)
- `uid` - Assigned scouter user ID
- `est_time` - Match estimated start time (Unix timestamp seconds)
- `red_score` - Final red alliance score (NULL if not played)
- `blue_score` - Final blue alliance score (NULL if not played)
- `red_win_prob` - Statbotics prediction (0.0-1.0)
- `predicted_red_score` - Statbotics predicted score
- `predicted_blue_score` - Statbotics predicted score
- `last_modified` - Last update timestamp
- `deleted_at` - Soft delete

**Data Sources:**
- Desktop Rust sync: TBA match schedule + Statbotics predictions (every 60s)
- Mobile/Desktop: Shift assignments (user assignments)

**Note:** Populated from TBA via `refreshSchedule()` during bootstrap, then synced with match data

---

### 4. event_match_data
**Purpose:** Match scouting data (primary scouting records)
**Primary Key:** `(event, match, team)` - One scouting per team per match
**Columns:**
- `event` - FK to event_list(event)
- `match` - Match key
- `team` - Team key
- `alliance` - "red" or "blue" (NOT NULL - required)
- `data_raw` - **PRIMARY DATA** JSONB containing actual match scouting:
  - `gameYear`, `epochTime`
  - `autoActions[]` - Array of auto period actions
  - `teleopActions[]` - Array of teleop actions (includes climb detection)
  - `postMatch.ratings` - `{groundIntake, stationIntake, passing}`
  - `driverRating` - Top-level driver rating (1-5)
  - `notes` - Match notes
- `data` - EMPTY/UNUSED (kept for schema compatibility)
- `name` - Scouter username who submitted
- `uid` - Scouter user ID
- `timestamp` - When scouting was submitted
- `last_modified` - Last update timestamp
- `deleted_at` - Soft delete

**CRITICAL:** Use `data_raw` for all match scouting data, NOT `data` field!

**Climb Detection:** Check `teleopActions[]` for any action with `actionId` containing "climb"

---

### 5. event_picklist
**Purpose:** User-created team ranking lists
**Primary Key:** `id` (UUID)
**Columns:**
- `id` - UUID primary key
- `event` - FK to event_list(event)
- `title` - Picklist name
- `uname` - Creator username
- `uid` - Creator user ID
- `type` - "public", "private", or "shared"
- `timestamp` - Creation time
- `last_modified` - Last update
- `deleted_at` - Soft delete

---

### 6. event_picklist_entries
**Purpose:** Team rankings within picklists
**Primary Key:** `(event, id, team)`
**Columns:**
- `event` - FK to event_list(event)
- `id` - FK to event_picklist(id)
- `team` - Team key
- `rank` - Position in picklist (1, 2, 3...)
- `flags` - JSONB (custom flags/notes)
- `last_modified` - Last update
- `deleted_at` - Soft delete

---

## Data Flow Architecture

### Desktop Sync Service (Rust) - 60 Second Interval

**File:** `apps/desktop/src-tauri/src/services/sync.rs`

```
┌─────────────────────────────────────────────────────────┐
│                  Desktop Sync Cycle                      │
│                    (Every 60s)                           │
└─────────────────────────────────────────────────────────┘
                          │
      ┌───────────────────┼───────────────────┐
      ↓                   ↓                   ↓
   TBA API          Statbotics API      Process Sync Queue
      │                   │                   │
      ├─ Rankings         ├─ EPA (per team)  ├─ Offline writes
      ├─ OPR/DPR         ├─ Match preds     │
      └─ Schedule        └─ Team stats      │
      │                   │                   │
      └───────────────────┴───────────────────┘
                          ↓
              ┌───────────────────────┐
              │  Local SQLite Cache   │
              │  (Offline Support)    │
              └───────────────────────┘
                          ↓
              ┌───────────────────────┐
              │  Supabase PostgreSQL  │
              │  (Source of Truth)    │
              └───────────────────────┘
```

**Critical Steps:**
1. Ensure `event_list` entry exists (INSERT ... ON CONFLICT)
2. Cache teams to SQLite FIRST
3. Then push to Supabase
4. Cache schedule to SQLite
5. Push schedule to Supabase

---

### Mobile Data Flow

**Sync Manager:** 30-second interval (faster than desktop!)
**File:** `lib/sync/SyncManager.ts`

```
Mobile Frontend
      ↓
Local WASM SQLite (OPFS)
      ↓
IndexedDB Sync Queue ←─── Offline writes buffered here
      ↓ (every 30s or instant trigger)
Supabase PostgreSQL
      ↓ (read operations)
Local WASM SQLite (cache)
      ↓
Mobile Frontend
```

**Offline-First Pattern:**
1. All writes go to local SQLite immediately
2. Queued in IndexedDB for sync
3. Background sync pushes to Supabase when online
4. Reads come from local cache with Supabase fallback

---

## Timestamp Strategy

### Supabase (PostgreSQL)
- Type: `timestamp with time zone` (timestamptz)
- Format: ISO 8601 strings ("2025-02-12T15:30:00Z")
- Functions: `now()`, `CURRENT_TIMESTAMP`

### SQLite (Desktop & Mobile)
- Type: `INTEGER` (epoch milliseconds)
- Format: `1739412000000`
- Functions: `strftime('%s','now') * 1000`

### Conversion (Rust sync.rs)
```rust
// SQLite → Supabase
chrono::Utc::now().to_rfc3339()  // → "2025-02-12T15:30:00Z"

// Supabase → SQLite
new Date(d.last_modified).getTime()  // → 1739412000000
```

**CRITICAL:** When caching Supabase data to SQLite, ALWAYS convert timestamps:
```typescript
last_modified: d.last_modified ? new Date(d.last_modified).getTime() : undefined
```

---

## Foreign Key Constraints

### SQLite (Desktop & Mobile)
```sql
FOREIGN KEY (event) REFERENCES event_list(event)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION
```

### Supabase PostgreSQL
```sql
FOREIGN KEY (event) REFERENCES event_list(event)
  ON DELETE CASCADE
```

**Error Code 787:** SQLite foreign key constraint violation
**Error Code 23503:** PostgreSQL foreign key violation

**Prevention:** ALWAYS ensure parent record exists before inserting child:
```rust
// Before inserting event_schedule, event_team_data, etc:
sqlx::query(
    "INSERT INTO event_list (event, alias, date, last_modified)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event) DO UPDATE SET last_modified = excluded.last_modified"
)
```

---

## Sync Queue (Offline Write Queue)

### Desktop (SQLite Table)
**File:** `apps/desktop/src-tauri/src/services/sync.rs`

```sql
CREATE TABLE sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT,           -- "PUT_TEAM_DATA", "CREATE_PICKLIST", etc.
    payload TEXT (JSON),
    created_at INTEGER,
    retries INTEGER DEFAULT 0,
    last_error TEXT,
    last_attempt INTEGER,
    status TEXT CHECK (status IN ('pending', 'processing', 'failed'))
);
```

**Processing:** Every 60s, processes up to 10 pending items
**Retry Logic:** Max 5 retries, exponential backoff

### Mobile (IndexedDB)
**File:** `lib/sync/SyncManager.ts`

- Similar structure stored in IndexedDB (not SQLite)
- 30-second processing interval
- Max 5 retries with exponential backoff

**Supported Operations:**
- `CREATE_PICKLIST`, `UPDATE_PICKLIST`, `DELETE_PICKLIST`
- `PUT_TEAM_DATA`, `PUT_MATCH_DATA`, `DELETE_MATCH_DATA`
- `ASSIGN_SHIFT`

---

## Desktop Detection (Mobile → Desktop Sync Check)

**File:** `lib/context/TeamDataContext.tsx`

**Detection Logic:**
```typescript
const hasRecentDesktopSync = (supabaseTeams ?? []).some((t: any) => {
  const lastSynced = t.data?.last_synced;
  if (lastSynced && typeof lastSynced === 'number') {
    return (now - lastSynced) < 5 * 60 * 1000; // 5 minutes
  }
  return false;
});
```

**Requirement:** Desktop must set `data.last_synced = Date.now()` when syncing team data

**Desktop Implementation (sync.rs line 211):**
```rust
"last_synced": chrono::Utc::now().timestamp_millis()
```

**Fallback Behavior:**
- If desktop not detected: Mobile uses TBA-only data (stale EPA/OPR)
- If desktop active: Mobile uses fresh desktop-synced data

---

## Critical Timing Intervals

| Component | Interval | File | Notes |
|-----------|----------|------|-------|
| Desktop Rust Sync | 60 seconds | sync.rs:41 | Periodic + instant trigger on writes |
| Mobile SyncManager | 30 seconds | SyncManager.ts:40 | Faster than desktop! |
| Mobile Polling (Base) | 120 seconds | fetchUtils.ts:14 | With exponential backoff to 300s |
| Mobile Polling (Live) | 15 seconds | fetchUtils.ts:19 | For active event screens |
| Desktop Detection | 5 minutes | TeamDataContext.tsx:145 | last_synced threshold |

**CONCERN:** Mobile syncs every 30s but desktop every 60s - could cause brief staleness

---

## Common Error Patterns & Fixes

### 1. Foreign Key Constraint (Error 787/23503)
**Cause:** Child record inserted before parent exists
**Fix:** Always ensure event_list entry exists first (see cache_schedule.rs:246-257)

### 2. "Desktop not detected" Warning
**Cause:** Desktop sync hasn't run in >5 minutes OR last_synced not set
**Fix:** Verify desktop API keys configured, check sync service is running

### 3. Alliance NULL Constraint
**Cause:** event_match_data requires alliance field
**Fix:** Always pass alliance when upserting match data (fixed in syncShiftAssignments)

### 4. team_name Shows NULL
**Cause:** team_name not synced from TBA after bootstrap
**Fix:** Call syncTeamNames() after bootstrap or during periodic sync

### 5. Match Scouting Data Empty
**Cause:** Reading from `data` field instead of `data_raw`
**Fix:** Always use `matchData.data_raw` for scouting data

---

## Key Functions Reference

### Bootstrap New Event
```typescript
// Frontend (lib/data/events.ts)
await bootstrapEvent(eventKey);  // Creates event, teams, schedule, match data placeholders
await syncTeamNames(eventKey);   // Syncs team names from TBA
```

### Desktop Sync Cycle
```rust
// Rust (sync.rs)
sync_service.sync_once().await;  // TBA + Statbotics → SQLite → Supabase
```

### Mobile Data Fetch
```typescript
// Frontend (lib/data/teams.ts, match-data.ts)
const teams = await getTeams(eventKey);        // Supabase → cache → return
const matches = await getMatchData(eventKey);  // Supabase → cache → return
```

### Offline Write
```typescript
// Frontend writes (mobile or desktop)
await putTeamData(event, team, data);  // Local → queue → Supabase (when online)
```

---

## Schema Consistency Checklist

✅ **All Supabase `.from()` calls use:** event_list, event_team_data, event_schedule, event_match_data, event_picklist, event_picklist_entries
✅ **All SQLite tables match Supabase** (except timestamp types)
✅ **Foreign keys properly handled** (event_list inserted before children)
✅ **Timestamps converted** when caching Supabase → SQLite
✅ **Primary keys consistent** across all references
✅ **Sync timings documented** (desktop 60s, mobile 30s)
✅ **data_raw used for match scouting** (not data field)

---

## Future Improvements

1. **Align sync intervals:** Consider matching desktop and mobile to 30s or 60s
2. **Add sync health monitoring:** Dashboard showing last sync time, queue status
3. **Optimize Statbotics calls:** Batch EPA requests instead of one per team (50+ API calls!)
4. **Add retry backoff:** Exponential backoff for failed Supabase writes
5. **Schema versioning:** Track schema version to detect mismatches
