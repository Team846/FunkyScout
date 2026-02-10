use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Wry;
use tauri_plugin_store::Store;

pub struct LocalStore {
    pub store: Arc<Store<Wry>>,
}

impl LocalStore {
    pub fn new(store: Arc<Store<Wry>>) -> Self {
        Self { store }
    }

    /// Get a config value from the store
    pub fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.store.get(key).and_then(|v| serde_json::from_value(v).ok())
    }

    /// Get app config (all settings)
    pub fn get_config(&self) -> AppConfig {
        self.get("config").unwrap_or_default()
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub remote_url: String,
    pub supabase_url: String,
    pub supabase_key: String,
    pub tba_key: String,

    pub event_key: String,
    pub team_key: String,
}

