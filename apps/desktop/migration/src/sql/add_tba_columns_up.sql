-- Add TBA match data columns to event_schedule
-- These columns are populated by desktop backend when syncing from TBA/Statbotics

ALTER TABLE event_schedule ADD COLUMN est_time INTEGER;
ALTER TABLE event_schedule ADD COLUMN red_score INTEGER;
ALTER TABLE event_schedule ADD COLUMN blue_score INTEGER;
ALTER TABLE event_schedule ADD COLUMN red_win_prob REAL;
ALTER TABLE event_schedule ADD COLUMN predicted_red_score REAL;
ALTER TABLE event_schedule ADD COLUMN predicted_blue_score REAL;
