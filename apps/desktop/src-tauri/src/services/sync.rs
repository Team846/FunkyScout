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
    /// Shared with AppState — updated by save_config when user changes events
    current_event_shared: std::sync::Arc<std::sync::RwLock<String>>,
    sqlx_pool: sqlx::SqlitePool,
    /// Updated after each successful sync — used to filter incremental fetches
    last_sync_time: std::sync::Mutex<Option<chrono::DateTime<chrono::Utc>>>,
    /// Snapshot of event_schedule as last pulled from Supabase.
    /// Passed to bulk_upsert_schedule so it can skip a redundant SELECT every 120s.
    schedule_snapshot: Vec<serde_json::Value>,
}

impl SyncService {
    pub fn new(
        tba: TbaService,
        supabase: SupabaseService,
        statbotics: StatboticsService,
        current_event: String,
        current_event_shared: std::sync::Arc<std::sync::RwLock<String>>,
        sqlx_pool: sqlx::SqlitePool,
    ) -> Self {
        Self {
            tba,
            supabase,
            statbotics,
            current_event: current_event.clone(),
            current_event_shared,
            sqlx_pool,
            last_sync_time: std::sync::Mutex::new(None),
            schedule_snapshot: Vec::new(),
        }
    }

    /// Merge newly pulled schedule rows into the in-memory snapshot.
    fn update_schedule_snapshot(&mut self, rows: &[serde_json::Value], is_full: bool) {
        if is_full {
            self.schedule_snapshot = rows.to_vec();
            return;
        }
        for row in rows {
            let mk = row.get("match").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let t = row.get("team").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if mk.is_empty() || t.is_empty() { continue; }
            match self.schedule_snapshot.iter().position(|r| {
                r.get("match").and_then(|v| v.as_str()).unwrap_or("") == mk
                    && r.get("team").and_then(|v| v.as_str()).unwrap_or("") == t
            }) {
                Some(pos) => self.schedule_snapshot[pos] = row.clone(),
                None => self.schedule_snapshot.push(row.clone()),
            }
        }
    }

    /// Start background sync loop (120s interval + instant full trigger + per-table trigger)
    /// Full sync every 120s OR immediately when triggered. Per-table sync for realtime events.
    pub async fn start_background_sync(
        mut self,
        mut trigger_rx: tokio::sync::mpsc::Receiver<()>,
        mut table_trigger_rx: tokio::sync::mpsc::Receiver<String>,
    ) {
        let mut ticker = interval(Duration::from_secs(120));

        loop {
            tokio::select! {
                // Periodic sync every 120s
                _ = ticker.tick() => {
                    // Refresh current event in case user changed events since last sync
                    let ev = self.current_event_shared.read().unwrap().clone();
                    if !ev.is_empty() && ev != self.current_event {
                        self.current_event = ev;
                        // Clear schedule snapshot — it belongs to the old event
                        self.schedule_snapshot.clear();
                    } else if !ev.is_empty() {
                        self.current_event = ev;
                    }
                    println!("[Sync] Periodic sync (120s interval)");
                    if let Err(e) = self.sync_once().await {
                        eprintln!("[Sync] Error during periodic sync: {:#}", e);
                    }
                }

                // Instant full sync when triggered by write operations
                Some(_) = trigger_rx.recv() => {
                    // Drain any burst triggers that arrived before sync starts
                    while trigger_rx.try_recv().is_ok() {}
                    // Refresh current event in case user changed events
                    let ev = self.current_event_shared.read().unwrap().clone();
                    if !ev.is_empty() { self.current_event = ev; }
                    println!("[Sync] Instant sync triggered by write operation");
                    if let Err(e) = self.sync_once().await {
                        eprintln!("[Sync] Error during instant sync: {}", e);
                    }
                    // Drain any triggers that queued up DURING sync — no need for a
                    // redundant second sync cycle; data was just fully refreshed.
                    while trigger_rx.try_recv().is_ok() {}
                }

                // Per-table incremental sync triggered by realtime events (avoids full sync)
                Some(table) = table_trigger_rx.recv() => {
                    // Drain duplicates for the same table that arrived during debounce
                    while table_trigger_rx.try_recv().is_ok() {}
                    let ev = self.current_event_shared.read().unwrap().clone();
                    if !ev.is_empty() { self.current_event = ev.clone(); }
                    println!("[Sync] Per-table sync triggered for: {}", table);
                    if let Err(e) = self.sync_table_only(&table).await {
                        eprintln!("[Sync] Error during per-table sync ({}): {}", table, e);
                    }
                }
            }
        }
    }

