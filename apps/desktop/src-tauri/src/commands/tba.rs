use crate::services::tba::{MatchSchedule, TeamRank};
use serde_json::{json, Value};
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

/// Bootstrap a new event: seeds event_list, event_team_data, and event_schedule from TBA.
/// Returns the number of teams seeded.
#[tauri::command]
pub async fn bootstrap_event_schedule(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<usize, String> {
    let (tba_service, supabase_service) = {
        let app_state = state.lock().unwrap();
        (app_state.tba_service.clone(), app_state.supabase_service.clone())
    };

    println!("[Bootstrap] Starting bootstrap for {}", event);

    // Fetch event info, teams, and schedule in parallel
    let (event_info, teams, schedule) = tokio::try_join!(
        tba_service.fetch_event_info(&event),
        tba_service.fetch_event_teams(&event),
        tba_service.fetch_match_schedule(&event),
    ).map_err(|e| format!("TBA fetch failed: {}", e))?;

    let (alias, date) = event_info;

    // 1. Upsert event_list first (FK parent — must exist before child rows)
    supabase_service
        .upsert_event(&event, &alias, &date)
        .await
        .map_err(|e| format!("Failed to upsert event_list: {}", e))?;
    println!("[Bootstrap] ✓ event_list: {} ({})", event, alias);

    // 2. Seed event_team_data with basic team info from TBA.
    //    EPA/OPR will be filled in by the background sync once the event key is active.
    let team_count = teams.len();
    let team_records: Vec<Value> = teams
        .into_iter()
        .map(|team| json!({
            "event": event,
            "team": team.key,
            "team_name": team.name,
            "data": json!({
                "rank": team.rank,
                "record": {
                    "wins": team.record.wins,
                    "losses": team.record.losses,
                    "ties": team.record.ties,
                },
                "team_number": team.team,
            }),
        }))
        .collect();

    supabase_service
        .bulk_upsert_team_data(&event, team_records)
        .await
        .map_err(|e| format!("Failed to seed team data: {}", e))?;

    println!("[Bootstrap] ✓ event_team_data: {} teams seeded for {}", team_count, event);

    // 3. Seed event_schedule from TBA (all teams per match)
    let schedule_count = schedule.len();
    let schedule_records: Vec<Value> = schedule
        .into_iter()
        .flat_map(|(match_key, match_data)| {
            let mut records = Vec::new();
            let now = chrono::Utc::now().to_rfc3339();

            for team in &match_data.red_teams {
                records.push(json!({
                    "event": event,
                    "match": match_key,
                    "team": team,
                    "alliance": "red",
                    "est_time": match_data.est_time,
                    "red_score": match_data.red_score,
                    "blue_score": match_data.blue_score,
                    "last_modified": now,
                }));
            }
            for team in &match_data.blue_teams {
                records.push(json!({
                    "event": event,
                    "match": match_key,
                    "team": team,
                    "alliance": "blue",
                    "est_time": match_data.est_time,
                    "red_score": match_data.red_score,
                    "blue_score": match_data.blue_score,
                    "last_modified": now,
                }));
            }
            records
        })
        .collect();

    let schedule_row_count = schedule_records.len();
    println!("[Bootstrap] Seeding {} schedule rows ({} matches) to Supabase...", schedule_row_count, schedule_count);

    supabase_service
        .bootstrap_schedule(schedule_records)
        .await
        .map_err(|e| format!("Failed to seed schedule: {}", e))?;

    println!("[Bootstrap] ✓ Complete: {} teams, {} schedule rows seeded for {}", team_count, schedule_row_count, event);
    Ok(team_count)
}
