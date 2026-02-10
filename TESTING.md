# FunkyScout Testing Guide

Comprehensive testing strategy and test execution guide.

---

## Test Suite Overview

### Coverage Areas

1. **Data Merge Logic** - Ensures pit scouting data and TBA stats coexist without overwrites
2. **Offline-First Writes** - Validates optimistic writes, sync queue, and instant sync
3. **Sync Queue Processing** - Tests retry logic, error handling, and queue management
4. **Realtime Subscriptions** - Verifies debouncing and refresh triggers
5. **Permissions** - Role-based access control for picklists and data
6. **Data Integrity** - Timestamp conversions, validation, and constraints
7. **Performance** - Caching, batching, and optimization strategies

---

## Running Tests

### Prerequisites

```bash
# Install dependencies
pnpm install

# Ensure Vitest is installed
pnpm add -D vitest @vitest/ui
```

### Run All Tests

```bash
# Run all tests
pnpm test

# Run with UI
pnpm test:ui

# Run with coverage
pnpm test:coverage

# Watch mode (auto-rerun on changes)
pnpm test:watch
```

### Run Specific Test Files

```bash
# Sync tests only
pnpm test lib/__tests__/sync.test.ts

# Permissions tests only
pnpm test lib/__tests__/permissions.test.ts

# Pattern matching
pnpm test sync
```

### Run Desktop Tests (Rust)

```bash
cd apps/desktop/src-tauri
cargo test
```

---

## Test Files

### Mobile/Library Tests (TypeScript)

| File | Coverage |
|------|----------|
| [`lib/__tests__/sync.test.ts`](lib/__tests__/sync.test.ts) | Sync manager, merge logic, offline writes, queue processing |
| [`lib/__tests__/permissions.test.ts`](lib/__tests__/permissions.test.ts) | Role-based access control, picklist permissions |

### Desktop Tests (Rust)

**TODO**: Create Rust unit tests for:
- TBA API client (`services/tba.rs`)
- Statbotics API client (`services/statbotics.rs`)
- Supabase merge logic (`services/supabase.rs`)
- Sync orchestration (`services/sync.rs`)

---

## Writing Tests

### Test Structure

Follow the **Arrange-Act-Assert** pattern:

```typescript
it('should merge pit data with TBA stats', async () => {
  // Arrange: Setup test data and mocks
  const existingData = { rank: 5, opr: 45.3 };
  const pitData = { depot: 'coral_station' };

  // Act: Execute the function being tested
  const merged = await mergePitWithStats(existingData, pitData);

  // Assert: Verify the outcome
  expect(merged.rank).toBe(5); // TBA preserved
  expect(merged.depot).toBe('coral_station'); // Pit preserved
});
```

### Mock Supabase Client

Use this pattern for mocking Supabase:

```typescript
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(() => Promise.resolve({
          data: { /* your data */ },
          error: null
        })),
      })),
    })),
    upsert: vi.fn(() => Promise.resolve({ error: null })),
  })),
};
```

### Test Database Isolation

Each test should:
1. Use a separate in-memory SQLite instance
2. Reset state with `beforeEach`
3. Clean up with `afterEach`

```typescript
import { initDatabase, closeDatabase } from '../db';

beforeEach(async () => {
  await initDatabase(); // Fresh database
});

afterEach(async () => {
  await closeDatabase(); // Cleanup
});
```

---

## Manual Testing Checklist

### Offline-First Behavior

- [ ] **Write while offline**
  1. Disconnect wifi
  2. Submit pit scouting data
  3. Verify data appears in UI immediately
  4. Check `sync_queue` table has pending item
  5. Reconnect wifi
  6. Verify data syncs to Supabase within 30s
  7. Check other devices receive update via realtime

- [ ] **Read while offline**
  1. Load event data while online
  2. Disconnect wifi
  3. Navigate to teams, schedule, picklists
  4. Verify all cached data is accessible
  5. Verify no error messages

- [ ] **Offline → Online transition**
  1. Queue multiple operations while offline
  2. Reconnect wifi
  3. Verify toast: "Back online, syncing data..."
  4. Verify all operations sync successfully
  5. Verify toast: "Sync complete!"

### Data Merge Integrity

- [ ] **Pit data + TBA stats coexistence**
  1. Mobile: Submit pit scouting for team 254
  2. Desktop: Verify desktop continues to update TBA stats every 30s
  3. Supabase: Check `event_team_data.data` contains BOTH pit and TBA fields
  4. Mobile: Verify pit data is not overwritten by desktop sync
  5. Desktop: Verify TBA stats are not overwritten by pit submissions

- [ ] **Concurrent writes**
  1. Device A: Update pit scouting for team 254
  2. Device B: Simultaneously update different pit field for team 254
  3. Verify both changes are preserved (last write wins per field)
  4. Verify no data loss

### Realtime Sync

