# Technical Specification: Pit Scouting Phase 2 with Image Uploads

## Overview
Implement a comprehensive pit scouting Phase 2 feature that allows scouters to upload team photos, provide ratings and notes, and view this data in a dedicated team details page. This builds upon the existing Phase 1 pit scouting UI.

## Key Architectural Points
1. **Data Flow**: ALL data writes → LOCAL SQLite → background sync to Supabase
   - Use `cacheEventTeamData()` to write to local DB
   - Use `getEventTeamData()` to read from local DB
   - **Exception**: Photos upload directly to Supabase Storage (online only)
2. **Storage Structure**: `{eventKey}/team-{teamKey}/{timestamp}-{index}.{ext}`
   - Example: `2025cada/team-frc1678/1738901234000-0.png`
   - Bucket `team-images` already exists with policies configured
3. **Routing Flow**:
   - **Upload/Create**: Home → `/pit` (select team) → `/pitscout?teamNum=X` (form)
   - **View**: Home → click team → `/team/$teamKey` (display pit data)
4. **Data Storage**: All pit scouting data (Phase 1 + Phase 2) stored in `event_team_data.data` JSON blob
   - No schema changes needed
   - Photo URLs stored in `data.image_urls` array

## Complexity Assessment
**Medium-to-Hard**
- Involves multiple subsystems: storage, database, UI, file uploads
- Requires careful handling of image uploads and COEP/CORS policies
- Multi-phase state management
- New page creation and routing
- Integration with existing auto drawing functionality

---

## Technical Context

### Stack
- **Frontend**: React 19, TypeScript, Vite
- **Routing**: TanStack Router v1.120.3
- **UI**: shadcn/ui components (workspace package)
- **Backend**: Supabase (PostgreSQL + Storage)
- **State Management**: React hooks (useState, useContext)
- **Styling**: Tailwind CSS

### Existing Architecture
- **Database**: Offline-first with local SQLite (via Web Worker + OPFS) synced to Supabase
  - Local: `lib/db/index.ts` with helper functions like `cacheEventTeamData`, `getEventTeamData`
  - Remote: Supabase PostgreSQL (synced automatically in background)
  - `event_team_data` table stores pit scouting data per team/event
    - PK: `(event, team)`
    - Fields: `event`, `team`, `data` (JSON blob), `team_name`, `name`, `uid`, `assigned`, `timestamp`, `last_modified`, `deleted_at`
  - **Critical**: ALL data writes go to LOCAL SQLite first, then sync to Supabase
- **Storage**: Photos are the ONLY exception - uploaded directly to Supabase Storage (online only), URLs stored in local `data` blob
- **Contexts**: 
  - `EventContext` provides `currentEvent`, `isOnline`, `dbInitialized`
  - `TeamDataContext` exists for team list data
- **Routing**:
  - `/pit` - Pit list page (select team to scout)
  - `/pitscout?teamNum=X&teamName=Y` - Pit scouting form (upload/create data)
  - `/team/$teamKey` - Team details page (view pit data) - **already exists**
  - Home page team list → navigates to `/team/$teamKey` for viewing
- **Pit Scouting**: Currently a single-page form in `apps/mobile/src/routes/pitscout.tsx`
  - Phase 1 fields: movement, intake, fuel, climb, autos
  - Has partial save functionality using `cacheEventTeamData`
- **Auto Drawing**: Existing `AutoPathDrawer` component for drawing autonomous paths
- **File Structure**:
  - Routes: `apps/mobile/src/routes/`
  - Components: `apps/mobile/src/components/`
  - Data layer: `lib/db/`, `lib/data/`, `lib/supabase/`

---

## Implementation Approach

### Phase 0: Storage & Database Setup

#### 1. Supabase Storage Bucket
**Status**: ✅ **Already exists** with policies configured

**Structure**:
```
team-images/
  {eventKey}/
    team-{teamKey}/
      {timestamp}-{index}.png
      {timestamp}-{index}.jpg
```

**Example**: `2025cada/team-frc1678/1738901234000-0.png`

**Storage Policies**: Already configured to accept all viewing and inserting

#### 2. Database Schema Changes
**No schema changes needed** - all pit scouting data is stored in the existing `data` JSON blob field.

