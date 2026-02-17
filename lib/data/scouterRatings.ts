/**
 * Scouter Rating System
 *
 * Manages 1-5 star ratings for scouters stored in user_profiles.settings JSONB field
 * Ratings can be manually assigned or automatically calculated based on accuracy metrics
 *
 * DATABASE SCHEMA NOTE:
 * - user_profiles.settings is PostgreSQL JSONB (currently {} for all users)
 * - last_modified uses PostgreSQL timestamptz, NOT numeric epoch milliseconds
 * - See DATABASE_ARCHITECTURE.md for timestamp handling patterns
 */

import type { UserProfile } from "@lib/data/schema";
import type { EventMatchData, EventScheduleEntry } from "@lib/db";
import supabase from "@lib/supabase/supabase";
import { isTauri } from "@lib/utils/platform";

// Re-export UserProfile for convenience
export type { UserProfile } from "@lib/data/schema";

/**
 * Settings schema stored in user_profiles.settings (JSONB)
 */
export interface UserProfileSettings {
  scouterRating?: number; // 1-5, null if not rated
  // ... other settings can be added here
}

/**
 * Scouter rating information for an event
 */
export interface ScouterRating {
  uid: string;
  name: string;
  rating: number | null; // 1-5, null if not rated
  matchesAssigned: number; // Matches assigned from event_schedule
  matchesScouted: number; // Matches actually scouted (submitted data)
  consistency?: number; // Optional: calculated consistency score
}

/**
 * Get all user profiles
 * Desktop: Uses local cache, falls back to Supabase
 * Mobile: Fetches from Supabase directly
 */
