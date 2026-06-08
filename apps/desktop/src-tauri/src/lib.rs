use crate::{
    database::LocalDatabase,
    services::{StatboticsService, SupabaseService, SyncService, TbaService},
    store::LocalStore,
};
use std::{process::Command, sync::{Arc, Mutex, RwLock}};
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
        .plugin(tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_websocket::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Block until AppState is initialized and managed.
            // This ensures handle.manage() is called before setup() returns and the window
            // opens, preventing "state not managed" errors on fresh installs where migrations
            // run for the first time and the frontend fires commands before state is ready.
            //
            // block_in_place moves the current task off this thread so block_on can safely
            // run without deadlocking the tokio runtime that Tauri already started.
            tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(async {
                // Create sync trigger channel (for instant full sync on writes)
                let (sync_tx, sync_rx) = tokio::sync::mpsc::channel::<()>(100);
                // Create per-table sync trigger channel (for targeted incremental sync from realtime)
                let (table_sync_tx, table_sync_rx) = tokio::sync::mpsc::channel::<String>(100);

                let mut state = AppState::new(&handle).await.expect("Failed to initialize AppState");

                // Store triggers in AppState for Tauri commands
                state.sync_trigger = Some(sync_tx);
                state.table_sync_trigger = Some(table_sync_tx);

                // Read config from store, fallback to env vars
                let (tba_key, supabase_url, supabase_key, event_key, sqlx_pool) = {
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
                        get_env("SUPABASE_SERVICE_ROLE_KEY")
                            .or_else(|| get_env("SUPABASE_KEY"))
                            .or_else(|| get_env("SUPABASE_ANON_KEY"))
                            .unwrap_or_default()
                    } else {
                        config.supabase_key.clone()
                    };

                    let evt = if config.event_key.is_empty() {
                        get_env("EVENT_KEY").unwrap_or_else(|| "2025cada".to_string())
                    } else {
                        config.event_key.clone()
                    };

                    // Get SQLite pool BEFORE moving state into Mutex
                    let pool = state.database.as_ref()
                        .expect("Database should be initialized")
                        .get_sqlx_pool();

                    (tba, sb_url, sb_key, evt, pool)
                };

                // Clone Arcs before state moves into the Mutex
                let jwt_arc = Arc::clone(&state.user_jwt_shared);
                let event_arc = Arc::clone(&state.current_event_shared);

                // Manage state before returning — window won't open until this point
                handle.manage(Mutex::new(state));

                // Start background sync service if configured
                if !tba_key.is_empty() && !supabase_url.is_empty() && !supabase_key.is_empty() {
                    println!("[App] Config loaded - TBA: {}, Supabase: {}, Event: {}",
                        !tba_key.is_empty(), !supabase_url.is_empty(), event_key);

                    let tba_service = TbaService::new(tba_key);
                    let supabase_service = SupabaseService::new(supabase_url, supabase_key, Arc::clone(&jwt_arc));
                    let statbotics_service = StatboticsService::new();

                    let sync_service = SyncService::new(
                        tba_service,
                        supabase_service,
                        statbotics_service,
                        event_key,
                        event_arc,
                        sqlx_pool,
                    );

                    println!("[App] Starting background sync service with instant trigger...");
                    // Spawn sync service in background (don't await - it's an infinite loop!)
                    tauri::async_runtime::spawn(async move {
                        sync_service.start_background_sync(sync_rx, table_sync_rx).await;
                    });
                } else {
                    println!("[App] Sync service not started - configure API keys");
                    println!("[App] Checked: Store and .env file");
                    println!("[App] Missing - TBA: {}, Supabase URL: {}, Supabase Key: {}",
                        tba_key.is_empty(), supabase_url.is_empty(), supabase_key.is_empty());
                }
            }));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tba::fetch_tba_event_teams,
            commands::tba::fetch_tba_team_statuses,
            commands::tba::fetch_tba_match_schedule,
            commands::tba::fetch_team_stats,
            commands::tba::get_cached_team_stats,
            commands::tba::fetch_match_rp,
            commands::tba::fetch_event_videos,
            commands::tba::bootstrap_event_schedule,
            commands::tba::bootstrap_from_csv,
            commands::config::save_config,
            commands::config::get_config,
            commands::config::set_user_jwt,
            commands::config::clear_user_jwt,
            commands::db::get_teams,
            commands::db::get_schedule,
            commands::db::get_picklists,
            commands::db::get_user_profiles,
            commands::db::cache_schedule,
            commands::db::cache_picklists,
            commands::db::cache_user_profiles,
            commands::db::refresh_user_profiles_from_supabase,
            commands::db::get_pit_scouting_data,
            commands::db::cache_pit_scouting_data,
            commands::db::get_match_scouting_data,
            commands::db::cache_match_scouting_data,
            commands::db::get_tba_climb_data,
            commands::db::cache_tba_climb_data,
            commands::sync_queue::add_to_sync_queue,
            commands::sync_queue::get_sync_queue_status,
            commands::sync_queue::clear_failed_sync_queue,
            commands::sync_queue::retry_failed_sync_queue,
            commands::sync_queue::trigger_sync_now,
            commands::sync_queue::sync_table_now,
            commands::image_cache::cache_image,
            commands::image_cache::get_cached_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct AppState {
    pub database: Option<LocalDatabase>,
    pub app_store: LocalStore,
    pub app_handle: AppHandle,
    pub tba_service: TbaService,
    pub supabase_service: SupabaseService,
    pub sync_trigger: Option<tokio::sync::mpsc::Sender<()>>,
    /// Sends a table name to the sync loop for targeted incremental pulls (realtime events)
    pub table_sync_trigger: Option<tokio::sync::mpsc::Sender<String>>,
    /// Shared with SupabaseService — updated when user logs in via set_user_jwt command
    pub user_jwt_shared: Arc<RwLock<Option<String>>>,
    /// Shared with SyncService — updated by save_config when user changes events
    pub current_event_shared: Arc<RwLock<String>>,
}

