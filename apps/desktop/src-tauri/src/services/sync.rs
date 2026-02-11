//! Sync Orchestration Service
//! Coordinates TBA → Local SQLite → Supabase data flow
//! Runs on 30-second interval to keep data fresh

use super::{StatboticsService, SupabaseService, TbaService};
use anyhow::{Context, Result};
use sea_orm::sqlx;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::interval;

pub struct SyncService {
    tba: TbaService,
    supabase: SupabaseService,
    statbotics: StatboticsService,
    current_event: String,
    sqlx_pool: sqlx::SqlitePool,
}

impl SyncService {
    pub fn new(
        tba: TbaService,
        supabase: SupabaseService,
        statbotics: StatboticsService,
        current_event: String,
        sqlx_pool: sqlx::SqlitePool,
    ) -> Self {
        Self {
            tba,
            supabase,
            statbotics,
            current_event,
            sqlx_pool,
        }
    }

    /// Start background sync loop (30s interval + instant trigger)
    /// Syncs every 30s OR immediately when triggered
    pub async fn start_background_sync(self, mut trigger_rx: tokio::sync::mpsc::Receiver<()>) {
        let mut ticker = interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                // Periodic sync every 30s
                _ = ticker.tick() => {
                    println!("[Sync] Periodic sync (30s interval)");
                    if let Err(e) = self.sync_once().await {
                        eprintln!("[Sync] Error during periodic sync: {}", e);
                    }
                }

                // Instant sync when triggered by write operations
                Some(_) = trigger_rx.recv() => {
                    println!("[Sync] Instant sync triggered by write operation");
                    if let Err(e) = self.sync_once().await {
                        eprintln!("[Sync] Error during instant sync: {}", e);
                    }
                }
            }
        }
    }

    /// Perform one sync cycle: TBA + Statbotics → Supabase + Process sync queue
    /// Fetches comprehensive data: rankings, EPA, OPR, match predictions
    pub async fn sync_once(&self) -> Result<()> {
        // 0. Process sync queue (desktop offline writes)
        if let Err(e) = self.process_sync_queue().await {
            eprintln!("[Sync] Queue processing failed: {}", e);
            // Don't return early - continue with TBA sync
        }

        // 1. Fetch team statuses from TBA (rankings only, 1 API call)
        let statuses = self
            .tba
            .fetch_team_statuses(&self.current_event)
            .await
            .context("Failed to fetch team statuses from TBA")?;

        // 2. Fetch EPA from Statbotics (graceful fallback on error)
        let epa_data = match self.statbotics.fetch_event_team_years(&self.current_event).await {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Sync] EPA fetch failed: {}", e);
                vec![]
            }
        };

        // 3. Fetch OPR/DPR from TBA (graceful fallback on error)
        let oprs = match self.tba.fetch_oprs(&self.current_event).await {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Sync] OPR fetch failed: {}", e);
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
                    "last_synced": chrono::Utc::now().timestamp_millis(), // For mobile TBA failsafe detection
                });

                Some(json!({
                    "event": self.current_event,
                    "team": team_key,
                    "data": data,
                }))
            })
            .collect();

        if !team_data_records.is_empty() {
            // Cache to local SQLite FIRST (for offline support)
            self.cache_teams_to_sqlite(&team_data_records)
                .await
                .context("Failed to cache team data to SQLite")?;

            // Then push to Supabase with merge logic
            self.supabase
                .bulk_upsert_team_data(&self.current_event, team_data_records)
                .await
                .context("Failed to push team data to Supabase")?;
        }

        // 6. Fetch match schedule from TBA and push
        let schedule = self
            .tba
            .fetch_match_schedule(&self.current_event)
            .await
            .context("Failed to fetch match schedule from TBA")?;

        // 7. Fetch Statbotics match predictions (graceful fallback on error)
        let predictions = match self.statbotics.fetch_event_matches(&self.current_event).await {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[Sync] Predictions fetch failed: {}", e);
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
            // Cache to local SQLite FIRST (for offline support)
            self.cache_schedule_to_sqlite(&schedule_records)
                .await
                .context("Failed to cache schedule to SQLite")?;

            // Then push to Supabase
            self.supabase
                .bulk_upsert_schedule(schedule_records)
                .await
                .context("Failed to push schedule to Supabase")?;
        }

        Ok(())
    }

    /// Cache team data to local SQLite
    /// Matches Supabase structure for offline support
    async fn cache_teams_to_sqlite(&self, team_records: &[serde_json::Value]) -> Result<()> {
        if team_records.is_empty() {
            return Ok(());
        }

        // Ensure event exists in event_list (for foreign key constraint)
        sqlx::query(
            "INSERT INTO event_list (event, alias, date, last_modified)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(event) DO UPDATE SET last_modified = excluded.last_modified"
        )
        .bind(&self.current_event)
        .bind(&self.current_event)
        .bind("")
        .bind(chrono::Utc::now().timestamp_millis())
        .execute(&self.sqlx_pool)
        .await
        .context("Failed to ensure event exists in event_list")?;

        // Bulk insert/update team data
        for record in team_records {
            let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let team_name = record.get("team_name").and_then(|v| v.as_str());
            let data_json = record.get("data").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());

            sqlx::query(
                "INSERT INTO event_team_data (event, team, team_name, data, last_modified)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(event, team) DO UPDATE SET
                   team_name = excluded.team_name,
                   data = excluded.data,
                   last_modified = excluded.last_modified"
            )
            .bind(&self.current_event)
            .bind(team)
            .bind(team_name)
            .bind(&data_json)
            .bind(chrono::Utc::now().timestamp_millis())
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache team {} to SQLite", team))?;
        }

        Ok(())
    }

    /// Cache schedule data to local SQLite
    /// Matches Supabase structure for offline support
    async fn cache_schedule_to_sqlite(&self, schedule_records: &[serde_json::Value]) -> Result<()> {
        if schedule_records.is_empty() {
            return Ok(());
        }

        // Bulk insert/update schedule data
        for record in schedule_records {
            let match_key = record.get("match").and_then(|v| v.as_str()).unwrap_or("");
            let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let alliance = record.get("alliance").and_then(|v| v.as_str()).unwrap_or("");
            let est_time = record.get("est_time").and_then(|v| v.as_i64());
            let red_score = record.get("red_score").and_then(|v| v.as_i64());
            let blue_score = record.get("blue_score").and_then(|v| v.as_i64());
            let red_win_prob = record.get("red_win_prob").and_then(|v| v.as_f64());
            let predicted_red_score = record.get("predicted_red_score").and_then(|v| v.as_f64());
            let predicted_blue_score = record.get("predicted_blue_score").and_then(|v| v.as_f64());

            sqlx::query(
                "INSERT INTO event_schedule (event, match, team, alliance, est_time, red_score, blue_score, red_win_prob, predicted_red_score, predicted_blue_score, last_modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(event, match, team) DO UPDATE SET
                   alliance = excluded.alliance,
                   est_time = excluded.est_time,
                   red_score = excluded.red_score,
                   blue_score = excluded.blue_score,
                   red_win_prob = excluded.red_win_prob,
                   predicted_red_score = excluded.predicted_red_score,
                   predicted_blue_score = excluded.predicted_blue_score,
                   last_modified = excluded.last_modified"
            )
            .bind(&self.current_event)
            .bind(match_key)
            .bind(team)
            .bind(alliance)
            .bind(est_time)
            .bind(red_score)
            .bind(blue_score)
            .bind(red_win_prob)
            .bind(predicted_red_score)
            .bind(predicted_blue_score)
            .bind(chrono::Utc::now().timestamp_millis())
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache schedule for match {} team {}", match_key, team))?;
        }

        Ok(())
    }

    /// Update current event
    pub fn set_current_event(&mut self, event: String) {
        self.current_event = event;
        println!("[Sync] Event changed to: {}", self.current_event);
    }

    /// Process sync queue: Push pending operations to Supabase
    /// Implements offline-first write queue with retry logic
    async fn process_sync_queue(&self) -> Result<()> {
        // Fetch pending queue items (limit to 10 per cycle to avoid blocking)
        let queue_items: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT id, operation, payload FROM sync_queue
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT 10"
        )
        .fetch_all(&self.sqlx_pool)
        .await
        .context("Failed to fetch sync queue items")?;

        if queue_items.is_empty() {
            return Ok(());
        }

        println!("[SyncQueue] Processing {} pending operations", queue_items.len());

        for (id, operation, payload_str) in queue_items {
            // Mark as processing
            sqlx::query("UPDATE sync_queue SET status = 'processing', last_attempt = ? WHERE id = ?")
                .bind(chrono::Utc::now().timestamp_millis())
                .bind(id)
                .execute(&self.sqlx_pool)
                .await?;

            // Parse payload
            let payload: serde_json::Value = match serde_json::from_str(&payload_str) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[SyncQueue] Invalid payload for operation {}: {}", id, e);
                    self.mark_queue_failed(id, format!("Invalid JSON payload: {}", e)).await?;
                    continue;
                }
            };

            // Execute operation
            let result = match operation.as_str() {
                "CREATE_PICKLIST" => self.sync_create_picklist(payload).await,
                "UPDATE_PICKLIST" => self.sync_update_picklist(payload).await,
                "DELETE_PICKLIST" => self.sync_delete_picklist(payload).await,
                "PUT_TEAM_DATA" => self.sync_put_team_data(payload).await,
                "PUT_MATCH_DATA" => self.sync_put_match_data(payload).await,
                "DELETE_MATCH_DATA" => self.sync_delete_match_data(payload).await,
                "ASSIGN_SHIFT" => self.sync_assign_shift(payload).await,
                _ => {
                    eprintln!("[SyncQueue] Unknown operation: {}", operation);
                    Err(anyhow::anyhow!("Unknown operation type"))
                }
            };

            match result {
                Ok(_) => {
                    // Remove from queue on success
                    sqlx::query("DELETE FROM sync_queue WHERE id = ?")
                        .bind(id)
                        .execute(&self.sqlx_pool)
                        .await?;
                    println!("[SyncQueue] ✓ Completed operation {} (id: {})", operation, id);
                }
                Err(e) => {
                    // Mark as failed with retry logic
                    self.mark_queue_failed(id, e.to_string()).await?;
                    eprintln!("[SyncQueue] ✗ Failed operation {} (id: {}): {}", operation, id, e);
                }
            }
        }

        Ok(())
    }

    /// Mark queue item as failed with retry limit
    async fn mark_queue_failed(&self, id: i64, error: String) -> Result<()> {
        let retries: (i64,) = sqlx::query_as(
            "SELECT retries FROM sync_queue WHERE id = ?"
        )
        .bind(id)
        .fetch_one(&self.sqlx_pool)
        .await?;

        let new_retries = retries.0 + 1;
        let status = if new_retries >= 5 { "failed" } else { "pending" };

        sqlx::query(
            "UPDATE sync_queue
             SET status = ?, retries = ?, last_error = ?, last_attempt = ?
             WHERE id = ?"
        )
        .bind(status)
        .bind(new_retries)
        .bind(error)
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(id)
        .execute(&self.sqlx_pool)
        .await?;

        Ok(())
    }

    /// Sync CREATE_PICKLIST operation to Supabase
    async fn sync_create_picklist(&self, payload: serde_json::Value) -> Result<()> {
        let id = payload.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing picklist id"))?;
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let title = payload.get("title").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing title"))?;
        let uid = payload.get("uid").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uid"))?;
        let uname = payload.get("uname").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uname"))?;
        let type_str = payload.get("type").and_then(|v| v.as_str()).unwrap_or("public");
        let timestamp = payload.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
        let entries = payload.get("entries").and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing entries"))?;

        // Create picklist header
        self.supabase.create_picklist(id, event, title, uid, uname, type_str, timestamp).await?;

        // Create picklist entries
        let entry_records: Vec<serde_json::Value> = entries.iter().map(|e| {
            json!({
                "id": id,
                "event": event,
                "team": e.get("team").and_then(|v| v.as_str()).unwrap_or(""),
                "rank": e.get("rank").and_then(|v| v.as_i64()).unwrap_or(0),
                "flags": e.get("flags").cloned().unwrap_or(json!({})),
            })
        }).collect();

        self.supabase.bulk_upsert_picklist_entries(event, entry_records).await?;

        Ok(())
    }

    /// Sync UPDATE_PICKLIST operation to Supabase
    async fn sync_update_picklist(&self, payload: serde_json::Value) -> Result<()> {
        let id = payload.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing picklist id"))?;
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let title = payload.get("title").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing title"))?;
        let entries = payload.get("entries").and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing entries"))?;

        // Update picklist header
        self.supabase.update_picklist(id, event, title).await?;

        // Delete old entries and insert new ones
        self.supabase.delete_picklist_entries(id).await?;

        let entry_records: Vec<serde_json::Value> = entries.iter().map(|e| {
            json!({
                "id": id,
                "event": event,
                "team": e.get("team").and_then(|v| v.as_str()).unwrap_or(""),
                "rank": e.get("rank").and_then(|v| v.as_i64()).unwrap_or(0),
                "flags": e.get("flags").cloned().unwrap_or(json!({})),
            })
        }).collect();

        self.supabase.bulk_upsert_picklist_entries(event, entry_records).await?;

        Ok(())
    }

    /// Sync DELETE_PICKLIST operation to Supabase
    async fn sync_delete_picklist(&self, payload: serde_json::Value) -> Result<()> {
        let id = payload.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing picklist id"))?;
        let _event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;

        self.supabase.delete_picklist(id).await?;

        Ok(())
    }

    /// Sync PUT_TEAM_DATA operation to Supabase
    async fn sync_put_team_data(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let team = payload.get("team").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing team"))?;
        let data = payload.get("data").cloned().unwrap_or(json!({}));
        let team_name = payload.get("teamName").and_then(|v| v.as_str());
        let name = payload.get("name").and_then(|v| v.as_str());
        let uid = payload.get("uid").and_then(|v| v.as_str());

        self.supabase.put_team_data(event, team, data, team_name, name, uid).await?;

        Ok(())
    }

    /// Sync PUT_MATCH_DATA operation to Supabase
    async fn sync_put_match_data(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let match_key = payload.get("match").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing match"))?;
        let team = payload.get("team").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing team"))?;
        let alliance = payload.get("alliance").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing alliance"))?;
        let data_raw = payload.get("dataRaw").cloned().unwrap_or(json!({}));
        let name = payload.get("name").and_then(|v| v.as_str());
        let uid = payload.get("uid").and_then(|v| v.as_str());

        self.supabase.put_match_data(event, match_key, team, alliance, data_raw, name, uid).await?;

        Ok(())
    }

    /// Sync DELETE_MATCH_DATA operation to Supabase
    async fn sync_delete_match_data(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let match_key = payload.get("match").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing match"))?;
        let team = payload.get("team").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing team"))?;
        let uid = payload.get("uid").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uid"))?;
        let timestamp = payload.get("timestamp").and_then(|v| v.as_i64())
            .ok_or_else(|| anyhow::anyhow!("Missing timestamp"))?;

        self.supabase.delete_match_data(event, match_key, team, uid, timestamp).await?;

        Ok(())
    }

    /// Sync ASSIGN_SHIFT operation to Supabase
    async fn sync_assign_shift(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let team = payload.get("team").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing team"))?;
        let uid = payload.get("uid").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uid"))?;
        let name = payload.get("name").and_then(|v| v.as_str());

        self.supabase.assign_shift(event, team, uid, name).await?;

        Ok(())
    }

    /// Bootstrap: Full sync with team info (2 TBA API calls)
    /// Call this once when event is first selected
    pub async fn bootstrap_event(&self) -> Result<()> {
        println!("[Sync] Bootstrapping: {}", self.current_event);

        // Fetch full team data (teams + rankings, 2 API calls)
        let teams = self
            .tba
            .fetch_event_teams(&self.current_event)
            .await
            .context("Failed to fetch teams from TBA")?;

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
            .bulk_upsert_team_data(&self.current_event, team_records)
            .await
            .context("Failed to push teams to Supabase (bootstrap)")?;

        println!("[Sync] Bootstrap complete for {}", self.current_event);
        Ok(())
    }
}
