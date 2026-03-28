/**
 * TypeScript wrappers for Tauri SQLite database commands
 * Provides offline-first data access from local SQLite cache
 *
 * Available Functions:
 * -------------------
 * Teams (TBA Stats):
 *   - getTeams(event) - Fetch teams with TBA stats (rank, EPA, OPR, etc)
 *
 * Schedule & Assignments:
 *   - getSchedule(event) - Fetch match schedule with assignments
 *   - cacheSchedule(event, schedule) - Cache schedule from Supabase
 *
 * Picklists:
 *   - getPicklists(event) - Fetch all picklists (with embedded entries)
 *   - cachePicklists(picklists) - Cache picklists from Supabase
 *
 * User Profiles:
 *   - getUserProfiles(uids?) - Fetch user profiles (filter by UIDs optional)
 *   - cacheUserProfiles(profiles) - Cache user profiles from Supabase
 *
 * Pit Scouting:
 *   - getPitScoutingData(event) - Fetch pit scouting submissions
 *   - cachePitScoutingData(data) - Cache pit scouting from Supabase
 *
 * Match Scouting:
 *   - getMatchScoutingData(event) - Fetch match scouting submissions
 *   - cacheMatchScoutingData(data) - Cache match scouting from Supabase
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Team data from SQLite cache
 * Includes TBA data synced by desktop backend
 */
export interface EventTeamData {
  event: string;
  team: string;
  team_name?: string;
  data?: Record<string, unknown>; // pit scouting fields only
  last_modified: number;
}

/**
 * Schedule entry from SQLite cache
 * Includes match assignments and TBA match data
 */
export interface EventScheduleEntry {
  event: string;
  match: string;
  team: string;
  alliance: string;
  name?: string;
  uid?: string;
  est_time?: number;
  red_score?: number;
  blue_score?: number;
  red_win_prob?: number;
  predicted_red_score?: number;
  predicted_blue_score?: number;
  last_modified: number;
}

/**
 * Embedded entry in a picklist
 */
export interface PicklistEntry {
  team: string;
  rank: number;
  flags: Record<string, unknown> | null;
}

/**
 * Picklist from SQLite cache (entries embedded in picklist column)
 */
export interface EventPicklist {
  event: string;
  id: string;
  title: string;
  picklist: PicklistEntry[];
  uname: string;
  uid: string;
  timestamp: number;
  last_modified: number;
}

/**
 * Fetch all teams for an event from SQLite cache
 * Fast, offline-capable read - backend syncs from TBA every 30s
 */
export async function getTeams(event: string): Promise<EventTeamData[]> {
  return invoke<EventTeamData[]>("get_teams", { event });
}

/**
 * Fetch schedule for an event from SQLite cache
 * Includes match assignments and TBA match data
 */
export async function getSchedule(
  event: string
): Promise<EventScheduleEntry[]> {
  return invoke<EventScheduleEntry[]>("get_schedule", { event });
}

/**
 * Fetch all picklists for an event from SQLite cache
 */
export async function getPicklists(event: string): Promise<EventPicklist[]> {
  return invoke<EventPicklist[]>("get_picklists", { event });
}

/**
 * Cache schedule data to SQLite after fetching from Supabase
 * Allows offline access to Supabase data
 */
export async function cacheSchedule(
  event: string,
  schedule: any[]
): Promise<void> {
  return invoke<void>("cache_schedule", { event, schedule });
}

/**
 * Cache picklists to SQLite after fetching from Supabase
 * Allows offline access to user-created picklists
 */
export async function cachePicklists(picklists: any[]): Promise<void> {
  return invoke<void>("cache_picklists", { picklists });
}

/**
 * User profile from SQLite cache
 */
export interface UserProfile {
  uid: string;
  name: string;
  role: "user" | "scouter" | "admin";
  settings: Record<string, unknown>;
  last_modified: number; // Epoch milliseconds in SQLite
}

