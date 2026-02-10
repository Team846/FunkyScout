-- Drop all tables in reverse dependency order

DROP TABLE IF EXISTS external_cache;
DROP TABLE IF EXISTS invite_codes;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS event_picklist_entries;
DROP TABLE IF EXISTS event_picklist;
DROP TABLE IF EXISTS event_match_data;
DROP TABLE IF EXISTS event_schedule;
DROP TABLE IF EXISTS event_team_data;
DROP TABLE IF EXISTS event_list;

PRAGMA journal_mode = DELETE;
