//! Sync Orchestration Service
//! Coordinates TBA → Local SQLite → Supabase data flow
//! Runs on 30-second interval to keep data fresh

use super::{StatboticsService, SupabaseService, TbaService};
use anyhow::{Context, Result};
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::interval;

pub struct SyncService {
    tba: TbaService,
    supabase: SupabaseService,
    statbotics: StatboticsService,
    current_event: String,
}

impl SyncService {
    pub fn new(tba: TbaService, supabase: SupabaseService, statbotics: StatboticsService, current_event: String) -> Self {
        Self {
            tba,
            supabase,
            statbotics,
            current_event,
        }
    }

    /// Start background sync loop (30s interval)
    pub async fn start_background_sync(self) {
        let mut ticker = interval(Duration::from_secs(30));

        loop {
            ticker.tick().await;

            if let Err(e) = self.sync_once().await {
                eprintln!("[Sync] Error during sync: {}", e);
            }
        }
    }

    /// Perform one sync cycle: TBA + Statbotics → Supabase
    /// Fetches comprehensive data: rankings, EPA, OPR, match predictions
    pub async fn sync_once(&self) -> Result<()> {
        println!("[Sync] Starting sync cycle for event: {}", self.current_event);

        // 1. Fetch team statuses from TBA (rankings only, 1 API call)
        let statuses = self
            .tba
            .fetch_team_statuses(&self.current_event)
            .await
            .context("Failed to fetch team statuses from TBA")?;

        println!("[Sync] Fetched {} team statuses from TBA", statuses.len());

        // 2. Fetch EPA from Statbotics (graceful fallback on error)
        let epa_data = match self.statbotics.fetch_event_team_years(&self.current_event).await {
            Ok(data) => {
                println!("[Sync] Fetched {} team EPAs from Statbotics", data.len());
                data
            }
            Err(e) => {
                eprintln!("[Sync] Failed to fetch EPA from Statbotics (continuing without EPA): {}", e);
                vec![]
            }
        };

        // 3. Fetch OPR/DPR from TBA (graceful fallback on error)
        let oprs = match self.tba.fetch_oprs(&self.current_event).await {
            Ok(data) => {
                println!("[Sync] Fetched OPR data from TBA");
                data
            }
            Err(e) => {
                eprintln!("[Sync] Failed to fetch OPR from TBA (continuing without OPR): {}", e);
                json!({})
            }
        };

        // 4. Build EPA lookup map (team_key -> EPA data)
        let epa_map: HashMap<String, &serde_json::Value> = epa_data
            .iter()
            .filter_map(|team_year| {
                let team_num = team_year.get("team")?.as_i64()?;
                Some((format!("frc{}", team_num), team_year))
            })
            .collect();

        // 5. Transform TBA statuses + EPA + OPR to comprehensive Supabase format
        let team_data_records: Vec<serde_json::Value> = statuses
            .into_iter()
            .filter_map(|(team_key, status)| {
                // Extract rank and record
                let rank = status
                    .get("qual")?
                    .get("ranking")?
                    .get("rank")?
                    .as_i64()
                    .unwrap_or(0);

                let wins = status
                    .get("qual")?
                    .get("ranking")?
                    .get("record")?
                    .get("wins")?
                    .as_i64()
                    .unwrap_or(0);

                let losses = status
                    .get("qual")?
                    .get("ranking")?
                    .get("record")?
                    .get("losses")?
                    .as_i64()
                    .unwrap_or(0);

                let ties = status
                    .get("qual")?
                    .get("ranking")?
                    .get("record")?
                    .get("ties")?
                    .as_i64()
                    .unwrap_or(0);

                // Extract next/last match
                let next_match = status
                    .get("next_match_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let last_match = status
                    .get("last_match_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                // Build EPA object from Statbotics (if available)
                let epa_json = if let Some(epa) = epa_map.get(&team_key) {
                    json!({
                        "total_points": {
                            "mean": epa.get("epa").and_then(|e| e.get("total_points").and_then(|t| t.get("mean"))),
                            "sd": epa.get("epa").and_then(|e| e.get("total_points").and_then(|t| t.get("sd"))),
                        },
                        "auto": {
                            "mean": epa.get("epa").and_then(|e| e.get("auto").and_then(|a| a.get("mean"))),
                            "sd": epa.get("epa").and_then(|e| e.get("auto").and_then(|a| a.get("sd"))),
                        },
                        "teleop": {
                            "mean": epa.get("epa").and_then(|e| e.get("teleop").and_then(|t| t.get("mean"))),
                            "sd": epa.get("epa").and_then(|e| e.get("teleop").and_then(|t| t.get("sd"))),
                        },
                        "endgame": {
                            "mean": epa.get("epa").and_then(|e| e.get("endgame").and_then(|eg| eg.get("mean"))),
                            "sd": epa.get("epa").and_then(|e| e.get("endgame").and_then(|eg| eg.get("sd"))),
                        },
                        "norm": epa.get("epa").and_then(|e| e.get("norm")),
                    })
                } else {
                    json!(null)
                };

                // Extract OPR/DPR (OPR uses team number without "frc" prefix)
                let team_num = team_key.strip_prefix("frc").unwrap_or(&team_key);
                let opr = oprs.get("oprs").and_then(|o| o.get(team_num)).and_then(|v| v.as_f64());
                let dpr = oprs.get("dprs").and_then(|d| d.get(team_num)).and_then(|v| v.as_f64());
                let ccwm = oprs.get("ccwms").and_then(|c| c.get(team_num)).and_then(|v| v.as_f64());

                // Build comprehensive data JSON with ranking + EPA + OPR
                let data = json!({
                    "rank": rank,
                    "record": {
                        "wins": wins,
                        "losses": losses,
                        "ties": ties,
                    },
                    "next_match": next_match,
                    "last_match": last_match,
                    "epa": epa_json,
                    "opr": opr,
                    "dpr": dpr,
                    "ccwm": ccwm,
                });

                Some(json!({
                    "event": self.current_event,
                    "team": team_key,
                    "data": data,
                }))
            })
            .collect();

        if !team_data_records.is_empty() {
            let record_count = team_data_records.len();

            // Debug: Print first team record to verify data structure
            if let Some(first_record) = team_data_records.first() {
                println!("[Sync] DEBUG - Sample team record:");
                println!("{}", serde_json::to_string_pretty(first_record).unwrap_or_default());
            }

            self.supabase
                .bulk_upsert_team_data(team_data_records)
                .await
                .context("Failed to push team data to Supabase")?;

            println!("[Sync] Pushed {} team records with EPA/OPR to Supabase", record_count);
        }

        // 6. Fetch match schedule from TBA and push
        let schedule = self
            .tba
            .fetch_match_schedule(&self.current_event)
            .await
            .context("Failed to fetch match schedule from TBA")?;

        println!("[Sync] Fetched {} matches from TBA", schedule.len());

        // 7. Fetch Statbotics match predictions (graceful fallback on error)
        let predictions = match self.statbotics.fetch_event_matches(&self.current_event).await {
            Ok(data) => {
                println!("[Sync] Fetched {} match predictions from Statbotics", data.len());
                data
            }
            Err(e) => {
                eprintln!("[Sync] Failed to fetch match predictions from Statbotics (continuing without predictions): {}", e);
                vec![]
            }
        };

        // 8. Build prediction lookup map (match_key -> prediction data)
        let prediction_map: HashMap<String, &serde_json::Value> = predictions
            .iter()
            .filter_map(|pred| {
                let match_key = pred.get("key")?.as_str()?;
                Some((match_key.to_string(), pred))
            })
            .collect();

        // 9. Transform schedule to Supabase format with match data
        let schedule_records: Vec<serde_json::Value> = schedule
            .into_iter()
            .flat_map(|(match_key, match_data)| {
                let mut records = Vec::new();

                // Get prediction for this match
                let prediction = prediction_map.get(&match_key);
                let red_win_prob = prediction
                    .and_then(|p| p.get("pred"))
                    .and_then(|pr| pr.get("red_win_prob"))
                    .and_then(|v| v.as_f64());
                let predicted_red_score = prediction
                    .and_then(|p| p.get("pred"))
                    .and_then(|pr| pr.get("red_score"))
                    .and_then(|v| v.as_f64());
                let predicted_blue_score = prediction
                    .and_then(|p| p.get("pred"))
                    .and_then(|pr| pr.get("blue_score"))
                    .and_then(|v| v.as_f64());

                // Red alliance
                for team in &match_data.red_teams {
                    records.push(json!({
                        "event": self.current_event,
                        "match": match_key,
                        "team": team,
                        "alliance": "red",
                        "est_time": match_data.est_time,
                        "red_score": match_data.red_score,
                        "blue_score": match_data.blue_score,
                        "red_win_prob": red_win_prob,
                        "predicted_red_score": predicted_red_score,
                        "predicted_blue_score": predicted_blue_score,
                        "last_modified": chrono::Utc::now().to_rfc3339(),
                    }));
                }

                // Blue alliance
                for team in &match_data.blue_teams {
                    records.push(json!({
                        "event": self.current_event,
                        "match": match_key,
                        "team": team,
                        "alliance": "blue",
                        "est_time": match_data.est_time,
                        "red_score": match_data.red_score,
                        "blue_score": match_data.blue_score,
                        "red_win_prob": red_win_prob,
                        "predicted_red_score": predicted_red_score,
                        "predicted_blue_score": predicted_blue_score,
                        "last_modified": chrono::Utc::now().to_rfc3339(),
                    }));
                }

                records
            })
            .collect();

        if !schedule_records.is_empty() {
            let schedule_count = schedule_records.len();

            // Debug: Print first record to verify data structure
            if let Some(first_record) = schedule_records.first() {
                println!("[Sync] DEBUG - Sample schedule record:");
                println!("{}", serde_json::to_string_pretty(first_record).unwrap_or_default());
            }

            self.supabase
                .bulk_upsert_schedule(schedule_records)
                .await
                .context("Failed to push schedule to Supabase")?;

            println!("[Sync] Pushed {} schedule records with scores/predictions to Supabase", schedule_count);
        }

        println!("[Sync] Sync cycle complete");
        Ok(())
    }

    /// Update current event
    pub fn set_current_event(&mut self, event: String) {
        self.current_event = event;
        println!("[Sync] Current event updated to: {}", self.current_event);
    }

    /// Bootstrap: Full sync with team info (2 TBA API calls)
    /// Call this once when event is first selected
    pub async fn bootstrap_event(&self) -> Result<()> {
        println!("[Sync] Bootstrapping event: {}", self.current_event);

        // Fetch full team data (teams + rankings, 2 API calls)
        let teams = self
            .tba
            .fetch_event_teams(&self.current_event)
            .await
            .context("Failed to fetch teams from TBA")?;

        println!("[Sync] Fetched {} teams from TBA (bootstrap)", teams.len());

        // Push teams to Supabase
        let team_records: Vec<serde_json::Value> = teams
            .into_iter()
            .map(|team| {
                json!({
                    "event": self.current_event,
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
                })
            })
            .collect();

        self.supabase
            .bulk_upsert_team_data(team_records)
            .await
            .context("Failed to push teams to Supabase (bootstrap)")?;

        println!("[Sync] Bootstrap complete");
        Ok(())
    }
}
