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

/// Picklist from SQLite cache (entries embedded as JSON array in `picklist` field)
#[derive(Debug, serde::Serialize)]
pub struct Picklist {
    pub event: String,
    pub id: String,
    pub title: String,
    pub uname: String,
    pub uid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub picklist: serde_json::Value,  // JSON array of embedded entries
    pub timestamp: i64,
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
        "SELECT event, id, title, picklist, uname, uid, type, timestamp, last_modified
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
        .map(|row| {
            let picklist_str: Option<String> = row.try_get("picklist").ok();
            let picklist = picklist_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!([]));
            Picklist {
                event: row.try_get("event").unwrap_or_default(),
                id: row.try_get("id").unwrap_or_default(),
                title: row.try_get("title").unwrap_or_default(),
                r#type: row.try_get("type").ok(),
                picklist,
                uname: row.try_get("uname").unwrap_or_default(),
                uid: row.try_get("uid").unwrap_or_default(),
                timestamp: row.try_get("timestamp").unwrap_or(0),
                last_modified: row.try_get("last_modified").unwrap_or(0),
            }
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
        // Serialize embedded entries array to TEXT for SQLite storage
        let picklist_json = record.get("picklist")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "[]".to_string());
        let timestamp = record.get("timestamp").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let deleted_at = record.get("deleted_at").and_then(|v| v.as_i64());

        sqlx::query(
            "INSERT INTO event_picklist (id, event, title, picklist, uname, uid, type, timestamp, last_modified, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               event = excluded.event,
               title = excluded.title,
               picklist = excluded.picklist,
               uname = CASE WHEN excluded.uname != '' THEN excluded.uname ELSE event_picklist.uname END,
               uid = CASE WHEN excluded.uid != '' THEN excluded.uid ELSE event_picklist.uid END,
               type = excluded.type,
               timestamp = CASE WHEN excluded.timestamp != 0 THEN excluded.timestamp ELSE event_picklist.timestamp END,
               last_modified = excluded.last_modified,
               deleted_at = excluded.deleted_at"
        )
        .bind(id)
        .bind(event)
        .bind(title)
        .bind(&picklist_json)
        .bind(uname)
        .bind(uid)
        .bind(picklist_type)
        .bind(timestamp)
        .bind(last_modified)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache picklist {}: {}", id, e))?;
    }

    Ok(())
}

/// User profile from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct UserProfile {
    pub uid: String,
    pub name: String,
    pub role: String,
    pub settings: Option<JsonValue>,
    pub last_modified: i64,
}

#[tauri::command]
pub async fn get_user_profiles(
    state: State<'_, Mutex<AppState>>,
    uids: Option<Vec<String>>,
) -> Result<Vec<UserProfile>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    // Handle filtering based on uids parameter
    let rows = if let Some(uid_list) = uids {
        if uid_list.is_empty() {
            // Empty list - fetch all profiles
            sqlx::query(
                "SELECT uid, name, role, settings, last_modified
                 FROM user_profiles
                 WHERE deleted_at IS NULL
                 ORDER BY name"
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to query user profiles: {}", e))?
        } else {
            // Build IN clause with placeholders
            let placeholders = uid_list.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let query_str = format!(
                "SELECT uid, name, role, settings, last_modified
                 FROM user_profiles
                 WHERE uid IN ({}) AND deleted_at IS NULL
                 ORDER BY name",
                placeholders
            );

            let mut query = sqlx::query(&query_str);
            for uid in &uid_list {
                query = query.bind(uid);
            }

            query
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Failed to query user profiles: {}", e))?
        }
    } else {
        // No filter - fetch all profiles
        sqlx::query(
            "SELECT uid, name, role, settings, last_modified
             FROM user_profiles
             WHERE deleted_at IS NULL
             ORDER BY name"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to query user profiles: {}", e))?
    };

    Ok(rows
        .into_iter()
        .map(|row| {
            let settings_str: Option<String> = row.try_get("settings").ok();
            UserProfile {
                uid: row.try_get("uid").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                role: row.try_get("role").unwrap_or_default(),
                settings: settings_str.and_then(|s| serde_json::from_str(&s).ok()),
                last_modified: row.try_get("last_modified").unwrap_or(0),
            }
        })
        .collect())
}

/// Cache user profiles to SQLite (called by frontend after Supabase fetch)
#[tauri::command]
pub async fn cache_user_profiles(
    state: State<'_, Mutex<AppState>>,
    profiles: Vec<serde_json::Value>,
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

    for record in profiles {
        let uid = record.get("uid").and_then(|v| v.as_str()).unwrap_or("");
        let name = record.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let role = record.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        let settings = record.get("settings").cloned().unwrap_or(serde_json::json!({}));
        let settings_str = settings.to_string();
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let deleted_at = record.get("deleted_at").and_then(|v| v.as_i64());

        sqlx::query(
            "INSERT INTO user_profiles (uid, name, role, settings, last_modified, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(uid) DO UPDATE SET
               name = excluded.name,
               role = excluded.role,
               settings = excluded.settings,
               last_modified = excluded.last_modified,
               deleted_at = excluded.deleted_at"
        )
        .bind(uid)
        .bind(name)
        .bind(role)
        .bind(&settings_str)
        .bind(last_modified)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache user profile {}: {}", uid, e))?;
    }

    Ok(())
}

