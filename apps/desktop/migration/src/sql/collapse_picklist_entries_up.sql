-- Drop the event_picklist_entries table (local cache, data discarded)
-- Entries are now stored as a JSON array in event_picklist.picklist TEXT column
DROP TABLE IF EXISTS event_picklist_entries;