**Data Structure** in `event_team_data.data`:
```typescript
{
  // Phase 1 fields
  movement: { depot: boolean, trough: boolean },
  intake: { ground: boolean, station: boolean, depot: boolean, stocking: boolean },
  fuel: { shootMoving: boolean, passing: boolean },
  climb: { level: string | null, left: boolean, right: boolean, declimb: boolean },
  autos: Array<{ id: number, climb: boolean, drawing: DrawingData | null }>,
  
  // Phase 2 fields
  rating: number,              // 1-5 rating
  notes: string,               // Scouter observations
  image_urls: string[],        // Array of Supabase Storage URLs
}
```

**Note**: Photos are uploaded directly to Supabase Storage (not stored locally), but URLs are saved in the local SQLite `data` blob for offline access.

---

### Phase 1: Upload Utility

#### File: `lib/supabase/storage.ts` (new file)

**Function**: `uploadPitImages`

```typescript
interface UploadPitImagesParams {
  eventKey: string;      // e.g., "2025cada"
  teamKey: string;       // e.g., "frc1678"
  files: File[];         // Array of image files
}

interface UploadResult {
  urls: string[];        // Public URLs or paths
  errors: string[];      // Any failed uploads
}

export async function uploadPitImages({
  eventKey,
  teamKey,
  files,
}: UploadPitImagesParams): Promise<UploadResult>
```

**Behavior**:
1. For each file:
   - Extract file extension (`.png`, `.jpg`, etc.)
   - Generate unique path: `${eventKey}/team-${teamKey}/${Date.now()}-${index}.${ext}`
   - Upload to `team-images` bucket via `supabase.storage.from("team-images").upload(path, file, { contentType })`
2. Return:
   - If bucket is public: return public URLs via `getPublicUrl(path)`
   - Otherwise: return paths (can resolve to signed URLs later)
3. Handle errors gracefully (partial success allowed)

**Dependencies**: Import `supabase` from `lib/supabase/supabase.ts`

---

### Phase 2: Pit Scouting Phase 2 UI

#### File: `apps/mobile/src/routes/pitscout.tsx` (modify)

**State Additions**:
```typescript
const [step, setStep] = useState<1 | 2>(1);
const [images, setImages] = useState<File[]>([]);
const [rating, setRating] = useState<number>(3);
const [notes, setNotes] = useState<string>("");
const [submitting, setSubmitting] = useState(false);
```

**Phase 1 Changes**:
- Change "Next" button text to "Next Phase"
- On click: validate Phase 1 inputs (if needed), then `setStep(2)` (do NOT save yet)

**Phase 2 UI** (when `step === 2`) - based on screenshots:

1. **Section Header**:
   - Display "Phase 2 - Documentation" or similar
   - Show progress indicator: "Phase 2/2"

2. **Multi-image Input**:
   - Use `<input type="file" accept="image/*" multiple />` styled as shadcn/ui `Button`
   - Button text: "Add Photos" with camera icon
   - Display selected images as thumbnail grid (2-3 columns)
   - Each thumbnail has small "X" button to remove
   - Store in `images` state as `File[]`
   - Show count: "3 photos selected"

3. **Rating Section**:
   - Label: "Team Rating"
   - Use shadcn/ui `Slider` component
   - Range: 1-5 with step of 1
   - Default value: 3
   - Display large number above slider showing current value
   - Optional: show 5 stars that fill as slider moves

4. **Notes Section**:
   - Label: "Scouting Notes"
   - Use shadcn/ui `Textarea` component
   - Placeholder: "Enter your observations about this team..."
   - Rows: 6-8 (multi-line)
   - Character counter (optional): "0/500"

5. **Navigation Buttons**:
   - **Back button** (bottom left): 
     - Variant: outline or ghost
     - Text: "Back to Phase 1"
     - Action: `setStep(1)`
   - **Submit button** (bottom right):
     - Variant: default/primary
     - Text: "Submit Pit Scout"
     - Show loading spinner when `submitting === true`
     - Action: validate + upload + save

**Validation**:
- At least 1 photo required
- Notes required (non-empty)
- Show error toast if validation fails