/**
 * Fetch user profiles from SQLite cache
 * Pass uids array to filter, or omit to get all profiles
 */
export async function getUserProfiles(uids?: string[]): Promise<UserProfile[]> {
  return invoke<UserProfile[]>("get_user_profiles", {
    uids: uids && uids.length > 0 ? uids : null,
  });
}

/**
 * Cache user profiles to SQLite after fetching from Supabase
 * Allows offline access to user data for scouter ratings
 */
export async function cacheUserProfiles(profiles: UserProfile[]): Promise<void> {
  return invoke<void>("cache_user_profiles", { profiles });
}

/**
 * Fetch user profiles directly from Supabase and refresh SQLite cache.
 * Purges stale (deleted) entries by propagating deleted_at from Supabase.
 * Returns fresh active profiles (deleted_at IS NULL).
 */
export async function refreshUserProfilesFromSupabase(): Promise<UserProfile[]> {
  return invoke<UserProfile[]>("refresh_user_profiles_from_supabase");
}

/**
 * Pit scouting data from SQLite cache
 * Contains pit scouting JSONB data and scouter information
 */
export interface PitScoutingData {
  event: string;
  team: string;
  data: Record<string, unknown> | null; // JSONB pit scouting data
  team_name: string | null;
  name: string | null; // Scouter name who submitted
  uid: string | null; // Scouter UUID
  assigned: string | null; // UUID of assigned scouter
  timestamp: string | null;
  last_modified: number; // Epoch milliseconds in SQLite
}

/**
 * Match scouting data from SQLite cache
 * Contains match scouting JSONB data and scouter information
 */
export interface MatchScoutingData {
  event: string;
  match: string;
  team: string;
  alliance: "red" | "blue";
  data_raw: Record<string, unknown> | null; // JSONB raw scouting input
  data: Record<string, unknown> | null; // JSONB processed data (UNUSED)
  name: string | null; // Scouter name
  uid: string | null; // Scouter UUID
  timestamp: string | null;
  last_modified: number; // Epoch milliseconds in SQLite
}

/**
 * Fetch pit scouting data for an event from SQLite cache
 */
export async function getPitScoutingData(
  event: string
): Promise<PitScoutingData[]> {
  return invoke<PitScoutingData[]>("get_pit_scouting_data", { event });
}

/**
 * Fetch match scouting data for an event from SQLite cache
 */
export async function getMatchScoutingData(
  event: string
): Promise<MatchScoutingData[]> {
  return invoke<MatchScoutingData[]>("get_match_scouting_data", { event });
}

/**
 * Cache pit scouting data to SQLite after fetching from Supabase
 * Allows offline access to pit scouting submissions
 */
export async function cachePitScoutingData(
  data: PitScoutingData[]
): Promise<void> {
  return invoke<void>("cache_pit_scouting_data", { data });
}

/**
 * Cache match scouting data to SQLite after fetching from Supabase
 * Allows offline access to match scouting submissions
 */
export async function cacheMatchScoutingData(
  data: MatchScoutingData[]
): Promise<void> {
  return invoke<void>("cache_match_scouting_data", { data });
}

// ─── Image disk cache ────────────────────────────────────────────────────────

/**
 * Convert a Blob to a base64 string (chunked to avoid stack overflow on large images).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * Convert a base64 string back to a Blob.
 */
export function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Store an image in the persistent disk cache (survives app restarts).
 * `path` is the Supabase storage path. `data` is base64-encoded image bytes.
 */
export async function cacheImageToDisk(path: string, data: string): Promise<void> {
  return invoke<void>("cache_image", { path, data });
}

/**
 * Retrieve a cached image from disk.
 * Returns base64-encoded bytes, or null if not cached yet.
 */
export async function getCachedImageFromDisk(path: string): Promise<string | null> {
  return invoke<string | null>("get_cached_image", { path });
}
