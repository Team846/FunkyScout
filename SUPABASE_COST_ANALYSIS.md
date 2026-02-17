# Supabase Cost Analysis - Mobile & Desktop Data Polling/Writing

**Generated**: 2026-02-16
**Purpose**: Analyze all Supabase operations and costs for development vs production environments

---

## Executive Summary

### Mobile App (React Native)
- **Read Operations**: 2 min (dev) / 4 min (prod) polling across 5 tables
- **Write Operations**: 30-second sync queue processing
- **Architecture**: Polling-based with local cache + IndexedDB queue

### Desktop App (Tauri Rust)
- **Read Operations**: 60-second polling across 5 tables + external APIs
- **Write Operations**: Instant sync on write + 60s queue processing
- **Architecture**: Background Rust service + optimistic local cache

---

## Mobile Polling Operations

### 1. Team Data Context
**File**: `lib/context/TeamDataContext.tsx`
**Interval**: `LIVE_POLLING_CONFIG` (2 min dev / 4 min prod)
**Supabase Tables**:
- `event_team_data` (SELECT * WHERE event = ? AND deleted_at IS NULL)

**TBA API Calls** (cached 2 minutes in-memory):
- `/event/{event}/teams/statuses` (rankings, wins, losses)

**Per Hour**:
- **Dev**: 30 Supabase reads + 30 TBA calls
- **Prod**: 15 Supabase reads + 30 TBA calls (TBA still cached at 2min)

---

### 2. Competition Data Context
**File**: `lib/context/CompetitionDataContext.tsx`
**Interval**: `LIVE_POLLING_CONFIG` (2 min dev / 4 min prod)

**4 Polling Controllers**:

#### 2a. Schedule Polling
- `event_schedule` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- **Per Hour**: 30 reads (dev) / 15 reads (prod)

#### 2b. Picklist Polling
- `event_picklist` (SELECT * WHERE event = ? AND deleted_at IS NULL ORDER BY timestamp DESC)
- `event_picklist_entries` (SELECT * WHERE event = ? AND deleted_at IS NULL ORDER BY rank ASC)
- **Per Hour**: 60 reads (dev) / 30 reads (prod)

#### 2c. Match Data Polling
- `event_match_data` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- **Per Hour**: 30 reads (dev) / 15 reads (prod)

#### 2d. Nexus Polling
**External API** (Nexus live match data)
- **Per Hour**: 30 calls (dev) / 15 calls (prod)
- **No Supabase cost**

---

### 3. Analytics Data Context
**File**: `lib/context/AnalyticsDataContext.tsx`
**Interval**: `DEFAULT_POLLING_CONFIG` (2 min always)

**Statbotics API Calls** (no Supabase):
- `/api/v3/team_year/{team}/{year}` (EPA data)
- `/api/v3/event/{event}/matches` (predictions)

**Per Hour**: 30 external API calls, **0 Supabase reads**

---

### Mobile Read Operations Summary

| Context | Tables | Dev (2min) | Prod (4min) |
|---------|--------|------------|-------------|
| TeamData | event_team_data | 30/hr | 15/hr |
| Schedule | event_schedule | 30/hr | 15/hr |
| Picklists | event_picklist + entries | 60/hr | 30/hr |
| Match Data | event_match_data | 30/hr | 15/hr |
| **TOTAL** | **4 tables** | **150 reads/hr** | **75 reads/hr** |

**Per Active User Per Day**:
- **Dev**: 150 reads/hr × 8 hours = **1,200 reads/day**
- **Prod**: 75 reads/hr × 12 hours = **900 reads/day**

---

## Mobile Write Operations

### Sync Manager
**File**: `lib/sync/SyncManager.ts`
**Interval**: 30 seconds
**Tables Written**:
- `event_picklist` (CREATE/UPDATE/DELETE)
- `event_picklist_entries` (BULK UPSERT)
- `event_match_data` (INSERT/UPDATE + soft DELETE)
- `event_team_data` (UPDATE for pit scouting)
- `event_schedule` (UPDATE for shift assignments)
- `user_profiles` (UPDATE for scouter ratings)

**Write Frequency**:
- Queue polls every 30s
- Only writes when queue has pending operations
- Typical match scouting: 1 write every 5-10 minutes per active scouter

**Estimated Per Active Scouter Per Competition Day** (8-10 hours):
- Match scouting: ~40 matches × 1 write = **40 match_data inserts**
- Picklist edits: ~10 edits × 2 writes (header + entries) = **20 picklist writes**
- Shift assignments: ~5 changes = **5 schedule updates**
- Pit scouting: ~5 teams = **5 team_data updates**
- **Total**: ~70 writes/day per active scouter