**Submit Logic**:
```typescript
const handleSubmit = async () => {
  // Validate
  if (images.length === 0 || !notes.trim()) {
    toast.error("Please provide at least 1 photo and notes");
    return;
  }

  setSubmitting(true);

  try {
    // 1. Upload images to Supabase Storage (photos NOT stored locally)
    const { urls, errors } = await uploadPitImages({
      eventKey: currentEvent, // from EventContext
      teamKey: `frc${teamNum}`, // from route params
      files: images,
    });

    if (errors.length > 0) {
      console.warn("Some uploads failed:", errors);
    }

    // 2. Construct pit data payload (all in data blob)
    const pitData = {
      // Phase 1 fields
      movement: { depot: movementDepot, trough: movementTrough },
      intake: { 
        ground: intakeGround, 
        station: intakeStation, 
        depot: intakeDepot,
        stocking: intakeStocking 
      },
      fuel: { shootMoving: fuelShootMoving, passing: fuelPassing },
      climb: { 
        level: climbLevel, 
        left: climbLeft, 
        right: climbRight,
        declimb: climbDeclimb 
      },
      autos: autoEntries.map(e => ({ 
        id: e.id,
        climb: e.climb, 
        drawing: e.drawing 
      })),
      
      // Phase 2 fields
      rating,
      notes,
      image_urls: urls,
    };

    // 3. Save to LOCAL SQLite using existing helper
    await cacheEventTeamData([{
      event: currentEvent,
      team: `frc${teamNum}`,
      data: pitData,
      timestamp: Date.now(),
      last_modified: Date.now(),
    }]);

    // 4. Add to sync queue (if helper exists) for background Supabase sync
    // OR: directly sync to Supabase if online
    // (Implementation depends on existing sync mechanism)

    toast.success("Pit scouting completed!");
    navigate({ to: "/pit" });
  } catch (err) {
    console.error("Submit error:", err);
    toast.error("Failed to save pit data");
  } finally {
    setSubmitting(false);
  }
};
```

**Dependencies**: 
- Import `cacheEventTeamData` from `@lib/db`
- Import `useEvent` from `@lib/context/EventContext` to get `currentEvent`

**UI Components** (use shadcn/ui for consistency):
- Reuse existing: `Section`, `ScoutToggle`, `Input`, `Button`, `Textarea`
- New: `Slider` component for rating (check if exists, create if not)
- Use: `Badge` component for rating display on team details page
- Use: `Carousel` component (exists) for image display
- Loading: Show spinner in submit button when `submitting === true`

---

### Phase 3: Team Details Page

#### File: `apps/mobile/src/routes/team.$teamKey.tsx` (modify existing file)

**Status**: ✅ **File already exists** with basic structure

**Route**: `/team/$teamKey` (e.g., `/team/frc1678`)

**State**:
```typescript
const [view, setView] = useState<"pit" | "match">("pit");
const [pitData, setPitData] = useState<any>(null);
const [loading, setLoading] = useState(true);
```

**Data Fetching**:
```typescript
useEffect(() => {
  async function fetchTeamData() {
    // Fetch from LOCAL SQLite first (offline-first)
    const allTeamData = await getEventTeamData(currentEvent);
    const teamData = allTeamData.find(t => t.team === teamKey);

    if (teamData) {
      setPitData(teamData);
    }
    setLoading(false);
  }

  fetchTeamData();
}, [teamKey, currentEvent]);
```

**Dependencies**:
- Import `getEventTeamData` from `@lib/db`
- Import `useEvent` from `@lib/context/EventContext` to get `currentEvent`

**Data Structure**: `pitData.data` contains the JSON blob with all Phase 1 and Phase 2 fields

**UI Structure** (based on provided screenshots):

1. **Header**:
   - Back button (top left, arrow icon)
   - Team number + name centered (e.g., "1678 | Citrus Circuits")
   - Edit button (top right, pencil icon) - for auto editing

2. **View Switcher** (Pit/Match tabs):
   - Use two `Button` components styled as tabs
   - Horizontal layout at top, below header
   - Active tab: highlighted with primary color/border
   - Inactive tab: muted appearance
   - Pattern: Toggle between `"pit"` and `"match"` views