- [ ] **Schedule updates**
  1. Device A: Assign shift to user
  2. Device B: Verify shift appears within 2-4 seconds (debounced)
  3. Verify no UI glitching from rapid updates

- [ ] **Picklist updates**
  1. Device A: Create public picklist
  2. Device B: Verify picklist appears for scouters
  3. Device A: Reorder teams
  4. Device B: Verify changes sync in real-time

- [ ] **Match data updates**
  1. Device A: Submit match scouting
  2. Device B: Verify submission appears in match list

### Permissions

- [ ] **Picklist visibility**
  1. Create picklists: public, private, default
  2. User role: Should only see own private picklists
  3. Scouter role: Should see public + default + own private
  4. Admin role: Should see all picklists

- [ ] **Picklist editing**
  1. Scouter A: Create public picklist
  2. Scouter B: Should NOT be able to edit (not creator)
  3. Admin: Should be able to edit (override)
  4. Scouter B: Should be able to edit default picklist

### Desktop Sync

- [ ] **TBA data updates**
  1. Start desktop app
  2. Monitor logs every 30s for sync cycles
  3. Verify rankings update when teams play matches
  4. Verify EPA/OPR updates
  5. Verify match predictions update

- [ ] **Bootstrap**
  1. Select new event in desktop
  2. Verify bootstrap completes (2 TBA API calls)
  3. Verify Supabase has team names + initial rankings
  4. Verify mobile sees new event data

### Performance

- [ ] **No excessive API calls**
  1. Desktop: Monitor network tab, verify 3 TBA + 2 Statbotics calls per 30s
  2. Mobile: Verify no redundant Supabase calls (use cache)
  3. Verify no infinite loops

- [ ] **No excessive logging**
  1. Desktop: Monitor terminal for log spam
  2. Should only see errors + important events
  3. No routine success messages every 30s

- [ ] **Responsive UI**
  1. Large event (50+ teams): UI should remain responsive
  2. Picklist drag-and-drop should be smooth
  3. No lag when switching tabs

---

## Test Data

### Sample Events

Use these TBA event keys for testing:
- **2024casd** - San Diego Regional (medium size)
- **2024cmptx** - Championship (large, ~75 teams)
- **2024week0** - Week 0 (small, practice)

### Sample Teams

- **frc254** - The Cheesy Poofs (always good data)
- **frc1678** - Citrus Circuits (comprehensive stats)
- **frc2056** - OP Robotics

---

## CI/CD Integration

### GitHub Actions (TODO)

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:coverage
      - uses: codecov/codecov-action@v3
```

### Pre-commit Hooks (TODO)

```bash
# Install Husky
pnpm add -D husky

# Add pre-commit hook
npx husky add .husky/pre-commit "pnpm test"
```

---

## Known Issues

### Test Coverage Gaps

- [ ] No Rust unit tests for desktop services
- [ ] No integration tests for mobile ↔ desktop sync
- [ ] No E2E tests for full user workflows
- [ ] No load testing for high concurrency
- [ ] No tests for image upload/compression

### Test Environment Limitations

- Vitest runs in Node.js (no browser APIs like IndexedDB)
- May need to mock more browser APIs for full coverage
- SQLite WASM may behave differently in tests vs production

---

## Debugging Tests

### Enable Verbose Logging

```bash
# Run tests with debug output
DEBUG=* pnpm test

# Run specific test with logs
pnpm test sync.test.ts --reporter=verbose
```

### Inspect Test Database

```typescript
import { getDb } from '../db';

it('should write to database', async () => {
  await putTeamData(...);

  // Debug: Inspect database state
  const db = await getDb();
  const rows = await db.execute('SELECT * FROM event_team_data');
  console.log('DB State:', rows);
});
```

### Mock Inspection

```typescript
it('should call Supabase upsert', async () => {
  await syncManager.forceSyncNow();

  // Inspect mock calls
  console.log('Upsert calls:', mockSupabase.from.mock.calls);
  expect(mockSupabase.from).toHaveBeenCalledWith('event_team_data');
});
```

---

## Contributing Tests

### Guidelines

1. **One assertion per test** - Tests should be focused and specific
2. **Descriptive names** - Use `should [expected behavior] when [condition]`
3. **Independent tests** - No test should depend on another test's state
4. **Fast tests** - Avoid unnecessary delays or network calls
5. **Realistic data** - Use data that matches production structure

### Adding New Tests

1. Create test file: `lib/__tests__/[feature].test.ts`
2. Import necessary functions and mocks
3. Group related tests with `describe` blocks
4. Use `beforeEach`/`afterEach` for setup/cleanup
5. Write clear assertions with helpful error messages

### Code Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

Run `pnpm test:coverage` to view coverage report.

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Supabase Testing Guide](https://supabase.com/docs/guides/testing)
- [Rust Testing](https://doc.rust-lang.org/book/ch11-00-testing.html)
