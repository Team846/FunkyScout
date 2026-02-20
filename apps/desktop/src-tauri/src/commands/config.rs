use crate::store::AppConfig;
use std::sync::{Arc, Mutex};
use tauri::State;

/// Save app configuration to store
#[tauri::command]
pub async fn save_config(
    state: State<'_, Mutex<crate::AppState>>,
    config: AppConfig,
) -> Result<(), String> {
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
/// Writes to the shared Arc so the background SyncService can use it for RLS-authenticated writes
#[tauri::command]
pub async fn set_user_jwt(
    state: State<'_, Mutex<crate::AppState>>,
    jwt: String,
) -> Result<(), String> {
    // Clone the Arc while holding the Mutex briefly, then release it
    let jwt_arc = {
        let app_state = state.lock().unwrap();
        Arc::clone(&app_state.user_jwt_shared)
    }; // Mutex released here — safe to await

    // Write the JWT to the shared Arc (accessible by SupabaseService without holding AppState mutex)
    *jwt_arc.write().unwrap() = Some(jwt);
    println!("[Auth] User JWT token updated (shared with SyncService)");
    Ok(())
}