3. **Pit View** (when `view === "pit"`):
   
   a. **Images Section**:
      - Use shadcn/ui `Carousel` component (already exists in codebase)
      - Display images as swipeable carousel
      - Full-width images with navigation dots/arrows
      - Fallback: if no Carousel, use 2-column grid
      - Image URLs from `pitData.data.image_urls`
      - Add `crossOrigin="anonymous"` to `<img>` tags
   
   b. **Rating Section**:
      - Section header: "Rating" 
      - Display as number badge: `<Badge variant="secondary">{pitData.data.rating}/5</Badge>`
      - Alternative: render 5 star icons, fill based on rating value
   
   c. **Notes Section**:
      - Section header: "Notes"
      - Display notes in a card or bordered container
      - Use `<p className="text-sm text-muted-foreground whitespace-pre-wrap">{pitData.data.notes}</p>`
   
   d. **Phase 1 Data Sections** (collapsible):
      - **Movement**: Display depot/trough capabilities
      - **Intake**: Display ground/station/depot/stocking
      - **Fuel**: Display shooting abilities
      - **Climb**: Display climb level and position
      - **Autos**: Display auto path thumbnails (if drawing data exists)
      - Reuse `Section` component from pitscout.tsx for consistency
      - Read-only display (no toggles, just text/badges)

4. **Match View** (when `view === "match"`):
   - Large centered container with yellow/warning background
   - Text: "Match data coming soon"
   - Icon: chart or match icon
   - Placeholder for future match scouting data display

5. **Edit Auto Button** (floating action button or header icon):
   - Position: top-right of Pit view or floating button
   - Icon: pencil or edit icon
   - On click: open `AutoPathDrawer` modal
   - Pre-populate with `pitData.data.autos` array
   - On save: merge updated autos back into `data` blob, call `cacheEventTeamData`

**Routing Integration**:
- Route already configured in TanStack Router
- Home page team list should navigate to `/team/$teamKey` for viewing pit data
- `/pit` page navigates to `/pitscout` for creating/uploading pit data

---

### Phase 4: COEP/CORS Handling

**Problem**: Images from Supabase may fail to load due to COEP (Cross-Origin-Embedder-Policy) restrictions.

**Error**: `NotSameOriginAfterDefaultedToSameOriginByCoep`

**Solutions**:

#### Short-term (fast):
1. Add `crossOrigin="anonymous"` to all `<img>` tags loading Supabase images
2. Ensure Supabase Storage bucket has correct CORS headers:
   - Go to Supabase Dashboard → Storage → team-images → Settings
   - Add allowed origins (e.g., `http://localhost:5173`, production domain)
   - Ensure `Access-Control-Allow-Origin: *` or specific origin

#### Long-term (if COEP is required):
1. **Investigate COEP source**:
   - Check `apps/mobile/index.html` or server config for COEP headers
   - Search codebase for `Cross-Origin-Embedder-Policy`
   - If set to `require-corp`, remote images need `Cross-Origin-Resource-Policy: cross-origin`

2. **Options**:
   - **Remove/relax COEP**: If not needed (common for non-PWA apps), remove the header
   - **Proxy images**: Serve images through your origin (more work, adds latency)
   - **Signed URLs + fetch as blob**: Fetch image as blob, create object URL (bypasses COEP in some cases)

**Recommendation**: Start with `crossOrigin="anonymous"` and proper CORS. If still failing, relax or remove COEP headers.

---

## Source Code Files

### New Files
1. **`lib/supabase/storage.ts`**: Upload utility (`uploadPitImages` function)

### Modified Files
1. **`apps/mobile/src/routes/pitscout.tsx`**: Add Phase 2 UI (multi-step form), integrate with `cacheEventTeamData`
2. **`apps/mobile/src/routes/team.$teamKey.tsx`**: Add Phase 2 fields display (images, rating, notes) to existing Pit view
3. **`apps/mobile/src/pages/home/DashboardPage.tsx`** (optional): Add click handlers to navigate teams to `/team/$teamKey`

### Potentially Modified (if not exists)
1. **`packages/shadcn/src/components/ui/slider.tsx`**: Slider component (create if missing)
2. **`packages/shadcn/src/components/ui/badge.tsx`**: Already exists, may need variants
3. **`packages/shadcn/src/components/ui/carousel.tsx`**: Already exists, use for image display

---

## Data Model Changes

### `event_team_data` Table
**No schema changes needed** - the `data` TEXT/JSON column already exists in local SQLite and Supabase.

