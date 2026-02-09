//! Database commands for reading from local SQLite cache
//! Used by frontend to access offline-first data

use crate::AppState;
use sea_orm::sqlx::{self, Row};
use serde_json::Value as JsonValue;
use std::sync::Mutex;
use tauri::State;

/// Team data from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct TeamData {
    pub event: String,
    pub team: String,
    pub team_name: Option<String>,
    pub data: Option<JsonValue>,
    pub last_modified: i64,
}

/// Schedule entry from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct ScheduleEntry {
    pub event: String,
    #[serde(rename = "match")]
    pub match_key: String,
    pub team: String,
    pub alliance: String,
    pub name: Option<String>,
    pub uid: Option<String>,
    pub est_time: Option<i64>,
    pub red_score: Option<i64>,
    pub blue_score: Option<i64>,
    pub red_win_prob: Option<f64>,
    pub predicted_red_score: Option<f64>,
    pub predicted_blue_score: Option<f64>,
    pub last_modified: i64,
}

/// Picklist from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct Picklist {
    pub event: String,
    pub id: String,
    pub title: String,
    pub uname: String,
    pub uid: String,
    pub timestamp: i64,
    pub last_modified: i64,
}

/// Picklist entry from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct PicklistEntry {
    pub event: String,
    pub id: String,
    pub team: String,
    pub rank: i64,
    pub last_modified: i64,
}

#[tauri::command]
pub async fn get_teams(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<TeamData>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    }; // MutexGuard dropped here

    let rows = sqlx::query(
        "SELECT event, team, team_name, data, last_modified
         FROM event_team_data
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY team"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query teams: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let data_str: Option<String> = row.try_get("data").ok();
            TeamData {
                event: row.try_get("event").unwrap_or_default(),
                team: row.try_get("team").unwrap_or_default(),
                team_name: row.try_get("team_name").ok(),
                data: data_str.and_then(|d| serde_json::from_str(&d).ok()),
                last_modified: row.try_get("last_modified").unwrap_or(0),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_schedule(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<ScheduleEntry>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    }; // MutexGuard dropped here

    let rows = sqlx::query(
        "SELECT event, match, team, alliance, name, uid,
                est_time, red_score, blue_score, red_win_prob,
                predicted_red_score, predicted_blue_score, last_modified
         FROM event_schedule
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY match, team"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query schedule: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| ScheduleEntry {
            event: row.try_get("event").unwrap_or_default(),
            match_key: row.try_get("match").unwrap_or_default(),
            team: row.try_get("team").unwrap_or_default(),
            alliance: row.try_get("alliance").unwrap_or_default(),
            name: row.try_get("name").ok(),
            uid: row.try_get("uid").ok(),
            est_time: row.try_get("est_time").ok(),
            red_score: row.try_get("red_score").ok(),
            blue_score: row.try_get("blue_score").ok(),
            red_win_prob: row.try_get("red_win_prob").ok(),
            predicted_red_score: row.try_get("predicted_red_score").ok(),
            predicted_blue_score: row.try_get("predicted_blue_score").ok(),
            last_modified: row.try_get("last_modified").unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
pub async fn get_picklists(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<Picklist>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    }; // MutexGuard dropped here

    let rows = sqlx::query(
        "SELECT event, id, title, uname, uid, timestamp, last_modified
         FROM event_picklist
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY timestamp DESC"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query picklists: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| Picklist {
            event: row.try_get("event").unwrap_or_default(),
            id: row.try_get("id").unwrap_or_default(),
            title: row.try_get("title").unwrap_or_default(),
            uname: row.try_get("uname").unwrap_or_default(),
            uid: row.try_get("uid").unwrap_or_default(),
            timestamp: row.try_get("timestamp").unwrap_or(0),
            last_modified: row.try_get("last_modified").unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
pub async fn get_picklist_entries(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<PicklistEntry>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    }; // MutexGuard dropped here

    let rows = sqlx::query(
        "SELECT event, id, team, rank, last_modified
         FROM event_picklist_entries
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY rank"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query picklist entries: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| PicklistEntry {
            event: row.try_get("event").unwrap_or_default(),
            id: row.try_get("id").unwrap_or_default(),
            team: row.try_get("team").unwrap_or_default(),
            rank: row.try_get("rank").unwrap_or(0),
            last_modified: row.try_get("last_modified").unwrap_or(0),
        })
        .collect())
}
