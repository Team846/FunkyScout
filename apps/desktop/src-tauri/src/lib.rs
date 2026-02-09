use crate::{
    database::LocalDatabase,
    services::{SupabaseService, SyncService, TbaService},
    store::LocalStore,
};
use std::{process::Command, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub mod commands;
pub mod database;
pub mod entities;
pub mod request;
pub mod services;
pub mod store;

/// Helper to read env var with VITE_ prefix fallback
fn get_env(key: &str) -> Option<String> {
    std::env::var(key)
        .or_else(|_| std::env::var(format!("VITE_{}", key)))
        .ok()
        .filter(|s| !s.is_empty())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file if it exists (fallback for development)
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let state = AppState::new(&handle).await.expect("Failed to initialize AppState");
                let app_state = Mutex::new(state);

                // Read config from store, fallback to env vars
                let (tba_key, supabase_url, supabase_key, event_key) = {
                    let state = app_state.lock().unwrap();
                    let config = state.app_store.get_config();

                    // Use store values if present, otherwise try env vars (with VITE_ prefix)
                    let tba = if config.tba_key.is_empty() {
                        get_env("X_TBA_AUTH_KEY")
                            .or_else(|| get_env("TBA_API_KEY"))
                            .unwrap_or_default()
                    } else {
                        config.tba_key.clone()
                    };

                    let sb_url = if config.supabase_url.is_empty() {
                        get_env("SUPABASE_URL").unwrap_or_default()
                    } else {
                        config.supabase_url.clone()
                    };

                    let sb_key = if config.supabase_key.is_empty() {
                        get_env("SUPABASE_ANON_KEY")
                            .or_else(|| get_env("SUPABASE_KEY"))
                            .unwrap_or_default()
                    } else {
                        config.supabase_key.clone()
                    };

                    let evt = if config.event_key.is_empty() {
                        get_env("EVENT_KEY").unwrap_or_else(|| "2025casf".to_string())
                    } else {
                        config.event_key.clone()
                    };

                    (tba, sb_url, sb_key, evt)
                };

                handle.manage(app_state);

                // Start background sync service if configured
                if !tba_key.is_empty() && !supabase_url.is_empty() && !supabase_key.is_empty() {
                    println!("[App] Config loaded - TBA: {}, Supabase: {}, Event: {}",
                        !tba_key.is_empty(), !supabase_url.is_empty(), event_key);

                    let tba_service = TbaService::new(tba_key);
                    let supabase_service = SupabaseService::new(supabase_url, supabase_key);

                    let sync_service = SyncService::new(
                        tba_service,
                        supabase_service,
                        event_key,
                    );

                    println!("[App] Starting background sync service...");
                    sync_service.start_background_sync().await;
                } else {
                    println!("[App] Sync service not started - configure API keys");
                    println!("[App] Checked: Store and .env file");
                    println!("[App] Missing - TBA: {}, Supabase URL: {}, Supabase Key: {}",
                        tba_key.is_empty(), supabase_url.is_empty(), supabase_key.is_empty());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tba::fetch_tba_event_teams,
            commands::tba::fetch_tba_team_statuses,
            commands::tba::fetch_tba_match_schedule,
            commands::config::save_config,
            commands::config::get_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct AppState {
    database: Option<LocalDatabase>,
    pub app_store: LocalStore,
    pub app_handle: AppHandle,
    pub tba_service: TbaService,
    pub supabase_service: SupabaseService,
}

impl AppState {
    async fn new(app_handle: &AppHandle) -> Result<Self, anyhow::Error> {
        let database = LocalDatabase::new(app_handle).await?;

        let store = LocalStore::new(app_handle.store("app_store.json")?);

        // Read config from store
        let config = store.get_config();

        // Initialize services with config from store (or empty defaults)
        let tba_service = TbaService::new(config.tba_key.clone());
        let supabase_service = SupabaseService::new(
            config.supabase_url.clone(),
            config.supabase_key.clone(),
        );

        Ok(Self {
            database: Some(database),
            app_store: store,
            app_handle: app_handle.clone(),
            tba_service,
            supabase_service,
        })
    }

    /// Resets all app data, including the database and local stores,
    /// then closes and reopens the app.
    async fn reset(&mut self) -> Result<(), anyhow::Error> {
        self.database.take().unwrap().reset().await?;

        let executable =
            std::env::current_exe().expect("Should be able to access the executable's path");

        Command::new(executable)
            .spawn()
            .expect("Should be able to spawn a process to reopen the app");

        self.app_handle.cleanup_before_exit();
        self.app_handle.exit(0);

        Ok(())
    }

    // placeholder pelase fix
    pub fn curr_event(&self) -> &str {
        "2025casf"
    }
}

#[derive(Debug)]
pub enum AppError {
    DatabaseError(String),
}