/// Pit scouting data from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct PitScoutingData {
    pub event: String,
    pub team: String,
    pub data: Option<JsonValue>,
    pub team_name: Option<String>,
    pub name: Option<String>,
    pub uid: Option<String>,
    pub assigned: Option<String>,
    pub timestamp: Option<i64>,
    pub last_modified: i64,
}

/// Fetch pit scouting data for an event from SQLite cache
#[tauri::command]
pub async fn get_pit_scouting_data(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<PitScoutingData>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let rows = sqlx::query(
        "SELECT event, team, data, team_name, name, uid, assigned, timestamp, last_modified
         FROM event_team_data
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY team"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query pit scouting data: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let data_str: Option<String> = row.try_get("data").ok();
            PitScoutingData {
                event: row.try_get("event").unwrap_or_default(),
                team: row.try_get("team").unwrap_or_default(),
                data: data_str.and_then(|d| serde_json::from_str(&d).ok()),
                team_name: row.try_get("team_name").ok(),
                name: row.try_get("name").ok(),
                uid: row.try_get("uid").ok(),
                assigned: row.try_get("assigned").ok(),
                timestamp: row.try_get("timestamp").ok(),
                last_modified: row.try_get("last_modified").unwrap_or(0),
            }
        })
        .collect())
}

/// Cache pit scouting data to SQLite (called by frontend after Supabase fetch).
/// Merges incoming data with existing (json_patch) so TBA stats and pit scouting
/// are preserved — never replaces one with the other.
#[tauri::command]
pub async fn cache_pit_scouting_data(
    state: State<'_, Mutex<AppState>>,
    data: Vec<serde_json::Value>,
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

    for record in data {
        let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
        let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
        // Strip nulls so json_patch doesn't erase existing keys (RFC 7396: null = delete)
        let data_json = match record.get("data") {
            Some(serde_json::Value::Object(obj)) => {
                let non_null: serde_json::Map<String, serde_json::Value> = obj
                    .iter()
                    .filter(|(_, v)| !v.is_null())
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect();
                serde_json::Value::Object(non_null).to_string()
            }
            Some(v) if !v.is_null() => v.to_string(),
            _ => "{}".to_string(),
        };
        let team_name = record.get("team_name").and_then(|v| v.as_str());
        let name = record.get("name").and_then(|v| v.as_str());
        let uid = record.get("uid").and_then(|v| v.as_str());
        let assigned = record.get("assigned").and_then(|v| v.as_str());
        let timestamp = record.get("timestamp").and_then(|v| v.as_i64());
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        // deleted_at from Supabase is an ISO string — convert to ms; None if not deleted
        let deleted_at = record.get("deleted_at").and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())))
        });

        sqlx::query(
            "INSERT INTO event_team_data (event, team, data, team_name, name, uid, assigned, timestamp, last_modified, deleted_at)
             VALUES (?, ?, json(?), ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event, team) DO UPDATE SET
               data = json_patch(COALESCE(event_team_data.data, '{}'), excluded.data),
               team_name = COALESCE(excluded.team_name, event_team_data.team_name),
               name = COALESCE(excluded.name, event_team_data.name),
               uid = COALESCE(excluded.uid, event_team_data.uid),
               assigned = COALESCE(excluded.assigned, event_team_data.assigned),
               timestamp = COALESCE(excluded.timestamp, event_team_data.timestamp),
               last_modified = excluded.last_modified,
               deleted_at = excluded.deleted_at"
        )
        .bind(event)
        .bind(team)
        .bind(&data_json)
        .bind(team_name)
        .bind(name)
        .bind(uid)
        .bind(assigned)
        .bind(timestamp)
        .bind(last_modified)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache pit scouting data for {}/{}: {}", event, team, e))?;
    }

    Ok(())
}

/// Match scouting data from SQLite cache
#[derive(Debug, serde::Serialize)]
pub struct MatchScoutingData {
    pub event: String,
    #[serde(rename = "match")]
    pub match_key: String,
    pub team: String,
    pub alliance: String,
    pub data_raw: Option<JsonValue>,
    pub data: Option<JsonValue>,
    pub name: Option<String>,
    pub uid: Option<String>,
    pub timestamp: Option<i64>,
    pub last_modified: i64,
}

