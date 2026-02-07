# Implementation Report: Pit Scouting Phase 2 with Image Uploads

## What Was Implemented

### 1. Upload Utility (`lib/supabase/storage.ts`)
- Created `uploadPitImages` function to handle image uploads to Supabase Storage
- Uploads images to `team-images` bucket with structured path: `{eventKey}/team-{teamKey}/{timestamp}-{index}.{ext}`
- Returns public URLs for uploaded images
- Gracefully handles partial upload failures

### 2. Pit Scouting Phase 2 UI (`apps/mobile/src/routes/pitscout.tsx`)
- Added multi-step state management (Phase 1/2)
- Phase indicator showing current progress
- **Phase 1**: Existing fields (Movement, Intake, Fuel, Climb, Autos)
- **Phase 2**: New fields including:
  - Multi-image upload with thumbnail preview grid (3 columns)
  - Remove image functionality
  - Rating slider (1-5) with large number display
  - Notes textarea (8 rows)
  - Back and Submit buttons
- Validation: requires at least 1 photo and notes
- Integration with EventContext for current event
- Saves all data to local SQLite using `cacheEventTeamData`
- Phase 2 data structure includes `rating`, `notes`, and `image_urls` array

### 3. Team Details Page (`apps/mobile/src/routes/team.$teamKey.tsx`)
- New route: `/team/:teamKey`
- Header with back button, team number/name, and edit icon
- Pit/Match view switcher (tabs)
- **Pit View**:
  - Image carousel with navigation (using Embla Carousel)
  - Rating badge display
  - Notes section in bordered card
  - Phase 1 data sections (Movement, Intake, Fuel, Climb, Autos) with badges
- **Match View**: Placeholder with icon and "Match data coming soon" message
- Fetches data from local SQLite using `getEventTeamData`
- COEP/CORS handling: `crossOrigin="anonymous"` on image tags

### 4. COEP/CORS Handling
- Added `crossOrigin="anonymous"` attribute to all image tags in Team Details page
- This enables images from Supabase Storage to load properly even with COEP policies

## How the Solution Was Tested

### Build Verification
- Ran `pnpm install` to install dependencies
- Ran `pnpm run build` successfully - TypeScript compilation passed
- Fixed TypeScript linting issue: replaced `any` type with explicit type for auto entries

### Type Safety
- All new code is fully typed with TypeScript
- No TypeScript compilation errors
- Fixed linting issue in team details page (replaced `any` with proper type)

### Manual Testing Recommendations
1. Navigate to `/pitscout?teamNum=1678&teamName=Test`
2. Fill Phase 1 fields → click "Next Phase"
3. Upload 2-3 images, set rating, add notes → click "Submit Pit Scout"
4. Navigate to `/team/frc1678` to view the data
5. Test Pit/Match tab switching
6. Verify images load in carousel

## Biggest Issues or Challenges Encountered

### 1. Linting vs. Build
- ESLint showed many pre-existing errors in other files (27 errors total)
- However, TypeScript build succeeded, indicating the new code is valid
- Only fixed the linting error in the newly created file (`team.$teamKey.tsx`)
- Pre-existing errors in other routes were left untouched as they're outside the scope

### 2. Dependencies Installation
- Initial `npm` commands failed because dependencies weren't installed
- Resolved by running `pnpm install` first

### 3. Type Safety for Dynamic Data
- The `data` field in EventTeamData is typed as `any` in the existing codebase
- Had to use explicit typing for the auto entries to avoid linting errors
- Maintained consistency with existing patterns while fixing the specific type issue

### 4. COEP/CORS Considerations
- Added `crossOrigin="anonymous"` as a preventive measure
- Actual COEP testing would require running the app and checking browser console
- Supabase bucket policies were already configured (per spec)

## Architecture Decisions

### Offline-First Approach
- Photos upload directly to Supabase (requires network)
- URLs are saved in local SQLite for offline access to the data structure
- Consistent with existing architecture where storage is online-only but metadata is cached locally

### Data Structure
- All pit data stored in the `data` JSON blob (no schema changes needed)
- Phase 2 fields (`rating`, `notes`, `image_urls`) added to existing structure
- Maintains backward compatibility with existing data

### UI Components
- Reused existing shadcn/ui components (Slider, Textarea, Carousel, Badge)
- Maintained consistent styling with Phase 1 UI
- Used existing Section component pattern for collapsible sections

## Files Created/Modified

### Created
- `lib/supabase/storage.ts` - Upload utility
- `apps/mobile/src/routes/team.$teamKey.tsx` - Team details page

### Modified
- `apps/mobile/src/routes/pitscout.tsx` - Added Phase 2 UI and submit logic

## Next Steps (Not Implemented)
- Auto edit integration from team details page (edit button is placeholder)
- Actual manual testing on device/browser
- Image optimization/compression before upload
- Offline queue for failed uploads