    /// Incrementally sync a single table from Supabase — used by realtime event handlers
    /// so they don't trigger a wasteful full sync cycle (TBA, schedule, user_profiles, etc.)
    /// Always uses last_sync_time - 1min buffer, same as sync_once().
    async fn sync_table_only(&self, table: &str) -> Result<()> {
        let since_iso: Option<String> = {
            let guard = self.last_sync_time.lock().unwrap();
            guard.as_ref().map(|dt| {
                (*dt - chrono::Duration::minutes(1)).to_rfc3339()
            })
        };

        match table {
            "event_match_data" => {
                let since = if self.sqlite_has_rows("event_match_data", &self.current_event).await {
                    since_iso.as_deref()
                } else {
                    None
                };
                match self.supabase.fetch_event_match_data(&self.current_event, since).await {
                    Ok(data) if !data.is_empty() => {
                        println!("[Sync] event_match_data (table-only): {} rows", data.len());
                        self.cache_match_data_to_sqlite(&data).await?;
                    }
                    Ok(_) => println!("[Sync] event_match_data (table-only): no new rows"),
                    Err(e) => eprintln!("[Sync] event_match_data table-only fetch failed: {}", e),
                }
            }
            "event_team_data" => {
                let since = if self.sqlite_has_rows("event_team_data", &self.current_event).await {
                    since_iso.as_deref()
                } else {
                    None
                };
                match self.supabase.fetch_event_team_data(&self.current_event, since).await {
                    Ok(data) if !data.is_empty() => {
                        println!("[Sync] event_team_data (table-only): {} rows", data.len());
                        self.cache_teams_to_sqlite(&data).await?;
                    }
                    Ok(_) => println!("[Sync] event_team_data (table-only): no new rows"),
                    Err(e) => eprintln!("[Sync] event_team_data table-only fetch failed: {}", e),
                }
            }
            "event_picklist" => {
                let since = if self.sqlite_has_rows("event_picklist", &self.current_event).await {
                    since_iso.as_deref()
                } else {
                    None
                };
                match self.supabase.fetch_event_picklists(&self.current_event, since).await {
                    Ok(data) if !data.is_empty() => {
                        println!("[Sync] event_picklist (table-only): {} rows", data.len());
                        self.cache_picklists_to_sqlite(&data).await?;
                    }
                    Ok(_) => println!("[Sync] event_picklist (table-only): no new rows"),
                    Err(e) => eprintln!("[Sync] event_picklist table-only fetch failed: {}", e),
                }
            }
            _ => eprintln!("[Sync] sync_table_only: unknown table '{}'", table),
        }

        Ok(())
    }

