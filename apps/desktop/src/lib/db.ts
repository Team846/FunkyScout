/**
 * TypeScript wrappers for Tauri SQLite database commands
 * Provides offline-first data access from local SQLite cache
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
  data?: {
    rank?: number;
    record?: {
      wins: number;
      losses: number;
      ties: number;
    };
    last_match?: string;
    next_match?: string;
    epa?: number;
    opr?: number;
    dpr?: number;
    ccwm?: number;
  };
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
 * Picklist from SQLite cache
 */
export interface EventPicklist {
  event: string;
  id: string;
  title: string;
  uname: string;
  uid: string;
  timestamp: number;
  last_modified: number;
}

/**
 * Picklist entry from SQLite cache
 */
export interface EventPicklistEntry {
  event: string;
  id: string;
  team: string;
  rank: number;
  flags?: any; // JSON flags like { excluded: boolean }
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
 * Fetch all picklist entries for an event from SQLite cache
 */
export async function getPicklistEntries(
  event: string
): Promise<EventPicklistEntry[]> {
  return invoke<EventPicklistEntry[]>("get_picklist_entries", { event });
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
 * Cache picklist entries to SQLite after fetching from Supabase
 * Allows offline access to picklist team rankings
 */
export async function cachePicklistEntries(entries: any[]): Promise<void> {
  return invoke<void>("cache_picklist_entries", { entries });
}