---

## Desktop Polling Operations

### Background Sync Service
**File**: `apps/desktop/src-tauri/src/services/sync.rs`
**Interval**: 60 seconds (fixed, no dev/prod difference)

**Operations Per Cycle**:

#### 1. Process Sync Queue (Writes to Supabase)
- Pushes local writes from queue to Supabase
- Same tables as mobile writes

#### 2. Fetch & Push External APIs → Supabase
**TBA API**:
- `/event/{event}/teams` (team list + rankings)
- `/event/{event}/oprs` (OPR/DPR/CCWM)
- `/event/{event}/matches` (match schedule with scores)

**Statbotics API**:
- `/api/v3/event/{event}/team_years` (batch EPA data)
- `/api/v3/event/{event}/matches` (predictions)

**Pushes to Supabase** (after fetching from external APIs):
- `event_team_data` (BULK UPSERT with TBA rankings + Statbotics EPA)
- `event_schedule` (BULK UPSERT with match times/scores/predictions)

#### 3. Poll User-Generated Data FROM Supabase
**NEW (2026-02-16)**:
- `event_picklist` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- `event_picklist_entries` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- `event_match_data` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- `event_team_data` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- `event_schedule` (SELECT * WHERE event = ? AND deleted_at IS NULL)
- `user_profiles` (SELECT * WHERE deleted_at IS NULL)

---

### Desktop Read/Write Operations Summary

**Per Hour** (60s interval = 60 cycles):
- **Supabase READS**: 60 × 6 tables = **360 reads/hr**
- **Supabase WRITES**: 60 × 2 tables (team_data, schedule) = **120 writes/hr**
- **External API calls**: 60 × 5 endpoints = **300 external calls/hr**

**Per Desktop Instance Per Competition Day** (12 hours):
- **Supabase READS**: 360/hr × 12hr = **4,320 reads/day**
- **Supabase WRITES**: 120/hr × 12hr = **1,440 writes/day**

**Critical Note**: Desktop instances are FAR fewer than mobile instances:
- **Typical deployment**: 1-2 desktop instances per competition (strategy team laptops)
- **Mobile**: 6-10 scouter devices per competition

---

## Cost Calculations

### Supabase Free Tier Limits (as of 2024)
- **Database size**: 500 MB
- **Bandwidth**: 5 GB/month
- **API requests**: **Unlimited** (soft limit: reasonable use)
- **Realtime**: 200 concurrent connections, 2M messages/month

### Estimated Competition Usage (1 competition = 2 days)

#### Mobile (10 devices)
**Reads**:
- Dev: 1,200 reads/day × 10 devices × 2 days = **24,000 reads**
- Prod: 900 reads/day × 10 devices × 2 days = **18,000 reads**

**Writes**:
- 70 writes/day × 10 devices × 2 days = **1,400 writes**

#### Desktop (2 instances)
**Reads**:
- 4,320 reads/day × 2 instances × 2 days = **17,280 reads**

**Writes**:
- 1,440 writes/day × 2 instances × 2 days = **5,760 writes**

---

### Total Per Competition (2 days)

| Operation | Mobile (Prod) | Desktop | **Total** |
|-----------|---------------|---------|-----------|
| **Reads** | 18,000 | 17,280 | **35,280** |
| **Writes** | 1,400 | 5,760 | **7,160** |

**Total API Requests**: ~42,000 per competition (2 days)

---

### Season Projection (10 competitions)

| Operation | Total |
|-----------|-------|
| **Reads** | 352,800 |
| **Writes** | 71,600 |
| **Total** | **424,400 requests** |

**Bandwidth Estimate**:
- Average row size: ~2 KB (including JSONB data)
- Reads: 352,800 × 2 KB = ~688 MB
- Writes: 71,600 × 2 KB = ~140 MB
- **Total**: ~828 MB / season

**Free Tier Assessment**: ✅ **WELL WITHIN LIMITS**
- API requests: Unlimited (424k is reasonable)
- Bandwidth: 828 MB << 5 GB/month
- Database size: ~50 MB << 500 MB

---

## Optimization Opportunities

### 1. Desktop Polling Frequency
**Current**: 60 seconds fixed
**Recommendation**: Match mobile (2 min dev / 4 min prod)

**Impact**:
- Dev: 360 reads/hr → 180 reads/hr (**50% reduction**)
- Prod: 360 reads/hr → 90 reads/hr (**75% reduction**)

