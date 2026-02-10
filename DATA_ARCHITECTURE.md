# FunkyScout Data Architecture

Complete documentation of all data flows, sync mechanisms, and offline-first architecture.

---

## Table of Contents

1. [Overview](#overview)
2. [Data Flow Architecture](#data-flow-architecture)
3. [Database Schemas](#database-schemas)
4. [Sync Mechanisms](#sync-mechanisms)
5. [Data Merge Logic](#data-merge-logic)
6. [Offline-First Pattern](#offline-first-pattern)
7. [Realtime Subscriptions](#realtime-subscriptions)
8. [Role-Based Permissions](#role-based-permissions)
9. [API Usage & Optimization](#api-usage--optimization)

---

## Overview

FunkyScout uses a **hybrid offline-first architecture** with three primary data sources:

1. **The Blue Alliance (TBA)** - Match schedules, rankings, scores
2. **Statbotics** - EPA, OPR, match predictions
3. **Supabase (PostgreSQL)** - User-generated data (pit scouting, match scouting, picklists)

Data flows through:
- **Desktop App (Rust/Tauri)**: Fetches TBA/Statbotics → Writes to local SQLite + Supabase
- **Mobile App (React/TypeScript)**: User input → Local SQLite → Supabase (when online)
- **Supabase**: Central truth for all user data, realtime sync between devices

---

## Data Flow Architecture

### Desktop → Supabase (TBA Stats)
```
TBA API + Statbotics API (every 30s)
    ↓
Desktop Rust Backend
    ↓
Local SQLite Cache (for offline) ← MERGE LOGIC APPLIED
    ↓
Supabase (PostgreSQL)
    ↓
Realtime broadcast to all connected devices
```

### Mobile → Supabase (User Data)
```
User Input (pit/match scouting, picklists)
    ↓
Local SQLite (optimistic write)
    ↓
Sync Queue (background + instant)  ← MERGE LOGIC APPLIED
    ↓
Supabase (PostgreSQL)
    ↓
Realtime broadcast to all connected devices
```

### Supabase → Mobile (Realtime)
```
Supabase Realtime Subscriptions
    ↓
Debounced refresh (2s delay)
    ↓
Fetch from Supabase
    ↓
Update Local SQLite Cache
    ↓
Refresh UI
```

---

## Database Schemas

### Supabase (PostgreSQL)

#### `event_list`
Tracks available events.
```sql
- event: TEXT PRIMARY KEY
- alias: TEXT
- date: TEXT
- last_modified: TIMESTAMPTZ
```

#### `event_team_data`
**CRITICAL**: Contains BOTH pit scouting data AND TBA stats merged together.
```sql
- event: TEXT
- team: TEXT
- data: JSONB  ← MERGED DATA (see Data Merge Logic)
- team_name: TEXT
- name: TEXT (scouter username)
- uid: TEXT (scouter user ID)
- assigned: BOOLEAN
- timestamp: TIMESTAMPTZ
- last_modified: TIMESTAMPTZ
- deleted_at: TIMESTAMPTZ
PRIMARY KEY (event, team)
```

**Data structure** (merged):
```json
{
  // TBA/Statbotics data (from desktop)
  "rank": 5,
  "record": { "wins": 8, "losses": 2, "ties": 0 },
  "next_match": "2024casd_qm15",
  "last_match": "2024casd_qm10",
  "epa": {
    "total_points": { "mean": 45.3, "sd": 5.2 },
    "auto": { "mean": 12.1, "sd": 2.3 },
    "teleop": { "mean": 28.5, "sd": 3.1 },
    "endgame": { "mean": 4.7, "sd": 1.2 },
    "norm": 1.23
  },
  "opr": 45.3,
  "dpr": 12.1,
  "ccwm": 33.2,
  "last_synced": 1234567890,

  // Pit scouting data (from mobile users)
  "depot": "coral_station",
  "movement": { "type": "swerve", "speed": "fast" },
  "intake": { "types": ["floor", "station"], "consistent": true },
  "fuel": { "can_score": true, "accuracy": "high" },
  "climb": { "capable": true, "height": "high", "time": 5 },
  "autos": ["reef_coral_3", "reef_algae_4"],
  "images": {
    "files": [
      { "path": "https://...", "filename": "robot.png", "uploaded": true }
    ]
  }
}
```

#### `event_schedule`
Match schedule with TBA scores and predictions.
```sql
- event: TEXT
- match: TEXT
- team: TEXT
- alliance: TEXT ('red' | 'blue')
- name: TEXT (assigned scouter)
- uid: TEXT (assigned scouter ID)
- est_time: BIGINT (epoch ms)
- red_score: INTEGER
- blue_score: INTEGER
- red_win_prob: FLOAT
- predicted_red_score: FLOAT
- predicted_blue_score: FLOAT
- last_modified: TIMESTAMPTZ
- deleted_at: TIMESTAMPTZ
PRIMARY KEY (event, match, team)
```

#### `event_match_data`
Match scouting submissions.
```sql
- event: TEXT
- match: TEXT
- team: TEXT
- alliance: TEXT
- data_raw: JSONB (scouting form data)
- data: JSONB (unused, kept for compatibility)
- name: TEXT
- uid: TEXT
- timestamp: TIMESTAMPTZ
- last_modified: TIMESTAMPTZ
- deleted_at: TIMESTAMPTZ
PRIMARY KEY (event, match, team, uid, timestamp)
```

#### `event_picklist`
Picklist headers.
```sql
- id: TEXT PRIMARY KEY
- event: TEXT
- title: TEXT
- picklist: JSONB (deprecated, use event_picklist_entries)
- uname: TEXT (creator username)
- uid: TEXT (creator user ID)
- type: pick_type ('public' | 'private' | 'default')
- timestamp: TIMESTAMPTZ
- last_modified: TIMESTAMPTZ
- deleted_at: TIMESTAMPTZ
```

#### `event_picklist_entries`
Picklist team entries (normalized).
```sql
- event: TEXT
- id: TEXT (picklist ID)
- team: TEXT
- rank: INTEGER
- flags: JSONB (optional metadata)
- last_modified: TIMESTAMPTZ
- deleted_at: TIMESTAMPTZ
PRIMARY KEY (event, id, team)
```

#### `user_profiles`
User authentication and roles.
```sql
- uid: TEXT PRIMARY KEY
- username: TEXT
- role: user_role ('user' | 'admin' | 'scouter')
- last_modified: TIMESTAMPTZ
```

### SQLite (Mobile + Desktop)

**Same schema as Supabase** with two key differences:

1. **Timestamps**: Use INTEGER (epoch milliseconds) instead of TIMESTAMPTZ
2. **Conversion**: Always convert when syncing:
   ```typescript
   // Supabase → SQLite
   timestamp: d.timestamp ? new Date(d.timestamp).getTime() : undefined

   // SQLite → Supabase
   timestamp: new Date(timestamp_ms).toISOString()
   ```

---

## Sync Mechanisms

### Desktop Sync (Rust)

**Interval**: Every 30 seconds
**Direction**: TBA/Statbotics → Supabase (downstream only)
**File**: [`apps/desktop/src-tauri/src/services/sync.rs`](apps/desktop/src-tauri/src/services/sync.rs)

**Process**:
1. Fetch team statuses from TBA (1 API call)
2. Fetch EPA from Statbotics (graceful fallback)
3. Fetch OPR from TBA (graceful fallback)
4. Fetch match schedule from TBA
5. Fetch match predictions from Statbotics (graceful fallback)
6. **Apply merge logic** (preserve existing pit scouting data)
7. Write to local SQLite cache
8. Upsert to Supabase

**Bootstrap** (on event selection):
- Fetches full team info (2 TBA API calls)
- Populates event_team_data with team names and initial rankings

### Mobile Sync (TypeScript)

**Interval**: Every 30 seconds (background polling)
**Trigger**: Instant sync on user writes (when online)
**Direction**: Mobile → Supabase (upstream only)
**File**: [`lib/sync/SyncManager.ts`](lib/sync/SyncManager.ts)

**Process**:
1. Check sync queue for pending operations
2. For each queue item:
   - **Apply merge logic** (preserve existing TBA stats)
   - Execute operation (upsert/delete)
   - Remove from queue on success
   - Retry with exponential backoff on failure

**Instant Sync Triggers**:
- User submits pit scouting data
- User submits match scouting data
- User creates/updates/deletes picklist
- User assigns shift
- Device comes back online

**Retry Logic**:
- Max retries: 5
- Backoff: 2s, 4s, 8s, 16s, 32s
- Non-retryable errors removed immediately

---

## Data Merge Logic

### Why Merge?

The `event_team_data.data` field contains **both**:
- **TBA stats** (from desktop, updated every 30s)
- **Pit scouting data** (from mobile users)

Without merge logic, each write would **overwrite** the entire field, losing the other data type.

### Desktop Merge (Rust)

**File**: [`apps/desktop/src-tauri/src/services/supabase.rs:308-379`](apps/desktop/src-tauri/src/services/supabase.rs#L308-L379)

```rust
// 1. Fetch existing data from Supabase
let existing_data = fetch_event_team_data(event).await?;

// 2. Build lookup map
let existing_map: HashMap<String, Value> = /* ... */;

// 3. Merge TBA stats with existing pit data
for new_record in team_data_records {
    if let Some(existing) = existing_map.get(team) {
        // Merge: keep existing pit fields, overwrite with new TBA stats
        merged_data = { ...existing, ...new_tba_stats };
    }
}

// 4. Upsert merged data
upsert_to_supabase(merged_data);
```

### Mobile Merge (TypeScript)

**File**: [`lib/sync/SyncManager.ts:254-313`](lib/sync/SyncManager.ts#L254-L313)

```typescript
// 1. Fetch existing data for the team
const { data: existing } = await supabase
  .from("event_team_data")
  .select("data")
  .eq("event", event)
  .eq("team", team)
  .maybeSingle();

// 2. Merge pit data with existing TBA stats
let mergedData = data;
if (existing?.data) {
  mergedData = {
    ...existing.data, // Preserve TBA stats
    ...data,          // Overwrite with new pit data
  };
}

// 3. Upsert merged data
await supabase.from("event_team_data").upsert({
  event, team, data: mergedData, name, uid
});
```

**Merge Order**:
- Desktop: `{ ...existingPitData, ...newTBAStats }` → TBA stats win
- Mobile: `{ ...existingTBAStats, ...newPitData }` → Pit data wins
- Result: Both coexist, each side updates its own fields

---

## Offline-First Pattern

### Write Flow (Mobile)

All writes follow this pattern:

1. **Optimistic write** to local SQLite (instant)
2. **Queue** operation for background sync
3. **Trigger** instant sync if online
4. **Return** immediately (non-blocking)

**File**: [`lib/data/writes.ts`](lib/data/writes.ts)

Example:
```typescript
export async function putTeamData(...) {
  // 1. Write to local SQLite immediately
  await cacheEventTeamData([teamData]);

  // 2. Queue for background sync
  await addToSyncQueue("PUT_TEAM_DATA", payload);

  // 3. Trigger instant sync if online
  await triggerInstantSync();
}
```

### Read Flow (Mobile)

All reads prioritize local cache:

1. **Check** local SQLite first
2. **Return** cached data if exists
3. **Fetch** from Supabase in background (if online)
4. **Update** cache and UI

**File**: [`lib/data/teams.ts`](lib/data/teams.ts)

### Offline Behavior

**Offline**:
- All writes go to local SQLite
- Queued for sync when online
- Reads from local cache only
- UI shows "Offline" indicator

**Coming Back Online**:
1. Online event detected ([`lib/context/SyncContext.tsx:126-147`](lib/context/SyncContext.tsx#L126-L147))
2. Toast notification: "Back online, syncing data..."
3. Force sync triggered immediately
4. All queued operations processed
5. Data contexts refreshed
6. Toast notification: "Sync complete!"

---

## Realtime Subscriptions

### Mobile Realtime

**File**: [`lib/context/CompetitionDataContext.tsx`](lib/context/CompetitionDataContext.tsx)

**Subscribed Tables**:
- `event_schedule` → Schedule and shift assignments
- `event_picklist` → Picklist headers
- `event_picklist_entries` → Picklist team entries

**Debouncing**:
- 2-second delay prevents rapid successive updates
- Prevents UI glitching from high-frequency changes

```typescript
let scheduleDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedFetchSchedule = () => {
  if (scheduleDebounceTimer) clearTimeout(scheduleDebounceTimer);
  scheduleDebounceTimer = setTimeout(() => {
    fetchSchedule();
  }, 2000);
};

supabase
  .channel(`schedule-${eventKey}`)
  .on('postgres_changes', { table: 'event_schedule' }, debouncedFetchSchedule)
  .subscribe();
```

### Desktop Realtime

**Not implemented** - Desktop uses 30s polling interval for TBA data updates.

---

## Role-Based Permissions

### User Roles

Defined in Supabase enum `user_role`:
- **`user`**: Can view public picklists, cannot edit
- **`scouter`**: Can view/edit public/default picklists, submit scouting data
- **`admin`**: Full access to all picklists and data

### Picklist Types

- **`public`**: Visible to all scouters, editable by creator
- **`private`**: Visible only to creator
- **`default`**: Team-wide default picklist (editable by scouters)

### Permission Logic

**File**: [`lib/utils/permissions.ts`](lib/utils/permissions.ts)

```typescript
export function canViewPicklist(
  role: UserRole,
  picklistType: PicklistType,
  picklistUid?: string,
  currentUid?: string,
): boolean {
  if (role === "admin") return true;
  if (picklistType === "public") return role === "scouter";
  if (picklistType === "default") return role === "scouter";
  if (picklistType === "private") return picklistUid === currentUid;
  return false;
}

export function canEditPicklist(
  role: UserRole,
  picklistType: PicklistType,
  picklistUid?: string,
  currentUid?: string,
): boolean {
  if (role === "admin") return true;
  if (picklistType === "default") return role === "scouter";
  if (picklistType === "public" || picklistType === "private") {
    return picklistUid === currentUid;
  }
  return false;
}
```

---

## API Usage & Optimization

### TBA API Calls

**Desktop Runtime** (every 30s):
1. `GET /event/{eventKey}/teams/statuses` → Rankings only (1 call)
2. `GET /event/{eventKey}/oprs` → OPR/DPR/CCWM (1 call)
3. `GET /event/{eventKey}/matches` → Match schedule (1 call)

**Total: 3 TBA API calls every 30s**

**Desktop Bootstrap** (once on event selection):
1. `GET /event/{eventKey}/teams/simple` → Team list (1 call)
2. `GET /event/{eventKey}/teams/statuses` → Rankings (1 call)

**Total: 2 TBA API calls once**

### Statbotics API Calls

**Desktop Runtime** (every 30s):
1. `GET /event/{eventKey}/team_years` → EPA data (1 call)
2. `GET /event/{eventKey}/matches` → Match predictions (1 call)

**Total: 2 Statbotics API calls every 30s** (with graceful fallback on error)

### Supabase Calls

**Desktop**:
- 1 read per table per sync (for merge logic)
- 1 bulk upsert per table per sync

**Mobile**:
- Optimistic reads from local cache (no Supabase calls)
- Background sync: 1 read + 1 write per queued item
- Realtime: WebSocket connection (not REST calls)

### Optimization Strategies

1. **Use statuses endpoint** instead of full teams endpoint (50% fewer calls)
2. **Bulk upserts** instead of individual writes
3. **Local SQLite cache** to reduce Supabase reads
4. **Graceful fallbacks** for optional data (EPA, OPR, predictions)
5. **Debounced realtime** to prevent excessive refreshes
6. **Merge logic** to preserve data across syncs

---

## Data Lifecycle Summary

### Pit Scouting Flow
1. Scouter opens team on mobile
2. Fills out pit scouting form
3. Submits → Instant write to SQLite
4. Queued for sync → Merges with TBA stats
5. Uploads to Supabase
6. Realtime broadcast to other devices
7. Desktop fetches TBA stats → Merges with pit data (preserves it)

### Match Scouting Flow
1. Scouter assigned to shift
2. Watches match, fills form
3. Submits → SQLite → Sync queue → Supabase
4. Other devices see via realtime updates

### Picklist Flow
1. User creates picklist (public/private/default)
2. Adds teams, ranks, flags
3. SQLite → Sync queue → Supabase
4. Other scouters see public/default picklists via realtime
5. Can reorder, add/remove teams
6. Updates sync in real-time

### Desktop TBA Sync Flow
1. Every 30s: Fetch TBA + Statbotics data
2. Merge with existing Supabase pit data
3. Write to local SQLite + Supabase
4. Mobile devices fetch updates via realtime
5. UI shows latest rankings, EPA, match predictions

---

## Key Files Reference

### Desktop (Rust)
- [`apps/desktop/src-tauri/src/services/sync.rs`](apps/desktop/src-tauri/src/services/sync.rs) - Main sync orchestration
- [`apps/desktop/src-tauri/src/services/supabase.rs`](apps/desktop/src-tauri/src/services/supabase.rs) - Supabase client with merge logic
- [`apps/desktop/src-tauri/src/services/tba.rs`](apps/desktop/src-tauri/src/services/tba.rs) - TBA API client
- [`apps/desktop/src-tauri/src/services/statbotics.rs`](apps/desktop/src-tauri/src/services/statbotics.rs) - Statbotics API client

### Mobile (TypeScript)
- [`lib/sync/SyncManager.ts`](lib/sync/SyncManager.ts) - Mobile sync queue processor
- [`lib/data/writes.ts`](lib/data/writes.ts) - Offline-first write operations
- [`lib/data/teams.ts`](lib/data/teams.ts) - Team data fetching
- [`lib/context/SyncContext.tsx`](lib/context/SyncContext.tsx) - Sync triggers and orchestration
- [`lib/context/CompetitionDataContext.tsx`](lib/context/CompetitionDataContext.tsx) - Realtime subscriptions

### Shared
- [`lib/db/index.ts`](lib/db/index.ts) - SQLite cache layer
- [`lib/utils/permissions.ts`](lib/utils/permissions.ts) - Role-based access control
- [`supabase/migrations/20251229230720_init.sql`](supabase/migrations/20251229230720_init.sql) - Database schema

---

## Troubleshooting

### Data Not Syncing
1. Check if device is online
2. Check sync queue: `SELECT * FROM sync_queue`
3. Check error logs in console
4. Verify Supabase credentials

### Data Overwriting
1. Confirm merge logic is applied in both desktop and mobile
2. Check `event_team_data.data` structure in Supabase
3. Verify timestamps on conflicting writes

### Slow Realtime Updates
1. Check debounce timers (2s default)
2. Verify Supabase realtime connection
3. Check network latency

### Excessive Logging
Logs reduced to errors and important events only. Routine success messages removed.
