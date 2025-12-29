use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Wry;
use tauri_plugin_store::Store;

pub struct LocalStore {
    store: Arc<Store<Wry>>,
}

impl LocalStore {
    pub fn new(store: Arc<Store<Wry>>) -> Self {
        Self { store }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub remote_url: String,
    pub supabase_url: String,
    pub supabase_key: String,

    pub event_key: String,
    pub team_key: String,
}
