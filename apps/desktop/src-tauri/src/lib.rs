use crate::{database::LocalDatabase, store::LocalStore};
use std::{process::Command, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub mod database;
pub mod request;
pub mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let app_state = Mutex::new(AppState::new(&handle).await);
                handle.manage(app_state)
            });

            Ok(())
        })
        // .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct AppState {
    database: Option<LocalDatabase>,
    pub app_store: LocalStore,
    pub app_handle: AppHandle,
}

impl AppState {
    async fn new(app_handle: &AppHandle) -> Result<Self, anyhow::Error> {
        let database = LocalDatabase::new(app_handle).await?;

        let store = LocalStore::new(app_handle.store("app_store.json")?);

        Ok(Self {
            database: Some(database),
            app_store: store,
            app_handle: app_handle.clone(),
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
