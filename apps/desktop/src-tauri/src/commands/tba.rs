use crate::services::tba::{MatchSchedule, TeamRank};
use crate::services::StatboticsService;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::State;

/// Bootstrap event from pre-parsed CSV data (fallback when TBA is unavailable).
/// `teams` rows: { event, team, team_name, data }
/// `schedule` rows: { event, match, team, alliance, last_modified }
#[tauri::command]
pub async fn bootstrap_from_csv(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
    teams: Vec<Value>,
    schedule: Vec<Value>,
) -> Result<usize, String> {
    let (tba_service, supabase_service) = {
        let app_state = state.lock().unwrap();
        (app_state.tba_service.clone(), app_state.supabase_service.clone())
    };

    println!("[Bootstrap CSV] Starting CSV bootstrap for {}", event);

    // Try TBA for event alias/date; fall back to sensible defaults if unavailable
    let (alias, date) = match tba_service.fetch_event_info(&event).await {
        Ok(info) => info,
        Err(e) => {
            println!("[Bootstrap CSV] TBA unavailable ({}), using event key as alias", e);
            (event.clone(), chrono::Utc::now().format("%Y-%m-%d").to_string())
        }
    };

    // 1. Upsert event_list (FK parent — must exist before child rows)
    supabase_service
        .upsert_event(&event, &alias, &date)
        .await
        .map_err(|e| format!("Failed to upsert event_list: {}", e))?;
    println!("[Bootstrap CSV] ✓ event_list: {} ({})", event, alias);

    // 2. Seed event_team_data
    let team_count = teams.len();
    if !teams.is_empty() {
        supabase_service
            .bulk_upsert_team_data(&event, teams)
            .await
            .map_err(|e| format!("Failed to seed team data: {}", e))?;
        println!("[Bootstrap CSV] ✓ event_team_data: {} teams seeded", team_count);
    }

    // 3. Seed event_schedule
    let schedule_count = schedule.len();
    if !schedule.is_empty() {
        supabase_service
            .bootstrap_schedule(schedule)
            .await
            .map_err(|e| format!("Failed to seed schedule: {}", e))?;
        println!("[Bootstrap CSV] ✓ event_schedule: {} rows seeded", schedule_count);
    }

    println!("[Bootstrap CSV] ✓ Complete: {} teams, {} schedule rows for {}", team_count, schedule_count, event);
    Ok(team_count)
}

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

    // 2. Seed event_team_data with team names only.
    //    rank/record/EPA are fetched from TBA/Statbotics directly on both mobile and desktop
    //    and kept in memory — they are never stored in the data JSONB column.
    let team_count = teams.len();
    let team_records: Vec<Value> = teams
        .into_iter()
        .map(|team| json!({
            "event": event,
            "team": team.key,
            "team_name": team.name,
            "data": {},
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
                    "last_modified": now,
                }));
            }
            for team in &match_data.blue_teams {
                records.push(json!({
                    "event": event,
                    "match": match_key,
                    "team": team,
                    "alliance": "blue",
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

/// Fetch ranking points for a specific match (score_breakdown.red/blue.rp)
#[tauri::command]
pub async fn fetch_match_rp(
    state: State<'_, Mutex<crate::AppState>>,
    match_key: String,
) -> Result<Value, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    let (red, blue) = tba_service
        .fetch_match_rp(&match_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "red": red, "blue": blue }))
}

/// Fetch all match videos for an event (YouTube IDs only, sanitized)
#[tauri::command]
pub async fn fetch_event_videos(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<Value, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    let matches = tba_service
        .fetch_event_videos(&event)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "data": matches }))
}

/// Fetch combined team stats for the rankings/EPA display.
/// Calls TBA statuses, TBA OPRs, and Statbotics EPA in parallel through the Rust backend
/// so the webview never makes direct external API calls (avoids CORS/ATS issues in Tauri).
/// Returns: map of team_key → { rank, record, nextMatch, lastMatch, epa, opr, dpr }
#[tauri::command]
pub async fn fetch_team_stats(
    state: State<'_, Mutex<crate::AppState>>,
    event: String,
) -> Result<HashMap<String, Value>, String> {
    let tba_service = state.lock().unwrap().tba_service.clone();
    let statbotics_service = StatboticsService::new();

    // Fetch TBA statuses, OPRs, and Statbotics EPA in parallel — all non-fatal on error
    let (statuses_result, oprs_result, epa_result) = tokio::join!(
        tba_service.fetch_team_statuses(&event),
        tba_service.fetch_oprs(&event),
        statbotics_service.fetch_event_team_events(&event),
    );

    let statuses = statuses_result.unwrap_or_default();
    let oprs = oprs_result.unwrap_or(Value::Null);
    let epa_entries = epa_result.unwrap_or_default();

    // Build EPA map: "frcXXXX" -> EPA object from Statbotics
    let mut epa_map: HashMap<String, Value> = HashMap::new();
    for entry in &epa_entries {
        if let Some(team_num) = entry["team"].as_i64() {
            epa_map.insert(format!("frc{}", team_num), entry["epa"].clone());
        }
    }

    // Merge into a single map keyed by team_key
    let result: HashMap<String, Value> = statuses
        .iter()
        .map(|(team_key, status)| {
            let entry = json!({
                "rank": status["qual"]["ranking"]["rank"].as_i64().unwrap_or(0),
                "record": {
                    "wins":   status["qual"]["ranking"]["record"]["wins"].as_i64().unwrap_or(0),
                    "losses": status["qual"]["ranking"]["record"]["losses"].as_i64().unwrap_or(0),
                    "ties":   status["qual"]["ranking"]["record"]["ties"].as_i64().unwrap_or(0),
                },
                "nextMatch": status["next_match_key"].as_str(),
                "lastMatch": status["last_match_key"].as_str(),
                "epa": epa_map.get(team_key).cloned().unwrap_or(Value::Null),
                "opr": oprs["oprs"][team_key].as_f64(),
                "dpr": oprs["dprs"][team_key].as_f64(),
            });
            (team_key.clone(), entry)
        })
        .collect();

    Ok(result)
}
