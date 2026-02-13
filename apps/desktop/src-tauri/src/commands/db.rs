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

/// Cache schedule data to SQLite (called by frontend after Supabase fetch)
#[tauri::command]
pub async fn cache_schedule(
    state: State<'_, Mutex<AppState>>,
    event: String,
    schedule: Vec<serde_json::Value>,
) -> Result<(), String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    // CRITICAL: Ensure event exists in event_list first (for foreign key constraint)
    sqlx::query(
        "INSERT INTO event_list (event, alias, date, last_modified)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event) DO UPDATE SET last_modified = excluded.last_modified"
    )
    .bind(&event)
    .bind(&event)
    .bind("")
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to ensure event exists: {}", e))?;

    for record in schedule {
        let match_key = record.get("match").and_then(|v| v.as_str()).unwrap_or("");
        let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
        let alliance = record.get("alliance").and_then(|v| v.as_str()).unwrap_or("");
        let name = record.get("name").and_then(|v| v.as_str());
        let uid = record.get("uid").and_then(|v| v.as_str());
        let est_time = record.get("est_time").and_then(|v| v.as_i64());
        let red_score = record.get("red_score").and_then(|v| v.as_i64());
        let blue_score = record.get("blue_score").and_then(|v| v.as_i64());
        let red_win_prob = record.get("red_win_prob").and_then(|v| v.as_f64());
        let predicted_red_score = record.get("predicted_red_score").and_then(|v| v.as_f64());
        let predicted_blue_score = record.get("predicted_blue_score").and_then(|v| v.as_f64());
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        sqlx::query(
            "INSERT INTO event_schedule (event, match, team, alliance, name, uid, est_time, red_score, blue_score, red_win_prob, predicted_red_score, predicted_blue_score, last_modified)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event, match, team) DO UPDATE SET
               alliance = excluded.alliance,
               name = excluded.name,
               uid = excluded.uid,
               est_time = excluded.est_time,
               red_score = excluded.red_score,
               blue_score = excluded.blue_score,
               red_win_prob = excluded.red_win_prob,
               predicted_red_score = excluded.predicted_red_score,
               predicted_blue_score = excluded.predicted_blue_score,
               last_modified = excluded.last_modified"
        )
        .bind(&event)
        .bind(match_key)
        .bind(team)
        .bind(alliance)
        .bind(name)
        .bind(uid)
        .bind(est_time)
        .bind(red_score)
        .bind(blue_score)
        .bind(red_win_prob)
        .bind(predicted_red_score)
        .bind(predicted_blue_score)
        .bind(last_modified)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache schedule: {}", e))?;
    }

    Ok(())
}

/// Cache picklists to SQLite (called by frontend after Supabase fetch)
#[tauri::command]
pub async fn cache_picklists(
    state: State<'_, Mutex<AppState>>,
    picklists: Vec<serde_json::Value>,
) -> Result<(), String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    // CRITICAL: Ensure all events exist in event_list first (for foreign key constraint)
    // Extract unique events from picklists
    let mut events: Vec<String> = picklists
        .iter()
        .filter_map(|p| p.get("event").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    events.sort();
    events.dedup();

    for event in events {
        sqlx::query(
            "INSERT INTO event_list (event, alias, date, last_modified)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(event) DO UPDATE SET last_modified = excluded.last_modified"
        )
        .bind(&event)
        .bind(&event)
        .bind("")
        .bind(chrono::Utc::now().timestamp_millis())
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to ensure event {} exists: {}", event, e))?;
    }

    for record in picklists {
        let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
        let title = record.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let uname = record.get("uname").and_then(|v| v.as_str()).unwrap_or("");
        let uid = record.get("uid").and_then(|v| v.as_str()).unwrap_or("");
        let picklist_type = record.get("type").and_then(|v| v.as_str()).unwrap_or("public");
        let timestamp = record.get("timestamp").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        sqlx::query(
            "INSERT INTO event_picklist (id, event, title, uname, uid, type, timestamp, last_modified)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               event = excluded.event,
               title = excluded.title,
               uname = excluded.uname,
               uid = excluded.uid,
               type = excluded.type,
               timestamp = excluded.timestamp,
               last_modified = excluded.last_modified"
        )
        .bind(id)
        .bind(event)
        .bind(title)
        .bind(uname)
        .bind(uid)
        .bind(picklist_type)
        .bind(timestamp)
        .bind(last_modified)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache picklist {}: {}", id, e))?;
    }

    Ok(())
}

/// Cache picklist entries to SQLite (called by frontend after Supabase fetch)
#[tauri::command]
pub async fn cache_picklist_entries(
    state: State<'_, Mutex<AppState>>,
    entries: Vec<serde_json::Value>,
) -> Result<(), String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    // CRITICAL: Ensure all events exist in event_list first (for foreign key constraint)
    // Extract unique events from entries
    let mut events: Vec<String> = entries
        .iter()
        .filter_map(|e| e.get("event").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    events.sort();
    events.dedup();

    for event in events {
        sqlx::query(
            "INSERT INTO event_list (event, alias, date, last_modified)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(event) DO UPDATE SET last_modified = excluded.last_modified"
        )
        .bind(&event)
        .bind(&event)
        .bind("")
        .bind(chrono::Utc::now().timestamp_millis())
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to ensure event {} exists: {}", event, e))?;
    }

    for record in entries {
        let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
        let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
        let rank = record.get("rank").and_then(|v| v.as_i64()).unwrap_or(0);
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        sqlx::query(
            "INSERT INTO event_picklist_entries (event, id, team, rank, last_modified)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(event, id, team) DO UPDATE SET
               rank = excluded.rank,
               last_modified = excluded.last_modified"
        )
        .bind(event)
        .bind(id)
        .bind(team)
        .bind(rank)
        .bind(last_modified)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache picklist entry: {}", e))?;
    }

    Ok(())
}
