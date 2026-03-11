// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tokio::main]
async fn main() {
    // Logger is initialized by tauri-plugin-log inside funkyscout_lib::run().
    // Do NOT call tracing_subscriber::init() here — it would claim the global
    // logger first and cause tauri-plugin-log to panic with "already initialized".
    funkyscout_lib::run();
}