impl AppState {
    async fn new(app_handle: &AppHandle) -> Result<Self, anyhow::Error> {
        let database = LocalDatabase::new(app_handle).await?;

        let store = LocalStore::new(app_handle.store("app_store.json")?);

        // Read config from store
        let config = store.get_config();

        // JWT Arc shared between AppState (written by set_user_jwt command) and SupabaseService (read on every write).
        // Restore from store so sync starts authenticated immediately (no startup race).
        let persisted_jwt: Option<String> = store.get("user_jwt");
        if persisted_jwt.is_some() {
            println!("[Auth] Restored persisted JWT from store — sync starts authenticated");
        }
        let user_jwt_shared: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(persisted_jwt));

        // Current event Arc shared between AppState (written by save_config) and SyncService (read per sync cycle)
        let initial_event = if config.event_key.is_empty() {
            get_env("EVENT_KEY").unwrap_or_default()
        } else {
            config.event_key.clone()
        };
        let current_event_shared: Arc<RwLock<String>> = Arc::new(RwLock::new(initial_event));

        // Resolve TBA key: store value first, then env var fallback (same as sync service setup)
        let tba_key = if !config.tba_key.is_empty() {
            config.tba_key.clone()
        } else {
            get_env("X_TBA_AUTH_KEY")
                .or_else(|| get_env("TBA_API_KEY"))
                .unwrap_or_default()
        };

        // Resolve Supabase key with env var fallback
        let supabase_url = if !config.supabase_url.is_empty() {
            config.supabase_url.clone()
        } else {
            get_env("SUPABASE_URL").unwrap_or_default()
        };
        let supabase_key = if !config.supabase_key.is_empty() {
            config.supabase_key.clone()
        } else {
            get_env("SUPABASE_SERVICE_ROLE_KEY")
                .or_else(|| get_env("SUPABASE_KEY"))
                .or_else(|| get_env("SUPABASE_ANON_KEY"))
                .unwrap_or_default()
        };

        // Initialize services with config from store (or empty defaults)
        let tba_service = TbaService::new(tba_key);
        let supabase_service = SupabaseService::new(
            supabase_url,
            supabase_key,
            Arc::clone(&user_jwt_shared),
        );

        Ok(Self {
            database: Some(database),
            app_store: store,
            app_handle: app_handle.clone(),
            tba_service,
            supabase_service,
            sync_trigger: None,       // Set later when channel is created
            table_sync_trigger: None, // Set later when channel is created
            user_jwt_shared,
            current_event_shared,
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
        "2025cada"
    }
}

#[derive(Debug)]
pub enum AppError {
    DatabaseError(String),
}
