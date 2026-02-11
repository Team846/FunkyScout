-- ============================================================================
-- Desktop Sync Queue - Offline Write Queue for Supabase Sync
-- ============================================================================
-- This table queues write operations to be synced to Supabase when online
-- Similar to mobile's IndexedDB queue, but using SQLite for Tauri desktop
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,  -- "CREATE_PICKLIST", "UPDATE_PICKLIST", "PUT_TEAM_DATA", etc.
    payload TEXT NOT NULL,    -- JSON payload with operation data
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    retries INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt INTEGER,     -- Epoch milliseconds of last sync attempt
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue (status, created_at);
