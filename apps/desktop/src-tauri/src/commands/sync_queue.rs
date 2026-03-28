/**
 * Sync Queue Tauri Commands
 * Manages offline write queue for Supabase sync
 */

use tauri::State;
use std::sync::Mutex;
use crate::AppState;
use sea_orm::sqlx;

/// Add operation to sync queue
/// Called by frontend write operations (createPicklist, updatePicklist, etc.)
#[tauri::command]
pub async fn add_to_sync_queue(
    state: State<'_, Mutex<AppState>>,
    operation: String,
    payload: serde_json::Value,
) -> Result<i64, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let payload_str = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let result = sqlx::query(
        "INSERT INTO sync_queue (operation, payload, status) VALUES (?, ?, 'pending')"
    )
    .bind(&operation)
    .bind(&payload_str)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to add to sync queue: {}", e))?;

    let id = result.last_insert_rowid();
    println!("[SyncQueue] Added {} operation (id: {})", operation, id);

    Ok(id)
}

/// Get pending sync queue count
/// Used by UI to show pending operations badge
#[tauri::command]
pub async fn get_sync_queue_status(
    state: State<'_, Mutex<AppState>>,
) -> Result<SyncQueueStatus, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let pending: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get pending count: {}", e))?;

    let processing: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sync_queue WHERE status = 'processing'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get processing count: {}", e))?;

    let failed: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to get failed count: {}", e))?;

    Ok(SyncQueueStatus {
        pending: pending.0,
        processing: processing.0,
        failed: failed.0,
    })
}

/// Clear all failed sync queue items
/// Useful for debugging or after resolving persistent errors
#[tauri::command]
pub async fn clear_failed_sync_queue(
    state: State<'_, Mutex<AppState>>,
) -> Result<u64, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let result = sqlx::query(
        "DELETE FROM sync_queue WHERE status = 'failed'"
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to clear failed queue: {}", e))?;

    println!("[SyncQueue] Cleared {} failed items", result.rows_affected());
    Ok(result.rows_affected())
}

/// Retry failed sync queue items
/// Resets failed items back to pending for another attempt
#[tauri::command]
pub async fn retry_failed_sync_queue(
    state: State<'_, Mutex<AppState>>,
) -> Result<u64, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let result = sqlx::query(
        "UPDATE sync_queue SET status = 'pending', retries = 0, last_error = NULL WHERE status = 'failed'"
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to retry failed queue: {}", e))?;

    println!("[SyncQueue] Retrying {} failed items", result.rows_affected());
    Ok(result.rows_affected())
}

/// Trigger instant full sync (called by frontend after write operations)
/// Non-blocking - sends signal to sync service to run sync_once() immediately
#[tauri::command]
pub async fn trigger_sync_now(
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let app_state = state.lock().unwrap();

    if let Some(sync_trigger) = &app_state.sync_trigger {
        // Send signal (non-blocking)
        if let Err(e) = sync_trigger.try_send(()) {
            eprintln!("[SyncTrigger] Failed to send sync signal: {}", e);
            return Err(format!("Failed to trigger sync: {}", e));
        }
        println!("[SyncTrigger] Instant sync triggered by frontend");
        Ok(())
    } else {
        Err("Sync trigger not initialized".to_string())
    }
}

/// Trigger incremental sync for a single table (called by realtime event handlers).
/// Avoids a full sync cycle — only pulls the changed table, saves egress.
/// Valid tables: "event_match_data", "event_team_data", "event_picklist"
#[tauri::command]
pub async fn sync_table_now(
    state: State<'_, Mutex<AppState>>,
    table: String,
) -> Result<(), String> {
    let app_state = state.lock().unwrap();

    if let Some(table_sync_trigger) = &app_state.table_sync_trigger {
        if let Err(e) = table_sync_trigger.try_send(table.clone()) {
            eprintln!("[SyncTrigger] Failed to send table sync signal for {}: {}", table, e);
            return Err(format!("Failed to trigger table sync: {}", e));
        }
        println!("[SyncTrigger] Per-table sync triggered for: {}", table);
        Ok(())
    } else {
        Err("Table sync trigger not initialized".to_string())
    }
}

#[derive(serde::Serialize)]
pub struct SyncQueueStatus {
    pub pending: i64,
    pub processing: i64,
    pub failed: i64,
}
