//! Sync Orchestration Service
//! Coordinates TBA → Local SQLite → Supabase data flow
//! Runs on 30-second interval to keep data fresh

use super::{SupabaseService, TbaService};
use anyhow::{Context, Result};
use serde_json::json;
use std::time::Duration;
use tokio::time::interval;

pub struct SyncService {
    tba: TbaService,
    supabase: SupabaseService,
    current_event: String,
}

impl SyncService {
    pub fn new(tba: TbaService, supabase: SupabaseService, current_event: String) -> Self {
        Self {
            tba,
            supabase,
            current_event,
        }
    }

    /// Start background sync loop (30s interval)
    pub async fn start_background_sync(mut self) {
        let mut ticker = interval(Duration::from_secs(30));

        loop {
            ticker.tick().await;

            if let Err(e) = self.sync_once().await {
                eprintln!("[Sync] Error during sync: {}", e);
            }
        }
    }

    /// Perform one sync cycle: TBA → Supabase
    /// Desktop doesn't write to local SQLite (mobile does that), we just push upstream
    pub async fn sync_once(&self) -> Result<()> {
        println!("[Sync] Starting sync cycle for event: {}", self.current_event);

        // 1. Fetch team statuses from TBA (rankings only, 1 API call)
        let statuses = self
            .tba
            .fetch_team_statuses(&self.current_event)
            .await
            .context("Failed to fetch team statuses from TBA")?;

        println!("[Sync] Fetched {} team statuses from TBA", statuses.len());

        // 2. Transform TBA statuses to Supabase format and push
        // Convert TBA statuses to team data records
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

                // Build data JSON with ranking info
                let data = json!({
                    "rank": rank,
                    "record": {
                        "wins": wins,
                        "losses": losses,
                        "ties": ties,
                    },
                    "tba_status": status,  // Store full TBA status for reference
                });

                Some(json!({
                    "event": self.current_event,
                    "team": team_key,
                    "data": data,
                }))
            })
            .collect();

        if !team_data_records.is_empty() {
            self.supabase
                .bulk_upsert_team_data(team_data_records)
                .await
                .context("Failed to push team data to Supabase")?;

            println!("[Sync] Pushed team data to Supabase");
        }

        // 3. Fetch match schedule from TBA and push
        let schedule = self
            .tba
            .fetch_match_schedule(&self.current_event)
            .await
            .context("Failed to fetch match schedule from TBA")?;

        println!("[Sync] Fetched {} matches from TBA", schedule.len());

        // Transform schedule to Supabase format
        let schedule_records: Vec<serde_json::Value> = schedule
            .into_iter()
            .flat_map(|(match_key, match_data)| {
                let mut records = Vec::new();

                // Red alliance
                for team in &match_data.red_teams {
                    records.push(json!({
                        "event": self.current_event,
                        "match": match_key,
                        "team": team,
                        "alliance": "red",
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
                        "last_modified": chrono::Utc::now().to_rfc3339(),
                    }));
                }

                records
            })
            .collect();

        if !schedule_records.is_empty() {
            self.supabase
                .bulk_upsert_schedule(schedule_records)
                .await
                .context("Failed to push schedule to Supabase")?;

            println!("[Sync] Pushed schedule to Supabase");
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