**Tradeoff**:
- Desktop admin sees changes every 4 min instead of 1 min (acceptable)
- Instant sync on writes still works (changes pushed immediately)

### 2. Selective Polling
**Current**: Desktop polls ALL tables every 60s
**Recommendation**: Poll user-generated data (picklists, match data) less frequently

**Reasoning**:
- TBA/Statbotics data needs frequent updates (rankings change often)
- User picklists/assignments change infrequently (every 10-30 minutes)

**Proposed Split**:
- **High-frequency** (60s): team_data, schedule (for rankings/scores)
- **Low-frequency** (4 min): picklists, match_data, user_profiles

**Impact**: ~40% reduction in desktop reads

### 3. Realtime Subscriptions (When Re-enabled)
**Current**: Disabled to conserve limits
**Recommendation**: Enable for user-generated data only

**Subscribe to**:
- `event_picklist`
- `event_picklist_entries`
- `event_match_data` (new submissions only)

**Don't subscribe to**:
- `event_team_data` (desktop pushes, mobile polls)
- `event_schedule` (desktop pushes, mobile polls)

**Impact**:
- Realtime messages: ~100 per competition (low)
- Can eliminate picklist/match data polling entirely
- **Total read reduction**: ~30%

---

## Realtime Subscription Cost Analysis

### Current Realtime Usage (DISABLED)
**Subscriptions**: 0
**Messages**: 0
**Cost**: $0

### Proposed Realtime Usage (User Data Only)

**Subscriptions** (per device):
- `event_picklist` (INSERT/UPDATE/DELETE)
- `event_picklist_entries` (INSERT/UPDATE/DELETE)
- `event_match_data` (INSERT only, new submissions)

**Concurrent Connections**:
- Mobile: 10 devices
- Desktop: 2 instances
- **Total**: 12 connections << 200 limit ✅

**Messages Per Competition** (2 days):
- Picklist changes: 10 edits × 10 devices × 2 messages (header + entries) = 200 messages
- Match submissions: 40 matches × 10 scouters = 400 messages
- **Total**: ~600 messages per competition

**Season Projection** (10 competitions):
- 600 messages/comp × 10 comps = **6,000 messages** << 2M limit ✅

**Verdict**: Realtime is **FREE** for this use case

---

## Final Recommendations

### Immediate (No Code Changes)
1. **Keep current architecture** - well within free tier
2. **Monitor Supabase dashboard** during next competition to validate estimates

### Short-term (Minor Optimizations)
1. **Align desktop intervals** to 2 min dev / 4 min prod (match mobile)
   - **Saves**: 50-75% desktop read operations
   - **Effort**: Change one constant in sync.rs

### Medium-term (When Scaling)
1. **Re-enable realtime subscriptions** for user data (picklists, match data)
   - **Saves**: 30% total read operations
   - **Adds**: ~6k realtime messages/season (still free)
   - **Benefit**: Instant UI updates across all devices

2. **Implement selective polling** on desktop (split high/low frequency)
   - **Saves**: Additional 20% desktop reads
   - **Complexity**: Moderate (dual polling loops)

### Long-term (If Approaching Limits)
1. **Incremental sync** (only fetch records modified since last sync)
   - **Saves**: 80-90% read bandwidth (most polls return no changes)
   - **Requires**: Using `last_modified` timestamp filtering
   - **Complexity**: High (cursor management, client-side merge logic)

---

## Development vs Production Costs

### Current Mobile Polling Difference
**Dev** (2 min): 150 reads/hr per device
**Prod** (4 min): 75 reads/hr per device

**Why Different?**
- Development: More frequent testing, need faster feedback
- Production: Battery optimization, proven 2024 config

**Cost Impact**:
- Dev uses 2× reads compared to prod
- Dev is short-term (days of testing) vs prod (weekends/competitions)
- **Net impact**: Negligible (dev is <10% of total usage)

**Recommendation**: Keep current dev/prod split. The 2min dev interval is valuable for rapid testing.

---

## Conclusion

**Current Status**: ✅ **Extremely efficient and well-optimized**

- Total API requests: ~42k per competition (2 days)
- Bandwidth: ~400 MB per competition
- Free tier limits: Not even close to being challenged
- Cost: **$0/month** with significant headroom

**Key Strengths**:
1. Polling intervals are conservative (2-4 min, not sub-minute)
2. Desktop does heavy lifting (TBA/Statbotics sync) so mobile doesn't have to
3. Local caching minimizes redundant queries
4. Write operations are batched (30s queue processing)

**No urgent action needed** - system is cost-effective and scalable for current use case (1 team, 10-15 competitions/year).