    /// Perform one sync cycle:
    /// 1. Processes sync queue (push local changes to Supabase)
    /// 2. Polls Supabase: picklists, match data, team data, schedule → caches locally (FIRST for realtime)
    /// 3. Fetches TBA/Statbotics: rankings, EPA, OPR, match predictions → pushes to Supabase
    pub async fn sync_once(&mut self) -> Result<()> {
        // 0. Process sync queue (desktop offline writes)
        if let Err(e) = self.process_sync_queue().await {
            eprintln!("[Sync] Queue processing failed: {}", e);
            // Don't return early - continue with TBA sync
        }

        // Pull from Supabase FIRST so realtime-triggered syncs reflect mobile writes quickly.
        // TBA/Statbotics push follows — it's slower (external APIs) but non-urgent for realtime.
        let since_iso: Option<String> = {
            let guard = self.last_sync_time.lock().unwrap();
            guard.as_ref().map(|dt| {
                (*dt - chrono::Duration::minutes(1)).to_rfc3339()
            })
        };
        let is_first_sync = since_iso.is_none();
        if is_first_sync {
            println!("[Sync] First sync — performing full table fetch");
        } else {
            println!("[Sync] Incremental fetch since: {}", since_iso.as_deref().unwrap_or("?"));
        }

        // 1. Fetch user profiles — incremental if SQLite has rows, full if empty (auto-heal).
        // Full fetch also propagates deletions (supabase.rs: no deleted_at filter when since=None).
        let profile_since = if self.sqlite_has_rows_global("user_profiles").await {
            since_iso.as_deref()
        } else {
            println!("[Sync] user_profiles empty — forcing full fetch to heal cache");
            None
        };
        let user_profiles = match self.supabase.fetch_user_profiles(profile_since).await {
            Ok(profiles) => {
                println!("[Sync] User profiles fetched: {} ({})", profiles.len(),
                    if profile_since.is_some() { "incremental" } else { "full" });
                profiles
            },
            Err(e) => {
                eprintln!("[Sync] User profiles fetch failed: {}", e);
                vec![]
            }
        };
        if !user_profiles.is_empty() {
            self.cache_user_profiles_to_sqlite(&user_profiles, profile_since.is_none())
                .await
                .context("Failed to cache user profiles to SQLite")?;
        }

        // 2. Fetch picklists — incremental if SQLite has rows, full if empty (auto-heal).
        // Full fetch includes deleted rows so deletions propagate to SQLite (no deleted_at filter).
        let picklist_since = if self.sqlite_has_rows("event_picklist", &self.current_event).await {
            since_iso.as_deref()
        } else {
            println!("[Sync] event_picklist empty — forcing full fetch to heal cache");
            None
        };
        let picklists = match self.supabase.fetch_event_picklists(&self.current_event, picklist_since).await {
            Ok(data) => {
                println!("[Sync] Picklists fetched: {} ({})", data.len(),
                    if picklist_since.is_some() { "incremental" } else { "full" });
                data
            },
            Err(e) => {
                eprintln!("[Sync] Picklists fetch failed: {}", e);
                vec![]
            }
        };
        if !picklists.is_empty() {
            self.cache_picklists_to_sqlite(&picklists)
                .await
                .context("Failed to cache picklists to SQLite")?;
        }

        // 3. Fetch match scouting data — incremental if SQLite has rows, full if empty.
        // EGRESS NOTE: Each data_raw is 5-15 KB; incremental is critical for large datasets.
        // Full fetch only happens when the table is empty (first use or after migration wipe).
        let match_since = if self.sqlite_has_rows("event_match_data", &self.current_event).await {
            since_iso.as_deref()
        } else {
            println!("[Sync] event_match_data empty — forcing full fetch to heal cache");
            None
        };
        let match_data = match self.supabase.fetch_event_match_data(&self.current_event, match_since).await {
            Ok(data) => {
                println!("[Sync] Match data fetched: {} submissions ({})", data.len(),
                    if match_since.is_some() { "incremental" } else { "full" });
                data
            },
            Err(e) => {
                eprintln!("[Sync] Match data fetch failed: {}", e);
                vec![]
            }
        };
        if !match_data.is_empty() {
            self.cache_match_data_to_sqlite(&match_data)
                .await
                .context("Failed to cache match data to SQLite")?;
        }

        // Reconcile on first sync after startup: catch old mobile deletions that are outside
        // the incremental window (their last_modified predates our sync window) or hidden by RLS.
        // Fetches only (match, team) keys — minimal egress.
        if is_first_sync {
            match self.supabase.fetch_active_match_keys(&self.current_event).await {
                Ok(active_keys) => {
                    if let Err(e) = self.reconcile_match_deletions(&active_keys).await {
                        eprintln!("[Sync] Match reconciliation error: {}", e);
                    }
                }
                Err(e) => {
                    eprintln!("[Sync] Failed to fetch active match keys for reconciliation: {}", e);
                }
            }
        }

        // 4. Fetch team data — incremental if SQLite has rows, full if empty.
        let team_since = if self.sqlite_has_rows("event_team_data", &self.current_event).await {
            since_iso.as_deref()
        } else {
            println!("[Sync] event_team_data empty — forcing full fetch to heal cache");
            None
        };
        let team_data = match self.supabase.fetch_event_team_data(&self.current_event, team_since).await {
            Ok(data) => {
                println!("[Sync] Team data fetched: {} rows ({})", data.len(),
                    if team_since.is_some() { "incremental" } else { "full" });
                data
            },
            Err(e) => {
                eprintln!("[Sync] Team data fetch failed: {}", e);
                vec![]
            }
        };
        if !team_data.is_empty() {
            self.cache_teams_to_sqlite(&team_data)
                .await
                .context("Failed to cache team data to SQLite")?;
        }

        // 5. Fetch schedule — incremental if SQLite has rows, full if empty.
        let schedule_since = if self.sqlite_has_rows("event_schedule", &self.current_event).await {
            since_iso.as_deref()
        } else {
            println!("[Sync] event_schedule empty — forcing full fetch to heal cache");
            None
        };
        let schedule_data = match self.supabase.fetch_event_schedule(&self.current_event, schedule_since).await {
            Ok(data) => {
                println!("[Sync] Schedule fetched: {} rows ({})", data.len(),
                    if schedule_since.is_some() { "incremental" } else { "full" });
                data
            },
            Err(e) => {
                eprintln!("[Sync] Schedule fetch failed: {}", e);
                vec![]
            }
        };
        if !schedule_data.is_empty() {
            // preserve_assignments=false: Supabase is authoritative — null means cleared
            self.cache_schedule_to_sqlite(&schedule_data, false)
                .await
                .context("Failed to cache schedule to SQLite")?;
            // Update snapshot for next push cycle's change detection
            self.update_schedule_snapshot(&schedule_data, schedule_since.is_none());
        }

        // 6. Fetch match schedule from TBA and push
        match self.tba.fetch_match_schedule(&self.current_event).await {
                Ok(schedule) => {
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
                        // Build Supabase push records — scores, predictions, and est_time are
                        // no longer in Supabase (mobile polls TBA/Statbotics/Nexus directly).
                        // Only push structural fields: event, match, team, alliance.
                        // alliance is set once at bootstrap and never changes, so the only
                        // rows that need pushing are ones absent from the snapshot (new matches).
                        let supabase_records: Vec<serde_json::Value> = schedule_records.iter().map(|r| {
                            json!({
                                "event": r["event"],
                                "match": r["match"],
                                "team": r["team"],
                                "alliance": r["alliance"],
                                "last_modified": r["last_modified"],
                            })
                        }).collect();

                        // Change detection: only push rows absent from the Supabase snapshot.
                        // alliance never changes after bootstrap, so existing rows never need updates.
                        let snapshot_set: std::collections::HashSet<(String, String)> =
                            self.schedule_snapshot.iter().filter_map(|s| {
                                let m = s.get("match")?.as_str()?.to_string();
                                let t = s.get("team")?.as_str()?.to_string();
                                Some((m, t))
                            }).collect();

                        let changed_schedule_records: Vec<serde_json::Value> = if self.schedule_snapshot.is_empty() {
                            // Cold start: pass all records so bulk_upsert_schedule can detect
                            // rows missing from Supabase (e.g. after manual deletions).
                            supabase_records.clone()
                        } else {
                            supabase_records
                                .iter()
                                .filter(|record| {
                                    let match_key = record.get("match").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    !snapshot_set.contains(&(match_key, team))
                                })
                                .cloned()
                                .collect()
                        };

                        println!("[Sync] {}/{} schedule rows changed",
                            changed_schedule_records.len(), schedule_records.len());

                        // Cache ALL to local SQLite (for offline support)
                        // preserve_assignments=true: TBA data has no name/uid, use COALESCE
                        self.cache_schedule_to_sqlite(&schedule_records, true)
                            .await
                            .context("Failed to cache schedule to SQLite")?;

                        // Only push changed rows to Supabase.
                        // Pass snapshot so bulk_upsert_schedule skips its own SELECT.
                        if !changed_schedule_records.is_empty() {
                            let sched_snapshot = if self.schedule_snapshot.is_empty() {
                                None
                            } else {
                                Some(self.schedule_snapshot.as_slice())
                            };
                            if let Err(e) = self.supabase
                                .bulk_upsert_schedule(changed_schedule_records, sched_snapshot)
                                .await
                            {
                                eprintln!("[Sync] ✗ Failed to push schedule to Supabase: {}", e);
                                // Non-fatal: continue to Supabase pull steps
                            } else {
                                println!("[Sync] ✓ Pushed changed schedule rows to Supabase");
                            }
                        } else {
                            println!("[Sync] ✓ Schedule unchanged — skipping Supabase push");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[Sync] TBA match schedule fetch failed (skipping schedule push): {}", e);
                }
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

        // Only advance last_sync_time if:
        // - We're already in incremental mode (not the first sync), OR
        // - The first full sync actually received data from Supabase.
        //
        // If the first sync returned 0 rows from all pull tables (e.g., due to a
        // temporary auth/RLS hiccup at startup), keeping last_sync_time=None ensures
        // the NEXT sync also does a full fetch instead of an incremental that would
        // miss data uploaded before this sync cycle's window.
        let got_supabase_data = !user_profiles.is_empty()
            || !picklists.is_empty()
            || !match_data.is_empty()
            || !team_data.is_empty()
            || !schedule_data.is_empty();

        if !is_first_sync || got_supabase_data {
            *self.last_sync_time.lock().unwrap() = Some(chrono::Utc::now());
        } else {
            println!("[Sync] First sync returned 0 rows from all tables — keeping last_sync_time=None so next sync is also a full fetch");
        }

        Ok(())
    }

    /// Returns true if the SQLite table has at least one non-deleted row for the event.
    /// Used to decide full fetch (heal empty cache) vs incremental (minimize egress).
    /// When false → pass `since = None` so Supabase returns all rows including deleted ones.
    async fn sqlite_has_rows(&self, table: &str, event: &str) -> bool {
        let sql = format!(
            "SELECT COUNT(*) FROM {} WHERE event = ? AND deleted_at IS NULL",
            table
        );
        sqlx::query_scalar::<_, i64>(&sql)
            .bind(event)
            .fetch_one(&self.sqlx_pool)
            .await
            .unwrap_or(0) > 0
    }

    /// Variant for tables without an event column (e.g. user_profiles).
    async fn sqlite_has_rows_global(&self, table: &str) -> bool {
        let sql = format!(
            "SELECT COUNT(*) FROM {} WHERE deleted_at IS NULL",
            table
        );
        sqlx::query_scalar::<_, i64>(&sql)
            .fetch_one(&self.sqlx_pool)
            .await
            .unwrap_or(0) > 0
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

        for record in team_records {
            let team = record.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let team_name = record.get("team_name").and_then(|v| v.as_str());
            let name = record.get("name").and_then(|v| v.as_str());
            let uid = record.get("uid").and_then(|v| v.as_str());
            let assigned = record.get("assigned").and_then(|v| v.as_str());
            let timestamp = record.get("timestamp").and_then(|v| v.as_i64());
            // deleted_at from Supabase is an ISO string — convert to ms; None if not deleted
            let deleted_at = record.get("deleted_at").and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())))
            });

            // Strip null values from incoming data (pit scouting only) so json_patch
            // doesn't erase existing pit fields.
            let data_json = match record.get("data").and_then(|v| v.as_object()) {
                Some(obj) => {
                    let non_null: serde_json::Map<String, serde_json::Value> = obj
                        .iter()
                        .filter(|(_, v)| !v.is_null())
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    serde_json::Value::Object(non_null).to_string()
                }
                None => "{}".to_string(),
            };

            sqlx::query(
                "INSERT INTO event_team_data
                   (event, team, team_name, data, name, uid, assigned, timestamp, last_modified, deleted_at)
                 VALUES (?, ?, ?, json(?), ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(event, team) DO UPDATE SET
                   team_name = excluded.team_name,
                   data = json_patch(COALESCE(event_team_data.data, '{}'), excluded.data),
                   name = COALESCE(excluded.name, event_team_data.name),
                   uid = COALESCE(excluded.uid, event_team_data.uid),
                   assigned = COALESCE(excluded.assigned, event_team_data.assigned),
                   timestamp = COALESCE(excluded.timestamp, event_team_data.timestamp),
                   last_modified = excluded.last_modified,
                   deleted_at = excluded.deleted_at"
            )
            .bind(&self.current_event)
            .bind(team)
            .bind(team_name)
            .bind(&data_json)
            .bind(name)
            .bind(uid)
            .bind(assigned)
            .bind(timestamp)
            .bind(chrono::Utc::now().timestamp_millis())
            .bind(deleted_at)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache team {} to SQLite", team))?;
        }

        Ok(())
    }

    /// Cache schedule data to local SQLite.
    ///
    /// `preserve_assignments`: when true, uses COALESCE so null name/uid in the incoming
    /// record does NOT overwrite an existing non-null assignment (used for TBA push data,
    /// which never carries scouting assignment fields).
    /// When false, name/uid are written directly — Supabase is authoritative (used for
    /// Supabase pull data, where null means the assignment was deliberately cleared).
    async fn cache_schedule_to_sqlite(
        &self,
        schedule_records: &[serde_json::Value],
        preserve_assignments: bool,
    ) -> Result<()> {
        if schedule_records.is_empty() {
            return Ok(());
        }

        for record in schedule_records {
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

            if preserve_assignments {
                // TBA path: COALESCE so null doesn't erase existing assignments or scores
                sqlx::query(
                    "INSERT INTO event_schedule (event, match, team, alliance, name, uid, est_time, red_score, blue_score, red_win_prob, predicted_red_score, predicted_blue_score, last_modified)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(event, match, team) DO UPDATE SET
                       alliance = excluded.alliance,
                       name = COALESCE(excluded.name, event_schedule.name),
                       uid = COALESCE(excluded.uid, event_schedule.uid),
                       est_time = excluded.est_time,
                       red_score = COALESCE(excluded.red_score, event_schedule.red_score),
                       blue_score = COALESCE(excluded.blue_score, event_schedule.blue_score),
                       red_win_prob = COALESCE(excluded.red_win_prob, event_schedule.red_win_prob),
                       predicted_red_score = COALESCE(excluded.predicted_red_score, event_schedule.predicted_red_score),
                       predicted_blue_score = COALESCE(excluded.predicted_blue_score, event_schedule.predicted_blue_score),
                       last_modified = excluded.last_modified"
                )
                .bind(&self.current_event)
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
                .bind(chrono::Utc::now().timestamp_millis())
                .execute(&self.sqlx_pool)
                .await
                .context(format!("Failed to cache schedule for match {} team {}", match_key, team))?;
            } else {
                // Supabase pull path: scores/predictions are no longer in Supabase —
                // use COALESCE to preserve locally-cached TBA scores.
                // name/uid are direct assignment (null from Supabase means deliberately cleared).
                sqlx::query(
                    "INSERT INTO event_schedule (event, match, team, alliance, name, uid, est_time, red_score, blue_score, red_win_prob, predicted_red_score, predicted_blue_score, last_modified)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(event, match, team) DO UPDATE SET
                       alliance = excluded.alliance,
                       name = excluded.name,
                       uid = excluded.uid,
                       est_time = excluded.est_time,
                       red_score = COALESCE(excluded.red_score, event_schedule.red_score),
                       blue_score = COALESCE(excluded.blue_score, event_schedule.blue_score),
                       red_win_prob = COALESCE(excluded.red_win_prob, event_schedule.red_win_prob),
                       predicted_red_score = COALESCE(excluded.predicted_red_score, event_schedule.predicted_red_score),
                       predicted_blue_score = COALESCE(excluded.predicted_blue_score, event_schedule.predicted_blue_score),
                       last_modified = excluded.last_modified"
                )
                .bind(&self.current_event)
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
                .bind(chrono::Utc::now().timestamp_millis())
                .execute(&self.sqlx_pool)
                .await
                .context(format!("Failed to cache schedule for match {} team {}", match_key, team))?;
            }
        }

        Ok(())
    }

    /// Cache user profiles to local SQLite
    /// Matches Supabase structure for offline support
    async fn cache_user_profiles_to_sqlite(&self, profile_records: &[serde_json::Value], full_sync: bool) -> Result<()> {
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

            // Propagate deletion: if deleted_at is set in Supabase, mark row deleted in SQLite
            let deleted_at_ms: Option<i64> = record.get("deleted_at")
                .and_then(|v| v.as_str())
                .and_then(|ts_str| chrono::DateTime::parse_from_rfc3339(ts_str).ok())
                .map(|dt| dt.timestamp_millis());

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
            .bind(&settings_json)
            .bind(last_modified)
            .bind(deleted_at_ms)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache user profile {} to SQLite", uid))?;
        }

        // On full sync: prune stale rows whose UIDs no longer exist in Supabase.
        // Supabase uses hard deletes (rows are gone), not soft deleted_at, so the only
        // way to clean up is to delete local rows absent from the full fetch result.
        if full_sync {
            let fetched_uids: Vec<&str> = profile_records
                .iter()
                .filter_map(|r| r.get("uid").and_then(|v| v.as_str()))
                .collect();
            if !fetched_uids.is_empty() {
                let placeholders = fetched_uids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
                let query_str = format!(
                    "DELETE FROM user_profiles WHERE uid NOT IN ({})",
                    placeholders
                );
                let mut query = sqlx::query(&query_str);
                for uid in &fetched_uids {
                    query = query.bind(*uid);
                }
                query.execute(&self.sqlx_pool).await.context("Failed to prune stale user profiles")?;
                println!("[Sync] Pruned stale user profiles not present in Supabase");
            }
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
            // Serialize embedded entries JSON array to TEXT for SQLite storage
            let picklist_json = record.get("picklist")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "[]".to_string());

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

            // Propagate soft-deletions: if deleted_at is set in Supabase, set it in SQLite too
            let deleted_at: Option<i64> = record.get("deleted_at")
                .and_then(|v| v.as_str())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.timestamp_millis());

            sqlx::query(
                "INSERT INTO event_picklist (id, event, title, picklist, uid, uname, type, timestamp, last_modified, deleted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   picklist = excluded.picklist,
                   uid = excluded.uid,
                   uname = excluded.uname,
                   type = excluded.type,
                   timestamp = excluded.timestamp,
                   last_modified = excluded.last_modified,
                   deleted_at = excluded.deleted_at"
            )
            .bind(id)
            .bind(event)
            .bind(title)
            .bind(&picklist_json)
            .bind(uid)
            .bind(uname)
            .bind(type_str)
            .bind(timestamp)
            .bind(last_modified)
            .bind(deleted_at)
            .execute(&self.sqlx_pool)
            .await
            .context(format!("Failed to cache picklist {} to SQLite", id))?;
        }

        println!("[Sync] Cached {} picklists to SQLite", picklist_records.len());
        Ok(())
    }

    /// Reconcile local match cache against Supabase's active set.
    /// Soft-deletes any local non-deleted rows that are absent from Supabase's response.
    /// Handles old mobile deletions outside the incremental sync window, and cases where
    /// Supabase RLS filters deleted rows from the full fetch.
    async fn reconcile_match_deletions(&self, active_keys: &[serde_json::Value]) -> Result<()> {
        // Build set of (match, team) pairs that Supabase considers active
        let active_set: std::collections::HashSet<(String, String)> = active_keys
            .iter()
            .filter_map(|v| {
                let m = v.get("match").and_then(|x| x.as_str())?.to_string();
                let t = v.get("team").and_then(|x| x.as_str())?.to_string();
                Some((m, t))
            })
            .collect();

        // Fetch local non-deleted rows (keys only)
        let local_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT match, team FROM event_match_data WHERE event = ? AND deleted_at IS NULL"
        )
        .bind(&self.current_event)
        .fetch_all(&self.sqlx_pool)
        .await?;

        if local_rows.is_empty() {
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp_millis();
        let mut marked = 0usize;

        for (match_key, team) in &local_rows {
            if !active_set.contains(&(match_key.clone(), team.clone())) {
                sqlx::query(
                    "UPDATE event_match_data SET deleted_at = ?, last_modified = ?
                     WHERE event = ? AND match = ? AND team = ? AND deleted_at IS NULL"
                )
                .bind(now)
                .bind(now)
                .bind(&self.current_event)
                .bind(match_key)
                .bind(team)
                .execute(&self.sqlx_pool)
                .await?;
                marked += 1;
            }
        }

        if marked > 0 {
            println!("[Sync] Reconciliation: soft-deleted {} orphaned match records (deleted in Supabase but stale in local cache)", marked);
        } else {
            println!("[Sync] Reconciliation: all {} local match records verified active in Supabase", local_rows.len());
        }

        Ok(())
    }

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
                "INSERT INTO event_match_data (event, match, team, alliance, data_raw, name, uid, timestamp, last_modified, deleted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(event, match, team) DO UPDATE SET
                   alliance = excluded.alliance,
                   data_raw = excluded.data_raw,
                   name = excluded.name,
                   last_modified = excluded.last_modified,
                   deleted_at = excluded.deleted_at"
            )
            .bind(event)
            .bind(match_key)
            .bind(team)
            .bind(alliance)
            .bind(&data_raw_json)
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
        // Guard: skip queue processing if the frontend hasn't sent a JWT yet.
        // Without a valid user JWT, writes will fail with auth errors and burn retry counts.
        // The frontend calls set_user_jwt → trigger_sync_now in sequence on mount, so the
        // next triggered sync will have the JWT available.
        if !self.supabase.has_jwt() {
            println!("[SyncQueue] JWT not yet available — deferring queue processing until auth is ready");
            return Ok(());
        }

        // Crash recovery: if items were stuck in 'processing' state from a previous
        // run that crashed, reset them to 'pending' so they get retried.
        // Threshold: 3 minutes (well above the longest single operation).
        let stale_cutoff = chrono::Utc::now().timestamp_millis() - 3 * 60 * 1000;
        let recovered: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sync_queue
             WHERE status = 'processing' AND last_attempt < ?"
        )
        .bind(stale_cutoff)
        .fetch_one(&self.sqlx_pool)
        .await
        .unwrap_or((0,));

        if recovered.0 > 0 {
            sqlx::query(
                "UPDATE sync_queue SET status = 'pending'
                 WHERE status = 'processing' AND last_attempt < ?"
            )
            .bind(stale_cutoff)
            .execute(&self.sqlx_pool)
            .await
            .context("Failed to recover stale processing items")?;
            println!("[SyncQueue] Recovered {} stale 'processing' items → 'pending'", recovered.0);
        }

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

        // Warn about permanently failed items (data that will never reach Supabase)
        let failed_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'"
        )
        .fetch_one(&self.sqlx_pool)
        .await
        .unwrap_or((0,));
        if failed_count.0 > 0 {
            eprintln!("[SyncQueue] ⚠️  {} permanently failed item(s) in queue (exceeded max retries — data NOT synced to Supabase)", failed_count.0);
        }

        if queue_items.is_empty() {
            return Ok(());
        }

        let batch_size = queue_items.len();
        println!("[SyncQueue] Processing {} pending operations (batch of up to 10)", batch_size);

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
                "ASSIGN_SHIFTS_BULK" => self.sync_assign_shifts_bulk(payload).await,
                "ASSIGN_SHIFTS_DIFF" => self.sync_assign_shifts_diff(payload).await,
                "ASSIGN_PIT_TEAMS_BULK" => self.sync_assign_pit_teams_bulk(payload).await,
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

        // If we processed a full batch of 10, there may be more items waiting.
        // Schedule an immediate follow-up to drain the rest without waiting 120s.
        if batch_size >= 10 {
            let more: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'"
            )
            .fetch_one(&self.sqlx_pool)
            .await
            .unwrap_or((0,));
            if more.0 > 0 {
                println!("[SyncQueue] {} more items remain — will process in next sync cycle", more.0);
            }
        }

        Ok(())
    }

    /// Enrich a Supabase FK violation error with the specific UID and name that caused it.
    /// Parses the Supabase JSON error body (e.g. `{"code":"23503","details":"Key (uid)=(xxx)..."}`)
    /// and cross-references against the assignments array to identify the offending scouter.
    fn enrich_fk_error(err: anyhow::Error, assignments: &[serde_json::Value]) -> anyhow::Error {
        let msg = err.to_string();
        // Extract violating UID from Supabase error detail: "Key (uid)=(some-uuid) is not present..."
        if let Some(start) = msg.find("Key (uid)=(") {
            let rest = &msg[start + "Key (uid)=(".len()..];
            if let Some(end) = rest.find(')') {
                let bad_uid = &rest[..end];
                // Find the name for this UID in the assignments
                let name = assignments.iter()
                    .find(|a| a.get("uid").and_then(|v| v.as_str()) == Some(bad_uid))
                    .and_then(|a| a.get("name").and_then(|v| v.as_str()))
                    .unwrap_or("unknown");
                return anyhow::anyhow!(
                    "FK violation — invalid user '{}' (uid: {}) no longer exists in Supabase. \
                     Remove stale scouter from the scheduler list. Original error: {}",
                    name, bad_uid, msg
                );
            }
        }
        err
    }

    /// Returns true if the error string looks like a transient network connectivity issue
    /// (offline, DNS failure, TCP reset, etc.) rather than a server-level error.
    /// Network errors should NOT burn retries — the item stays pending until connectivity
    /// returns. Server errors (4xx schema errors, auth errors) should count toward the
    /// retry limit so genuinely broken payloads don't loop forever.
    fn is_network_error(error: &str) -> bool {
        let lower = error.to_lowercase();
        lower.contains("error sending request")
            || lower.contains("connection refused")
            || lower.contains("connection reset")
            || lower.contains("connection closed")
            || lower.contains("failed to lookup")
            || lower.contains("network unreachable")
            || lower.contains("dns error")
            || lower.contains("error trying to connect")
            || lower.contains("timed out")
            || lower.contains("broken pipe")
            || lower.contains("no route to host")
            || lower.contains("failed to fetch")
            || lower.contains("os error 111") // ECONNREFUSED on Linux
            || lower.contains("os error 101") // ENETUNREACH on Linux
    }

    /// Mark queue item as failed with retry limit.
    /// Network connectivity errors leave the item as 'pending' without incrementing
    /// retries so items survive extended offline periods. Server-level errors
    /// (bad payload, auth failure, schema mismatch) count toward the 5-retry limit.
    async fn mark_queue_failed(&self, id: i64, error: String) -> Result<()> {
        // Don't burn retries on transient network failures — just reset to pending
        // and record the error for debugging. The next 120s cycle will retry.
        if Self::is_network_error(&error) {
            println!("[SyncQueue] Network error for item {} — leaving as pending (retries not incremented): {}", id, error);
            sqlx::query(
                "UPDATE sync_queue
                 SET status = 'pending', last_error = ?, last_attempt = ?
                 WHERE id = ?"
            )
            .bind(&error)
            .bind(chrono::Utc::now().timestamp_millis())
            .bind(id)
            .execute(&self.sqlx_pool)
            .await?;
            return Ok(());
        }

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
        .bind(&error)
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
        let entries = payload.get("entries").cloned().unwrap_or(json!([]));

        let entry_count = entries.as_array().map(|a| a.len()).unwrap_or(0);
        self.supabase.create_picklist(id, event, title, uid, uname, type_str, timestamp, entries).await?;

        println!("[Sync] ✅ Created picklist '{}' in Supabase ({} teams)", title, entry_count);
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
        let entries = payload.get("entries").cloned().unwrap_or(json!([]));

        let entry_count = entries.as_array().map(|a| a.len()).unwrap_or(0);
        self.supabase.update_picklist(id, event, title, entries).await?;

        println!("[Sync] ✅ Updated picklist '{}' in Supabase ({} teams)", title, entry_count);
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
        let name = payload.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let uid = payload.get("uid").and_then(|v| v.as_str()).filter(|s| !s.is_empty());

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
        let name = payload.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let uid = payload.get("uid").and_then(|v| v.as_str()).filter(|s| !s.is_empty());

        println!("[SyncQueue] PUT_MATCH_DATA: event={}, match={}, team={}, alliance={}, scouter={}({})",
            event, match_key, team, alliance,
            name.unwrap_or("?"),
            uid.unwrap_or("no-uid"));

        self.supabase.put_match_data(event, match_key, team, alliance, data_raw, name, uid).await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("23503") || msg.contains("violates foreign key") {
                    anyhow::anyhow!(
                        "FK violation — scouter '{}' (uid: {}) is not a valid Supabase user. \
                         Original error: {}",
                        name.unwrap_or("?"),
                        uid.unwrap_or("no-uid"),
                        msg
                    )
                } else {
                    e
                }
            })?;

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

        let now = chrono::Utc::now().to_rfc3339();

        // Update Supabase (soft-delete) — keyed by (event, match, team, uid), no timestamp needed
        self.supabase.delete_match_data(event, match_key, team, uid).await?;

        // Update local cache
        sqlx::query(
            "UPDATE event_match_data
             SET deleted_at = ?, last_modified = ?
             WHERE event = ? AND match = ? AND team = ? AND uid = ?"
        )
        .bind(&now)
        .bind(&now)
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

    /// Sync ASSIGN_SHIFTS_BULK operation to Supabase
    /// The frontend computes a diff (only changed rows), so this is now identical to
    /// ASSIGN_SHIFTS_DIFF — individual UPDATEs for each changed row, no clear-all step.
    /// Using patch_assign_shifts avoids the INSERT path of upsert, which triggers FK
    /// validation on event_schedule_uid_fkey even when the conflict resolves via UPDATE.
    async fn sync_assign_shifts_bulk(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let assignments = payload.get("assignments")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing assignments array"))?
            .clone();

        let count = assignments.len();
        // Log UIDs being pushed so FK failures are identifiable
        let uid_summary: Vec<String> = assignments.iter()
            .filter_map(|a| {
                let uid = a.get("uid").and_then(|v| v.as_str())?;
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                Some(format!("{}({})", name, &uid[..uid.len().min(8)]))
            })
            .collect();
        println!("[Sync] ASSIGN_SHIFTS_BULK: {} rows, uids: [{}]", count, uid_summary.join(", "));

        self.supabase.patch_assign_shifts(event, &assignments).await
            .map_err(|e| Self::enrich_fk_error(e, &assignments))?;
        println!("[Sync] ✅ Bulk assigned {} shifts to Supabase (diff patch)", count);
        Ok(())
    }

    /// Sync ASSIGN_SHIFTS_DIFF operation to Supabase (incremental patch, no clear)
    async fn sync_assign_shifts_diff(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let assignments = payload.get("assignments")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing assignments array"))?
            .clone();

        let count = assignments.len();
        let uid_summary: Vec<String> = assignments.iter()
            .filter_map(|a| {
                let uid = a.get("uid").and_then(|v| v.as_str())?;
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                Some(format!("{}({})", name, &uid[..uid.len().min(8)]))
            })
            .collect();
        println!("[Sync] ASSIGN_SHIFTS_DIFF: {} rows, uids: [{}]", count, uid_summary.join(", "));

        self.supabase.patch_assign_shifts(event, &assignments).await
            .map_err(|e| Self::enrich_fk_error(e, &assignments))?;
        println!("[Sync] ✅ Patched {} shifts in Supabase (incremental diff)", count);
        Ok(())
    }

    /// Sync ASSIGN_PIT_TEAMS_BULK operation to Supabase
    async fn sync_assign_pit_teams_bulk(&self, payload: serde_json::Value) -> Result<()> {
        let event = payload.get("event").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing event"))?;
        let assignments = payload.get("assignments")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing assignments array"))?
            .clone();

        let count = assignments.len();
        self.supabase.bulk_assign_pit_teams(event, &assignments).await?;
        println!("[Sync] ✅ Bulk assigned {} pit teams to Supabase", count);
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

        // Push team names to Supabase so mobile can display them.
        // rank/record are no longer included — mobile polls TBA statuses directly.
        // data: {} is required — the column is NOT NULL and merge_team_data_batch expects it.
        let team_records: Vec<serde_json::Value> = teams
            .into_iter()
            .map(|team| {
                json!({
                    "event": self.current_event,
                    "team": team.key,
                    "team_name": team.name,
                    "data": {},
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
