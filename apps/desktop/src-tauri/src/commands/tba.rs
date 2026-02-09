use crate::services::tba::{MatchSchedule, TeamRank};
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex};
use tauri::State;

/// Fetch event teams with rankings from TBA
/// Makes 2 API calls - use only for bootstrap
#[tauri::command]
pub async fn fetch_tba_event_teams(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<Vec<TeamRank>, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    tba_service
        .fetch_event_teams(&event)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch only team statuses/rankings from TBA
/// Makes 1 API call - use for runtime polling
#[tauri::command]
pub async fn fetch_tba_team_statuses(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<HashMap<String, Value>, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    tba_service
        .fetch_team_statuses(&event)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch match schedule from TBA
#[tauri::command]
pub async fn fetch_tba_match_schedule(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<HashMap<String, MatchSchedule>, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    tba_service
        .fetch_match_schedule(&event)
        .await
        .map_err(|e| e.to_string())
}
