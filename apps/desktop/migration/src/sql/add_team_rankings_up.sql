-- Add TBA ranking and Statbotics analytics columns to event_team_data
-- NOTE: These columns are no longer actively used (stats are kept in memory),
-- but the migration must remain to satisfy SeaORM's applied-migration integrity check.
ALTER TABLE event_team_data ADD COLUMN rank INTEGER;
ALTER TABLE event_team_data ADD COLUMN wins INTEGER;
ALTER TABLE event_team_data ADD COLUMN losses INTEGER;
ALTER TABLE event_team_data ADD COLUMN ties INTEGER;
ALTER TABLE event_team_data ADD COLUMN next_match TEXT;
ALTER TABLE event_team_data ADD COLUMN last_match TEXT;
ALTER TABLE event_team_data ADD COLUMN epa TEXT;
ALTER TABLE event_team_data ADD COLUMN opr REAL;
ALTER TABLE event_team_data ADD COLUMN dpr REAL;
ALTER TABLE event_team_data ADD COLUMN ccwm REAL;