/// Fetch match scouting data for an event from SQLite cache
#[tauri::command]
pub async fn get_match_scouting_data(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<MatchScoutingData>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let rows = sqlx::query(
        "SELECT event, match, team, alliance, data_raw, data, name, uid, timestamp, last_modified
         FROM event_match_data
         WHERE event = ? AND deleted_at IS NULL
         ORDER BY match, team"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query match scouting data: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let data_raw_str: Option<String> = row.try_get("data_raw").ok();
            let data_str: Option<String> = row.try_get("data").ok();
            MatchScoutingData {
                event: row.try_get("event").unwrap_or_default(),
                match_key: row.try_get("match").unwrap_or_default(),
                team: row.try_get("team").unwrap_or_default(),
                alliance: row.try_get("alliance").unwrap_or_default(),
                data_raw: data_raw_str.and_then(|d| serde_json::from_str(&d).ok()),
                data: data_str.and_then(|d| serde_json::from_str(&d).ok()),
                name: row.try_get("name").ok(),
                uid: row.try_get("uid").ok(),
                timestamp: row.try_get("timestamp").ok(),
                last_modified: row.try_get("last_modified").unwrap_or(0),
            }
        })
        .collect())
}

/// TBA climb entry (per team per match)
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct TbaClimbEntry {
    pub event: String,
    pub match_key: String,
    pub team: String,
    pub auto_climb: Option<String>,   // "L1", "L2", "L3", or null
    pub teleop_climb: Option<String>, // "L1", "L2", "L3", or null
}

/// Fetch cached TBA climb data for an event
#[tauri::command]
pub async fn get_tba_climb_data(
    state: State<'_, Mutex<AppState>>,
    event: String,
) -> Result<Vec<TbaClimbEntry>, String> {
    let pool = {
        let app_state = state.lock().unwrap();
        app_state
            .database
            .as_ref()
            .ok_or("Database not initialized")?
            .get_sqlx_pool()
            .clone()
    };

    let rows = sqlx::query(
        "SELECT event, match_key, team, auto_climb, teleop_climb
         FROM tba_match_climb
         WHERE event = ?
         ORDER BY match_key, team"
    )
    .bind(&event)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to query TBA climb data: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| TbaClimbEntry {
            event: row.try_get("event").unwrap_or_default(),
            match_key: row.try_get("match_key").unwrap_or_default(),
            team: row.try_get("team").unwrap_or_default(),
            auto_climb: row.try_get("auto_climb").ok().flatten(),
            teleop_climb: row.try_get("teleop_climb").ok().flatten(),
        })
        .collect())
}

/// Cache TBA climb data to SQLite (called by sync service after fetch_match_breakdowns)
#[tauri::command]
pub async fn cache_tba_climb_data(
    state: State<'_, Mutex<AppState>>,
    event: String,
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

    for record in entries {
        let match_key = record.get("match_key").and_then(|v| v.as_str()).unwrap_or("");
        let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
        let auto_climb = record.get("auto_climb").and_then(|v| v.as_str());
        let teleop_climb = record.get("teleop_climb").and_then(|v| v.as_str());

        sqlx::query(
            "INSERT INTO tba_match_climb (event, match_key, team, auto_climb, teleop_climb)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(event, match_key, team) DO UPDATE SET
               auto_climb = excluded.auto_climb,
               teleop_climb = excluded.teleop_climb"
        )
        .bind(&event)
        .bind(match_key)
        .bind(team)
        .bind(auto_climb)
        .bind(teleop_climb)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache TBA climb entry for {}/{}/{}: {}", event, match_key, team, e))?;
    }

    Ok(())
}

/// Cache match scouting data to SQLite (called by frontend after Supabase fetch)
#[tauri::command]
pub async fn cache_match_scouting_data(
    state: State<'_, Mutex<AppState>>,
    data: Vec<serde_json::Value>,
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

    for record in data {
        let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
        let match_key = record.get("match").and_then(|v| v.as_str()).unwrap_or("");
        let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
        let alliance = record.get("alliance").and_then(|v| v.as_str()).unwrap_or("");
        let data_raw_json = record.get("data_raw").cloned();
        let data_raw_str = data_raw_json.map(|d| d.to_string());
        let data_json = record.get("data").cloned();
        let data_str = data_json.map(|d| d.to_string());
        let name = record.get("name").and_then(|v| v.as_str());
        let uid = record.get("uid").and_then(|v| v.as_str());
        let timestamp = record.get("timestamp").and_then(|v| v.as_i64());
        let last_modified = record.get("last_modified").and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let deleted_at = record.get("deleted_at").and_then(|v| v.as_i64());

        sqlx::query(
            "INSERT INTO event_match_data (event, match, team, alliance, data_raw, data, name, uid, timestamp, last_modified, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event, match, team) DO UPDATE SET
               alliance = excluded.alliance,
               data_raw = excluded.data_raw,
               data = excluded.data,
               name = excluded.name,
               uid = excluded.uid,
               timestamp = excluded.timestamp,
               last_modified = excluded.last_modified,
               deleted_at = excluded.deleted_at"
        )
        .bind(event)
        .bind(match_key)
        .bind(team)
        .bind(alliance)
        .bind(data_raw_str)
        .bind(data_str)
        .bind(name)
        .bind(uid)
        .bind(timestamp)
        .bind(last_modified)
        .bind(deleted_at)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to cache match scouting data for {}/{}/{}: {}", event, match_key, team, e))?;
    }

    Ok(())
}