### TypeScript Interfaces

**Local DB Interface** (`lib/db/index.ts`):
```typescript
export interface EventTeamData {
  event: string;
  team: string;
  data: any; // JSON blob containing all pit scouting fields
  team_name?: string;
  name?: string;
  uid?: string;
  assigned?: string;
  timestamp?: number;
  last_modified?: number;
  deleted_at?: number;
}
```

**Pit Data Structure** (inside `data` field):
```typescript
interface PitScoutingData {
  // Phase 1
  movement: { depot: boolean; trough: boolean };
  intake: { 
    ground: boolean; 
    station: boolean; 
    depot: boolean; 
    stocking: boolean;
  };
  fuel: { shootMoving: boolean; passing: boolean };
  climb: { 
    level: string | null; 
    left: boolean; 
    right: boolean; 
    declimb: boolean;
  };
  autos: Array<{ 
    id: number; 
    climb: boolean; 
    drawing: DrawingData | null;
  }>;
  
  // Phase 2
  rating: number;          // 1-5
  notes: string;           // Required
  image_urls: string[];    // Supabase Storage URLs
}
```

---

## API/Interface Changes

### Supabase Storage API (Direct - no local caching)
```typescript
// Upload (in lib/supabase/storage.ts)
const { data, error } = await supabase.storage
  .from("team-images")
  .upload(path, file, { contentType: file.type });

// Get public URL
const { data: { publicUrl } } = supabase.storage
  .from("team-images")
  .getPublicUrl(path);
```

### Local SQLite API (Primary - offline-first)
```typescript
// Import from lib/db
import { cacheEventTeamData, getEventTeamData } from "@lib/db";

// Save pit data locally (will sync to Supabase later)
await cacheEventTeamData([{
  event: "2025cada",
  team: "frc1678",
  data: { /* PitScoutingData */ },
  timestamp: Date.now(),
  last_modified: Date.now(),
}]);

// Fetch team data locally
const teams = await getEventTeamData("2025cada");
const teamData = teams.find(t => t.team === "frc1678");
// Access pit data: teamData.data.rating, teamData.data.notes, etc.
```

### EventContext Hook
```typescript
import { useEvent } from "@lib/context/EventContext";

const { currentEvent, isOnline, dbInitialized } = useEvent();
```

---

## Verification Approach

### Manual Testing
1. **Storage Setup** (already complete):
   - ✅ Bucket `team-images` exists in Supabase Dashboard
   - ✅ Policies allow authenticated uploads and public viewing

2. **Phase 2 UI**:
   - Navigate to `/pitscout?teamNum=1678&teamName=Test`
   - Fill Phase 1 fields → click "Next Phase"
   - Upload 2-3 images, set rating to 4, add notes → click Submit
   - Verify toast success and navigation back to `/pit`

3. **Local Database Verification**:
   - Open browser DevTools → Application tab → IndexedDB (if using) OR check Worker logs
   - Use `getEventTeamData(currentEvent)` in console to fetch local data
   - Confirm row has `data.rating`, `data.notes`, `data.image_urls` populated
   - Verify `data.image_urls` contains valid Supabase Storage URLs
   - **Note**: Data syncs to Supabase automatically in background - focus on local verification first

4. **Team Details Page**:
   - From home page, click a team to navigate to `/team/frc1678`
   - Verify Pit/Match tabs render
   - In Pit view: confirm images load from Supabase URLs, rating displays, notes show
   - Verify Phase 1 data (movement, intake, fuel, climb, autos) also displays

5. **COEP/CORS**:
   - Open browser DevTools → Network tab
   - Refresh team details page
   - Verify images load without CORS errors
   - If errors: check console for COEP warnings, ensure `crossOrigin="anonymous"` on img tags

### Automated Tests (if time allows)
- Unit test `uploadPitImages` function (mock Supabase client)
- Integration test pit data submission flow
- E2E test (Playwright/Cypress): full pit scouting → view on team page

### Lint & Type Check
```bash
cd apps/mobile
npm run lint
npm run build  # Verifies TypeScript compilation
```

---

## Dependencies

**No new external dependencies required** (all already installed):
- `@supabase/supabase-js` - Storage & database
- `@tanstack/react-router` - Routing
- `sonner` - Toast notifications
- `@shadcn/ui` - UI components

