use crate::store::AppConfig;
use std::sync::{Arc, Mutex};
use tauri::State;

/// Save app configuration to store
#[tauri::command]
pub async fn save_config(
    state: State<'_, Mutex<crate::AppState>>,
    config: AppConfig,
) -> Result<(), String> {
    let event_arc = {
        let app_state = state.lock().unwrap();

        // Save to store
        app_state
            .app_store
            .store
            .set("config", serde_json::to_value(&config).unwrap());

        app_state
            .app_store
            .store
            .save()
            .map_err(|e| e.to_string())?;

        // Clone Arc before releasing lock so we can update it without holding the mutex
        Arc::clone(&app_state.current_event_shared)
    };

    // Update the shared event key so SyncService picks it up on the next sync cycle
    let sync_trigger = {
        let app_state = state.lock().unwrap();
        app_state.sync_trigger.clone()
    };
    if !config.event_key.is_empty() {
        let prev = event_arc.read().unwrap().clone();
        *event_arc.write().unwrap() = config.event_key.clone();
        println!("[Config] Updated current_event_shared to: {}", config.event_key);
        // Trigger an immediate sync when the event changes so local SQLite is
        // populated before the user tries to use scheduler/teams for the new event.
        if prev != config.event_key {
            if let Some(tx) = sync_trigger {
                let _ = tx.try_send(());
                println!("[Config] Triggered immediate sync for new event: {}", config.event_key);
            }
        }
    }

    println!("[Config] Saved: {:?}", config);
    Ok(())
}

/// Get current app configuration
#[tauri::command]
pub async fn get_config(state: State<'_, Mutex<crate::AppState>>) -> Result<AppConfig, String> {
    let app_state = state.lock().unwrap();
    Ok(app_state.app_store.get_config())
}

/// Set user JWT token for Supabase authentication
/// Writes to the shared Arc so the background SyncService can use it for RLS-authenticated writes.
/// Also persists the JWT to app_store.json so it can be restored at next startup (eliminates
/// the race window between Rust startup and the React effect calling this command).
#[tauri::command]
pub async fn set_user_jwt(
    state: State<'_, Mutex<crate::AppState>>,
    jwt: String,
) -> Result<(), String> {
    // Clone the Arc and store handle while holding the Mutex briefly, then release it
    let jwt_arc = {
        let app_state = state.lock().unwrap();
        // Persist to store so we can restore on next startup
        app_state.app_store.store.set("user_jwt", serde_json::Value::String(jwt.clone()));
        let _ = app_state.app_store.store.save().map_err(|e| eprintln!("[Auth] Failed to persist JWT: {}", e));
        Arc::clone(&app_state.user_jwt_shared)
    }; // Mutex released here — safe to await

    // Write the JWT to the shared Arc (accessible by SupabaseService without holding AppState mutex)
    *jwt_arc.write().unwrap() = Some(jwt);
    println!("[Auth] User JWT token updated (shared with SyncService, persisted to store)");
    Ok(())
}

/// Clear the persisted JWT token (called on logout)
#[tauri::command]
pub async fn clear_user_jwt(
    state: State<'_, Mutex<crate::AppState>>,
) -> Result<(), String> {
    let jwt_arc = {
        let app_state = state.lock().unwrap();
        app_state.app_store.store.delete("user_jwt");
        let _ = app_state.app_store.store.save().map_err(|e| eprintln!("[Auth] Failed to clear persisted JWT: {}", e));
        Arc::clone(&app_state.user_jwt_shared)
    };
    *jwt_arc.write().unwrap() = None;
    println!("[Auth] User JWT token cleared");
    Ok(())
}
