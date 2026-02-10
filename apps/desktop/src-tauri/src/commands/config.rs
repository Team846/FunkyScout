use crate::store::AppConfig;
use std::sync::Mutex;
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