**Potential additions** (if not exists):
- shadcn/ui `Slider` component (check `packages/shadcn/src/components/ui/slider.tsx`)
- shadcn/ui `Carousel` component (already exists: `packages/shadcn/src/components/ui/carousel.tsx`)

---

## Edge Cases & Considerations

1. **Large Image Files**:
   - Add client-side validation: max file size (e.g., 5MB per image)
   - Consider image compression before upload (use `canvas` API or library)

2. **Offline Support**:
   - Current app uses local SQLite cache
   - Phase 2: uploads require network
   - Show clear error if offline, allow retry later

3. **Partial Upload Failures**:
   - If 2/3 images upload successfully, still save data with available URLs
   - Log errors for debugging, show warning toast

4. **Image Display Performance**:
   - Use lazy loading: `<img loading="lazy" />`
   - Consider thumbnail generation (Supabase Image Transformations or client-side)

5. **Security**:
   - Validate file types on client (accept only images)
   - Consider server-side validation via Supabase Edge Functions
   - RLS policies prevent unauthorized access

6. **Data Migration**:
   - Migration adds new nullable columns → safe for existing data
   - Existing rows will have `null` for rating/notes/image_urls

7. **Mobile Responsiveness**:
   - Test on actual mobile devices (iOS/Android)
   - Ensure file picker works on mobile browsers
   - Image grid should be responsive (1 column on small screens?)

---

## Implementation Plan

This spec is comprehensive enough to proceed directly to implementation. However, if breaking down further:

1. **Upload Utility** (1 task):
   - Implement `uploadPitImages` function
   - Add basic error handling
   - Manual test with temp button

2. **Pit Scouting Phase 2 UI** (1 task):
   - Add multi-step state to pitscout.tsx (step 1/2)
   - Build Phase 2 UI following screenshot design:
     - File input with preview thumbnails (2-3 column grid)
     - Rating slider (1-5) with large number display
     - Notes textarea (6-8 rows)
     - Back/Submit button layout
   - Wire up submit logic: upload photos → save to local SQLite via `cacheEventTeamData`
   - Use `useEvent()` hook for `currentEvent`
   - Check if `Slider` component exists, create if needed
   - Test end-to-end

3. **Team Details Page** (1 task):
   - **Modify existing** route file `team.$teamKey.tsx` (already has basic structure)
   - Enhance Pit view to display Phase 2 fields following screenshot design:
     - Add `Carousel` component for images from `pitData.data.image_urls` (if images exist)
     - Add Rating badge display: "{rating}/5"
     - Add Notes section with proper styling
     - Keep existing Phase 1 data sections (movement, intake, fuel, climb, autos already displayed)
   - Pit/Match tab switcher already exists
   - Match view placeholder already exists (yellow box)
   - Test navigation from home page and data display

4. **COEP/CORS Fixes** (1 task):
   - Add crossOrigin to images
   - Configure Supabase CORS (if needed)
   - Test in browser, fix any remaining issues

4. **Home Page Navigation** (optional enhancement):
   - In `DashboardPage.tsx`, add click handlers to team list items
   - Navigate to `/team/$teamKey` when clicking a team
   - Currently teams display but may not have click handlers wired

5. **Auto Edit Integration** (future task - not part of Phase 2):
   - Add "Edit Auto" button to team details
   - Wire up AutoPathDrawer with existing auto data
   - Save updates back to event_team_data via `cacheEventTeamData`
   - Test edit flow

**Total Estimated Tasks**: 3 core tasks + 1 optional navigation enhancement

---

## Success Criteria

✅ Storage bucket `team-images` exists with correct policies (DONE - already exists)  
✅ Pit scouting Phase 2 UI allows uploading images, rating, notes  
✅ Submit saves all data to LOCAL SQLite (Phase 1 + Phase 2 in `data` JSON blob)  
✅ Photos upload to Supabase Storage, URLs stored in local `data.image_urls`  
✅ Team details page displays pit data with images, rating, notes from local DB  
✅ Images load without CORS/COEP errors  
✅ Pit/Match view switcher works  
✅ Auto edit functionality accessible from team details  
✅ No TypeScript errors, linter passes  
✅ Manual testing confirms full flow works end-to-end