export async function getUserProfiles(uids?: string[]): Promise<UserProfile[]> {
  try {
    // Desktop: Try local cache first
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cached = await invoke<UserProfile[]>("get_user_profiles", {
          uids: uids && uids.length > 0 ? uids : null,
        });

        if (cached && cached.length > 0) {
          // Convert cached profiles to match expected format
          return cached.map((profile) => ({
            uid: profile.uid,
            name: profile.name,
            role: profile.role as "user" | "scouter" | "lead",
            settings: profile.settings || {},
            last_modified: new Date(profile.last_modified).toISOString(), // Convert epoch to ISO string
            deleted_at: null,
          }));
        }

        // If cache is empty, fall through to Supabase fetch
        console.log("[ScouterRatings] Cache empty, fetching from Supabase");
      } catch (err) {
        console.warn(
          "[ScouterRatings] Cache fetch failed, falling back to Supabase:",
          err
        );
      }
    }

    // Mobile or desktop fallback: Fetch from Supabase
    let query = supabase.from("user_profiles").select("*");

    if (uids && uids.length > 0) {
      query = query.in("uid", uids);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch user profiles: ${error.message}`);
    }

    const profiles = (data || []).map((profile) => ({
      uid: profile.uid,
      name: profile.name,
      role: profile.role,
      settings: profile.settings || {},
      last_modified: profile.last_modified,
      deleted_at: profile.deleted_at,
    }));

    // Desktop: Cache the fetched profiles
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("cache_user_profiles", {
          profiles: profiles.map((p) => ({
            uid: p.uid,
            name: p.name,
            role: p.role,
            settings: p.settings,
            last_modified: new Date(p.last_modified).getTime(), // Convert to epoch
            deleted_at: p.deleted_at ? new Date(p.deleted_at).getTime() : null,
          })),
        });
      } catch (err) {
        console.warn("[ScouterRatings] Failed to cache profiles:", err);
      }
    }

    return profiles;
  } catch (error) {
    console.error("[ScouterRatings] Error fetching user profiles:", error);
    throw error;
  }
}

/**
 * Get scouter ratings for all scouters at an event
 *
 * Combines user profile data with event-specific match counts
 */
export async function getScouterRatings(
  eventKey: string,
  profiles: UserProfile[],
  matchData: EventMatchData[],
  scheduleData: EventScheduleEntry[]
): Promise<ScouterRating[]> {
  return profiles.map((profile) => {
    // Count matches ASSIGNED to this user (from event_schedule where uid matches)
    const assignedMatches = scheduleData.filter(
      (s) => s.uid === profile.uid && s.name && !s.deleted_at
    );

    // Count matches SCOUTED by this user (from event_match_data where name is populated)
    const scoutedMatches = matchData.filter(
      (m) => m.uid === profile.uid && m.name && !m.deleted_at
    );

    // Extract rating from settings JSONB
    const settings = profile.settings as UserProfileSettings;
    const rating = settings?.scouterRating ?? null;

    return {
      uid: profile.uid,
      name: profile.name,
      rating,
      matchesAssigned: assignedMatches.length,
      matchesScouted: scoutedMatches.length,
    };
  });
}

/**
 * Set manual rating for a scouter
 *
 * Desktop: Writes to local cache → queue → instant sync if online
 * Mobile: Direct Supabase write (for now)
 *
 * IMPORTANT: PostgreSQL uses timestamptz, not epoch milliseconds
 */
export async function setScouterRating(
  uid: string,
  rating: number | null
): Promise<void> {
  // Validate rating range
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new Error("Rating must be between 1 and 5, or null to clear rating");
  }

  try {
    // Get current profile to preserve other settings
    const profiles = await getUserProfiles([uid]);
    if (profiles.length === 0) {
      throw new Error(`User profile not found for uid: ${uid}`);
    }

    const currentSettings = (profiles[0].settings as UserProfileSettings) || {};
    const newSettings: UserProfileSettings = {
      ...currentSettings,
      scouterRating: rating ?? undefined, // Remove field if null
    };

    const now = Date.now();

    // Desktop: Write to cache → queue → sync
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");

      console.log(`[ScouterRatings] Desktop: Updating profile ${uid} rating to ${rating}`);

      // 1. Update local cache
      await invoke("cache_user_profiles", {
        profiles: [
          {
            uid: profiles[0].uid,
            name: profiles[0].name,
            role: profiles[0].role,
            settings: newSettings,
            last_modified: now,
            deleted_at: null,
          },
        ],
      });

      // 2. Add to sync queue
      await invoke("add_to_sync_queue", {
        operation: "UPDATE_USER_PROFILE",
        payload: {
          uid,
          settings: newSettings,
        },
      });

      // 3. Trigger instant sync (unless offline, then waits for 60s cycle)
      await invoke("trigger_sync_now").catch((e) => {
        console.warn("[ScouterRatings] Instant sync trigger failed:", e);
      });

      console.log(`[ScouterRatings] Desktop: Queued profile update for ${uid}`);
      return;
    }

    // Mobile: Direct Supabase write (no sync queue for mobile yet)
    console.log(`[ScouterRatings] Mobile: Direct Supabase update for ${uid}`);
    const { error } = await supabase
      .from("user_profiles")
      .update({
        settings: newSettings,
        last_modified: new Date(now).toISOString(), // PostgreSQL timestamptz format
      })
      .eq("uid", uid);

    if (error) {
      throw new Error(`Failed to update user profile: ${error.message}`);
    }

    console.log(
      `[ScouterRatings] Set rating for ${profiles[0].name} (${uid}): ${rating}`
    );
  } catch (error) {
    console.error("[ScouterRatings] Error setting rating:", error);
    throw error;
  }
}

/**
 * Calculate automatic rating based on accuracy metrics
 *
 * PLACEHOLDER: Returns average rating (3) if scouter has enough data
 * TODO: Implement real accuracy calculation comparing scouter data to consensus
 *
 * Future implementation ideas:
 * - Compare scouter's counts to median/consensus for each metric
 * - Penalize outliers and inconsistencies
 * - Reward consistent, accurate scouting patterns
 * - Factor in rating consistency across matches
 */
export async function calculateScouterRating(
  uid: string,
  eventKey: string,
  matchData: EventMatchData[]
): Promise<number | null> {
  const scoutedMatches = matchData.filter(
    (m) => m.uid === uid && !m.deleted_at
  );

  // Need at least 3 matches to calculate rating
  if (scoutedMatches.length < 3) {
    return null;
  }

  // PLACEHOLDER: Return average rating
  // TODO: Implement accuracy algorithm
  // - Calculate consensus stats per team/match
  // - Compare scouter's data to consensus
  // - Generate rating based on accuracy percentage
  const placeholderRating = 3;

  console.log(
    `[ScouterRatings] Placeholder rating for uid ${uid}: ${placeholderRating} (based on ${scoutedMatches.length} matches)`
  );

  return placeholderRating;
}

/**
 * Helper: Update user profile (for future use with Tauri)
 *
 * This will be used by desktop when we add the Rust command
 */
export async function updateUserProfile(
  uid: string,
  updates: {
    settings?: UserProfileSettings;
    name?: string;
    role?: string;
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from("user_profiles")
      .update({
        ...updates,
        last_modified: new Date().toISOString(), // PostgreSQL timestamptz
      })
      .eq("uid", uid);

    if (error) {
      throw new Error(`Failed to update user profile: ${error.message}`);
    }

    console.log(`[ScouterRatings] Updated user profile for uid: ${uid}`);
  } catch (error) {
    console.error("[ScouterRatings] Error updating profile:", error);
    throw error;
  }
}
