/**
 * Supabase Schema Reference
 * Last synced: 2026-02-03
 *
 * This file documents the actual Supabase table structure for type safety
 * and reference when writing queries.
 */

// ============== ENUMS ==============

export type Alliance = "red" | "blue";
export type Role = "user" | "scouter" | "admin";
export type PickType = "public" | "default" | "private";
export type InviteCodeType = "promote.scouter" | "promote.admin";
export type Permission =
  | "data.view"
  | "data.write"
  | "schedule.view"
  | "schedule.write"
  | "event.write"
  | "profiles.view"
  | "profiles.write"
  | "picklist.write"
  | "picklist.view";

// ============== TABLES ==============

/**
 * event_list
 * PK: event
 */
export interface EventList {
  event: string; // e.g., "2026caav"
  alias: string; // display name
  date: string; // date type in postgres
  last_modified: string; // timestamptz
  deleted_at: string | null;
}

/**
 * event_team_data
 * PK: (event, team)
 * Stores pit scouting data for each team at an event
 */
export interface EventTeamData {
  event: string;
  team: string; // e.g., "frc254"
  data: Record<string, unknown> | null; // jsonb - pit scouting data
  team_name: string | null; // Team nickname from TBA (e.g., "Citrus Circuits")
  name: string | null; // scouter name who submitted pit data
  uid: string | null; // uuid of scouter
  assigned: string | null; // uuid of assigned scouter
  timestamp: string | null; // timestamptz
  last_modified: string;
  deleted_at: string | null;
}

/**
 * event_schedule
 * PK: (event, match, team)
 * Stores the match schedule - one row per team per match
 */
export interface EventSchedule {
  event: string;
  match: string; // e.g., "qm1", "sf1m1"
  team: string;
  alliance: Alliance;
  name: string | null; // assigned scouter name
  uid: string | null; // assigned scouter uuid
  last_modified: string;
  deleted_at: string | null;
}

/**
 * event_match_data
 * PK: (event, match, team)
 * Stores match scouting data
 * NOTE: Only data_raw is used, data column is unused
 */
export interface EventMatchData {
  event: string;
  match: string;
  team: string;
  alliance: Alliance;
  data_raw: Record<string, unknown> | null; // jsonb - raw scouting input
  data: Record<string, unknown> | null; // jsonb - UNUSED
  name: string | null; // scouter name
  uid: string | null; // scouter uuid
  timestamp: string | null;
  last_modified: string;
  deleted_at: string | null;
}

/**
 * event_picklist
 * PK: id
 * Each row is one picklist for an event
 * NOTE: picklist jsonb column is DEPRECATED - use event_picklist_entries instead
 */
export interface EventPicklist {
  id: string;
  event: string;
  title: string;
  picklist: unknown; // jsonb - DEPRECATED, do not use
  uname: string; // creator username
  uid: string; // creator uuid
  type: PickType;
  timestamp: string;
  last_modified: string;
  deleted_at: string | null;
}

/**
 * event_picklist_entries
 * PK: (event, id, team)
 * Each row is one team's position in a picklist
 * Links to event_picklist via id
 */
export interface EventPicklistEntry {
  event: string;
  id: string; // FK to event_picklist.id
  team: string;
  rank: number; // position in picklist
  flags: Record<string, unknown> | null; // jsonb - custom flags
  last_modified: string;
  deleted_at: string | null;
}

/**
 * user_profiles
 * PK: uid (FK to auth.users.id)
 */
export interface UserProfile {
  uid: string;
  name: string;
  role: Role;
  settings: Record<string, unknown>;
  last_modified: string;
  deleted_at: string | null;
}

/**
 * user_roles
 * PK: id
 * Maps roles to permissions
 */
export interface UserRole {
  id: number;
  role: Role;
  permission: Permission;
}

/**
 * invite_codes
 * PK: code
 */
export interface InviteCode {
  code: string;
  type: InviteCodeType;
  expiry: string; // timestamptz
  last_modified: string;
  deleted_at: string | null;
}

// ============== RELATIONSHIPS ==============
/*
event_list
  └── event_team_data (event)
  └── event_schedule (event)
  └── event_match_data (event)
  └── event_picklist (event)
      └── event_picklist_entries (event, id)

user_profiles (uid → auth.users.id)
*/
