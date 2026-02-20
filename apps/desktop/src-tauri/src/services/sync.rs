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
    /// Updated after each successful sync — used to filter incremental fetches
    last_sync_time: std::sync::Mutex<Option<chrono::DateTime<chrono::Utc>>>,
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
            last_sync_time: std::sync::Mutex::new(None),
        }
    }

    /// Start background sync loop (120s interval + instant trigger)
    /// Syncs every 120s OR immediately when triggered
    pub async fn start_background_sync(self, mut trigger_rx: tokio::sync::mpsc::Receiver<()>) {
        let mut ticker = interval(Duration::from_secs(120));

        loop {
            tokio::select! {
                // Periodic sync every 120s
                _ = ticker.tick() => {
                    println!("[Sync] Periodic sync (120s interval)");
                    if let Err(e) = self.sync_once().await {
                        eprintln!("[Sync] Error during periodic sync: {:#}", e);
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

    /// Perform one sync cycle: External APIs → Supabase + Poll Supabase → Local cache
    /// 1. Processes sync queue (push local changes to Supabase)
    /// 2. Fetches TBA/Statbotics: rankings, EPA, OPR, match predictions → pushes to Supabase
    /// 3. Polls Supabase: picklists, match data, user profiles → caches locally
    pub async fn sync_once(&self) -> Result<()> {
        // 0. Process sync queue (desktop offline writes)
        if let Err(e) = self.process_sync_queue().await {
            eprintln!("[Sync] Queue processing failed: {}", e);
            // Don't return early - continue with TBA sync
        }

        // 1. Fetch ALL teams from TBA (not just statuses - we need all teams for EPA/OPR sync)
        let teams = match self.tba.fetch_event_teams(&self.current_event).await {
            Ok(data) => {
                println!("[Sync] TBA event teams fetched: {} teams", data.len());
                data
            },
            Err(e) => {
                eprintln!("[Sync] TBA event teams fetch failed: {}", e);
                // Return early - can't proceed without team list
                return Ok(());
            }
        };

        // 2. Fetch EPA from Statbotics - Try batch endpoint first, fallback to individual calls
        // Extract year from event code (e.g., "2025flor" -> "2025")
        let event_year = self.current_event.chars().take(4).collect::<String>();

        println!("[Sync] Fetching EPA for {} teams at event {}...", teams.len(), self.current_event);
        println!("[Sync] Attempting batch EPA fetch (1 API call)...");

        // Build set of team numbers at this event for filtering
        let event_team_nums: std::collections::HashSet<i32> = teams.iter()
            .map(|t| t.team)
            .collect();

        // Try batch endpoint first — fetches all teams for the year in 1 call
        let mut epa_data = Vec::new();
        match self.statbotics.fetch_event_team_years(&self.current_event, &event_year).await {
            Ok(team_years) => {
                println!("[Sync] ✓ Fetched {} total team EPAs for year {}", team_years.len(), event_year);

                // Filter to only teams at THIS event, then convert to (team_num, data) pairs
                epa_data = team_years
                    .into_iter()
                    .filter_map(|data| {
                        let team_num = data.get("team").and_then(|t| t.as_i64()).map(|t| t as i32)?;
                        if event_team_nums.contains(&team_num) {
                            Some((team_num, data))
                        } else {
                            None
                        }
                    })
                    .collect();

                println!("[Sync] ✓ Matched {}/{} event teams with EPA data", epa_data.len(), teams.len());
            },
            Err(e) => {
                // Statbotics may be temporarily unavailable (503, rate limit, etc).
                // Skip EPA this cycle — next sync will retry. Do NOT hammer with individual calls.
                eprintln!("[Sync] ✗ Statbotics batch EPA unavailable, skipping this cycle: {}", e);
            }
        }

        println!("[Sync] Final EPA data: {}/{} teams", epa_data.len(), teams.len());

        // 3. Fetch OPR/DPR from TBA (graceful fallback on error)
        let oprs = match self.tba.fetch_oprs(&self.current_event).await {
            Ok(data) => {
                let opr_count = data.get("oprs").and_then(|o| o.as_object()).map(|o| o.len()).unwrap_or(0);
                println!("[Sync] OPR data fetched: {} teams", opr_count);
                data
            },
            Err(e) => {
                eprintln!("[Sync] OPR fetch failed: {}", e);
                json!({})
            }
        };

        // 4. Build EPA lookup map (team_key -> EPA data)
        let epa_map: HashMap<String, &serde_json::Value> = epa_data
            .iter()
            .map(|(team_num, data)| {
                let team_key = format!("frc{}", team_num);
                (team_key, data)
            })
            .collect();

        println!("[Sync] EPA map built with {} teams (out of {} total teams)", epa_map.len(), teams.len());

        // Log teams missing EPA data
        if epa_map.len() < teams.len() {
            let missing_count = teams.len() - epa_map.len();
            println!("[Sync] {} teams missing EPA data (no {} data yet or Statbotics unavailable)", missing_count, event_year);
        }

        // 5. Transform TBA teams + EPA + OPR to comprehensive Supabase format
        // Include ALL teams at the event (not just teams with status)
        let team_data_records: Vec<serde_json::Value> = teams
            .into_iter()
            .map(|team| {
                let team_key = team.key.clone();

                // Use TeamRank fields directly (already parsed from TBA)
                let rank = team.rank as i64;
                let wins = team.record.wins as i64;
                let losses = team.record.losses as i64;
                let ties = team.record.ties as i64;
                let next_match = team.next_match;
                let last_match = team.last_match;

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

                // Extract OPR/DPR (OPR keys are in "frc10017" format, not "10017")
                let opr = oprs.get("oprs").and_then(|o| o.get(team_key.as_str())).and_then(|v| v.as_f64());
                let dpr = oprs.get("dprs").and_then(|d| d.get(team_key.as_str())).and_then(|v| v.as_f64());
                let ccwm = oprs.get("ccwms").and_then(|c| c.get(team_key.as_str())).and_then(|v| v.as_f64());

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

                json!({
                    "event": self.current_event,
                    "team": team_key,
                    "data": data,
                })
            })
            .collect();

        if !team_data_records.is_empty() {
            // Log how many teams have EPA/OPR data
            let teams_with_epa = team_data_records.iter()
                .filter(|r| r.get("data").and_then(|d| d.get("epa")).and_then(|e| e.as_object()).is_some())
                .count();
            let teams_with_opr = team_data_records.iter()
                .filter(|r| r.get("data").and_then(|d| d.get("opr")).is_some())
                .count();
            println!("[Sync] Pushing {} teams ({} with EPA, {} with OPR)",
                team_data_records.len(), teams_with_epa, teams_with_opr);

            // Cache to local SQLite FIRST (for offline support)
            self.cache_teams_to_sqlite(&team_data_records)
                .await
                .context("Failed to cache team data to SQLite")?;

            // Then push to Supabase with merge logic
            match self.supabase
                .bulk_upsert_team_data(&self.current_event, team_data_records.clone())
                .await
            {
                Ok(_) => println!("[Sync] ✓ Successfully pushed team data to Supabase"),
                Err(e) => {
                    eprintln!("[Sync] ✗ Failed to push team data to Supabase: {}", e);
                    return Err(e).context("Failed to push team data to Supabase");
                }
            }
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

        // 9.5. Fetch TBA score breakdowns to extract climb data (desktop-only, not synced to Supabase)
        match self.tba.fetch_match_breakdowns(&self.current_event).await {
            Ok(climb_entries) => {
                if !climb_entries.is_empty() {
                    println!("[Sync] TBA climb data fetched: {} entries", climb_entries.len());
                    self.cache_climb_to_sqlite(&climb_entries)
                        .await
                        .unwrap_or_else(|e| eprintln!("[Sync] Failed to cache TBA climb data: {}", e));
                }
            }
            Err(e) => {
                // Non-fatal: score breakdowns may not be available yet
                eprintln!("[Sync] TBA climb breakdown fetch skipped: {}", e);
            }
        }

        // Compute incremental sync window: only fetch records modified since last sync.
        // 5-minute buffer handles clock skew and edge cases.
        // On first sync (last_sync_time = None), fetches all rows for a full initial load.
        let since_iso: Option<String> = {
            let guard = self.last_sync_time.lock().unwrap();
            guard.as_ref().map(|dt| {
                (*dt - chrono::Duration::minutes(5)).to_rfc3339()
            })
        };
        let is_first_sync = since_iso.is_none();
        if is_first_sync {
            println!("[Sync] First sync — performing full table fetch");
        } else {
            println!("[Sync] Incremental fetch since: {}", since_iso.as_deref().unwrap_or("?"));
        }

        // 10. Fetch user profiles from Supabase and cache locally (always full — small table)
        let user_profiles = match self.supabase.fetch_user_profiles().await {
            Ok(profiles) => profiles,
            Err(e) => {
                eprintln!("[Sync] User profiles fetch failed: {}", e);
                vec![]
            }
        };

        if !user_profiles.is_empty() {
            self.cache_user_profiles_to_sqlite(&user_profiles)
                .await
                .context("Failed to cache user profiles to SQLite")?;
        }

        // 13. Poll Supabase for picklists (incremental)
        let picklists = match self.supabase.fetch_event_picklists(&self.current_event, since_iso.as_deref()).await {
            Ok(data) => {
                println!("[Sync] Supabase picklists fetched: {} (incremental)", data.len());
                data
            },
            Err(e) => {
                eprintln!("[Sync] Supabase picklists fetch failed: {}", e);
                vec![]
            }
        };

        if !picklists.is_empty() {
            self.cache_picklists_to_sqlite(&picklists)
                .await
                .context("Failed to cache picklists to SQLite")?;
        }

        // 14. Poll Supabase for picklist entries (incremental)
        let picklist_entries = match self.supabase.fetch_event_picklist_entries(&self.current_event, since_iso.as_deref()).await {
            Ok(data) => {
                println!("[Sync] Supabase picklist entries fetched: {} (incremental)", data.len());
                data
            },
            Err(e) => {
                eprintln!("[Sync] Supabase picklist entries fetch failed: {}", e);
                vec![]
            }
        };

        if !picklist_entries.is_empty() {
            self.cache_picklist_entries_to_sqlite(&picklist_entries)
                .await
                .context("Failed to cache picklist entries to SQLite")?;
        }

        // 15. Poll Supabase for match scouting data (INCREMENTAL — biggest egress driver)
        // Each data_raw is 5-15 KB; fetching all submissions every cycle is very expensive.
        // Incremental fetch: after first sync, only pull records modified in the last window.
        let match_data = match self.supabase.fetch_event_match_data(&self.current_event, since_iso.as_deref()).await {
            Ok(data) => {
                if is_first_sync {
                    println!("[Sync] Supabase match data full fetch: {} submissions", data.len());
                } else {
                    println!("[Sync] Supabase match data incremental: {} new/changed submissions", data.len());
                }
                data
            },
            Err(e) => {
                eprintln!("[Sync] Supabase match data fetch failed: {}", e);
                vec![]
            }
        };

        if !match_data.is_empty() {
            self.cache_match_data_to_sqlite(&match_data)
                .await
                .context("Failed to cache match data to SQLite")?;
        }

        // 16. Poll Supabase for team data — only changed rows (pit scouting from mobile scouts)
        // TBA stats are already cached locally in step 5; this only picks up mobile pit scouting changes.
        let team_data = match self.supabase.fetch_event_team_data(&self.current_event, since_iso.as_deref()).await {
            Ok(data) => {
                println!("[Sync] Supabase team data fetched: {} changed rows", data.len());
                data
            },
            Err(e) => {
                eprintln!("[Sync] Supabase team data fetch failed: {}", e);
                vec![]
            }
        };

        if !team_data.is_empty() {
            self.cache_teams_to_sqlite(&team_data)
                .await
                .context("Failed to cache team data to SQLite")?;
        }

        // 17. Poll Supabase for schedule — only changed rows (shift assignments from mobile)
        let schedule_data = match self.supabase.fetch_event_schedule(&self.current_event, since_iso.as_deref()).await {
            Ok(data) => {
                println!("[Sync] Supabase schedule fetched: {} changed rows", data.len());
                data
            },
            Err(e) => {
                eprintln!("[Sync] Supabase schedule fetch failed: {}", e);
                vec![]
            }
        };

        if !schedule_data.is_empty() {
            self.cache_schedule_to_sqlite(&schedule_data)
                .await
                .context("Failed to cache schedule to SQLite")?;
        }

        // Update last_sync_time for next cycle's incremental filter
        *self.last_sync_time.lock().unwrap() = Some(chrono::Utc::now());

        Ok(())
    }

    /// Cache TBA climb data to local SQLite (desktop-only, not synced to Supabase)
    async fn cache_climb_to_sqlite(&self, entries: &[crate::services::tba::MatchClimbEntry]) -> Result<()> {
        for entry in entries {
            sqlx::query(
                "INSERT INTO tba_match_climb (event, match_key, team, auto_climb, teleop_climb)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(event, match_key, team) DO UPDATE SET
                   auto_climb = excluded.auto_climb,
                   teleop_climb = excluded.teleop_climb"
            )
            .bind(&self.current_event)
            .bind(&entry.match_key)
            .bind(&entry.team)
            .bind(&entry.auto_climb)
            .bind(&entry.teleop_climb)
            .execute(&self.sqlx_pool)
            .await
            .context("Failed to cache TBA climb entry")?;
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

    /// Cache user profiles to local SQLite
    /// Matches Supabase structure for offline support
    async fn cache_user_profiles_to_sqlite(&self, profile_records: &[serde_json::Value]) -> Result<()> {
        if profile_records.is_empty() {
            return Ok(());
        }

        // Bulk insert/update user profiles
        for record in profile_records {
            let uid = record.get("uid").and_then(|v| v.as_str()).unwrap_or("");
            let name = record.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let role = record.get("role").and_then(|v| v.as_str()).unwrap_or("user");
            let settings_json = record.get("settings").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());

            // Convert PostgreSQL timestamptz to epoch milliseconds
            let last_modified = if let Some(ts_str) = record.get("last_modified").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
            } else {
                chrono::Utc::now().timestamp_millis()
            };

            sqlx::query(
                "INSERT INTO user_profiles (uid, name, role, settings, last_modified)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(uid) DO UPDATE SET
                   name = excluded.name,
                   role = excluded.role,
                   settings = excluded.settings,
                   last_modified = excluded.last_modified"
            )
            .bind(uid)
            .bind(name)
            .bind(role)
            .bind(&settings_json)
            .bind(last_modified)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache user profile {} to SQLite", uid))?;
        }

        println!("[Sync] Cached {} user profiles to SQLite", profile_records.len());
        Ok(())
    }

    /// Cache picklists to local SQLite
    /// Converts PostgreSQL timestamps to epoch milliseconds for mobile compatibility
    async fn cache_picklists_to_sqlite(&self, picklist_records: &[serde_json::Value]) -> Result<()> {
        if picklist_records.is_empty() {
            return Ok(());
        }

        for record in picklist_records {
            let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let title = record.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let uid = record.get("uid").and_then(|v| v.as_str()).unwrap_or("");
            let uname = record.get("uname").and_then(|v| v.as_str()).unwrap_or("");
            let type_str = record.get("type").and_then(|v| v.as_str()).unwrap_or("public");

            // Convert PostgreSQL timestamptz to epoch milliseconds
            let timestamp = if let Some(ts_str) = record.get("timestamp").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(0)
            } else {
                0
            };

            let last_modified = if let Some(ts_str) = record.get("last_modified").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
            } else {
                chrono::Utc::now().timestamp_millis()
            };

            sqlx::query(
                "INSERT INTO event_picklist (id, event, title, uid, uname, type, timestamp, last_modified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   uid = excluded.uid,
                   uname = excluded.uname,
                   type = excluded.type,
                   timestamp = excluded.timestamp,
                   last_modified = excluded.last_modified"
            )
            .bind(id)
            .bind(event)
            .bind(title)
            .bind(uid)
            .bind(uname)
            .bind(type_str)
            .bind(timestamp)
            .bind(last_modified)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache picklist {} to SQLite", id))?;
        }

        println!("[Sync] Cached {} picklists to SQLite", picklist_records.len());
        Ok(())
    }

    /// Cache picklist entries to local SQLite
    /// Converts PostgreSQL timestamps to epoch milliseconds for mobile compatibility
    async fn cache_picklist_entries_to_sqlite(&self, entry_records: &[serde_json::Value]) -> Result<()> {
        if entry_records.is_empty() {
            return Ok(());
        }

        for record in entry_records {
            let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let rank = record.get("rank").and_then(|v| v.as_i64()).unwrap_or(0);
            let flags_json = record.get("flags").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());

            let last_modified = if let Some(ts_str) = record.get("last_modified").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
            } else {
                chrono::Utc::now().timestamp_millis()
            };

            sqlx::query(
                "INSERT INTO event_picklist_entries (event, id, team, rank, flags, last_modified)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(event, id, team) DO UPDATE SET
                   rank = excluded.rank,
                   flags = excluded.flags,
                   last_modified = excluded.last_modified"
            )
            .bind(event)
            .bind(id)
            .bind(team)
            .bind(rank)
            .bind(&flags_json)
            .bind(last_modified)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache picklist entry {}/{} to SQLite", id, team))?;
        }

        println!("[Sync] Cached {} picklist entries to SQLite", entry_records.len());
        Ok(())
    }

    /// Cache match scouting data to local SQLite
    /// Converts PostgreSQL timestamps to epoch milliseconds for mobile compatibility
    async fn cache_match_data_to_sqlite(&self, match_records: &[serde_json::Value]) -> Result<()> {
        if match_records.is_empty() {
            return Ok(());
        }

        for record in match_records {
            let event = record.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let match_key = record.get("match").and_then(|v| v.as_str()).unwrap_or("");
            let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let alliance = record.get("alliance").and_then(|v| v.as_str());
            let data_raw_json = record.get("data_raw").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());
            let data_json = record.get("data").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());
            let name = record.get("name").and_then(|v| v.as_str());
            let uid = record.get("uid").and_then(|v| v.as_str()).unwrap_or("");

            // Convert PostgreSQL timestamptz to epoch milliseconds
            let timestamp = if let Some(ts_str) = record.get("timestamp").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(0)
            } else {
                0
            };

            let last_modified = if let Some(ts_str) = record.get("last_modified").and_then(|v| v.as_str()) {
                chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
            } else {
                chrono::Utc::now().timestamp_millis()
            };

            let deleted_at = if let Some(ts_str) = record.get("deleted_at").and_then(|v| v.as_str()) {
                Some(chrono::DateTime::parse_from_rfc3339(ts_str)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(0))
            } else {
                None
            };

            sqlx::query(
                "INSERT INTO event_match_data (event, match, team, alliance, data_raw, data, name, uid, timestamp, last_modified, deleted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(event, match, team) DO UPDATE SET
                   alliance = excluded.alliance,
                   data_raw = excluded.data_raw,
                   data = excluded.data,
                   name = excluded.name,
                   last_modified = excluded.last_modified,
                   deleted_at = excluded.deleted_at"
            )
            .bind(event)
            .bind(match_key)
            .bind(team)
            .bind(alliance)
            .bind(&data_raw_json)
            .bind(&data_json)
            .bind(name)
            .bind(uid)
            .bind(timestamp)
            .bind(last_modified)
            .bind(deleted_at)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache match data {}/{}/{} to SQLite", match_key, team, uid))?;
        }

        println!("[Sync] Cached {} match data submissions to SQLite", match_records.len());
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
                "UPDATE_USER_PROFILE" => self.sync_update_user_profile(payload).await,
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

        println!("[Sync] ✅ Created picklist '{}' in Supabase ({} teams)", title, entries.len());
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

        // Soft delete entries NOT in the new list (reduces postgres_changes events by 50%)
        let current_teams: Vec<String> = entries.iter()
            .filter_map(|e| e.get("team").and_then(|v| v.as_str()).map(String::from))
            .collect();

        self.supabase.soft_delete_removed_entries(id, &current_teams).await?;

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

        println!("[Sync] ✅ Updated picklist '{}' in Supabase ({} teams, soft-delete optimized)", title, entries.len());
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

        println!("[SyncQueue] PUT_MATCH_DATA: event={}, match={}, team={}, alliance={}",
            event, match_key, team, alliance);

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

        // Update Supabase (soft-delete)
        self.supabase.delete_match_data(event, match_key, team, uid, timestamp).await?;

        // Update local cache with deleted_at timestamp
        sqlx::query(
            "UPDATE event_match_data
             SET deleted_at = ?, last_modified = ?
             WHERE event = ? AND match = ? AND team = ? AND uid = ?"
        )
        .bind(timestamp)
        .bind(timestamp)
        .bind(event)
        .bind(match_key)
        .bind(team)
        .bind(uid)
        .execute(&self.sqlx_pool)
        .await
        .context("Failed to update local cache with deleted_at")?;

        println!("[Sync] Soft-deleted match data for {} in {} (local + Supabase)", team, match_key);

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

    /// Sync: Update user profile settings (scouter ratings)
    async fn sync_update_user_profile(&self, payload: serde_json::Value) -> Result<()> {
        let uid = payload.get("uid").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing uid"))?;
        let settings = payload.get("settings")
            .ok_or_else(|| anyhow::anyhow!("Missing settings"))?;

        self.supabase.update_user_profile_settings(uid, settings).await?;

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
