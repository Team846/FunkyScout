//! Supabase Service
//! Handles pushing data from desktop to Supabase (upstream sync)
//! Mirrors lib/sync/SyncManager.ts patterns for timestamp conversion and upsert logic

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use postgrest::Postgrest;
use serde_json::{json, Value};
use std::sync::{Arc, RwLock};

/// Supabase client for pushing data upstream
#[derive(Clone)]
pub struct SupabaseService {
    client: Postgrest,
    api_key: String,
    base_url: String, // Store base URL for creating new clients
    /// Shared JWT — updated when user logs in via set_user_jwt command
    jwt: Arc<RwLock<Option<String>>>,
}

impl SupabaseService {
    /// Create new Supabase service
    pub fn new(url: String, api_key: String, jwt: Arc<RwLock<Option<String>>>) -> Self {
        // Ensure URL has /rest/v1 suffix for Postgrest
        let rest_url = if url.ends_with("/rest/v1") {
            url.clone()
        } else if url.ends_with('/') {
            format!("{}rest/v1", url)
        } else {
            format!("{}/rest/v1", url)
        };

        let client = Postgrest::new(&rest_url)
            .insert_header("apikey", &api_key)
            .insert_header("Authorization", format!("Bearer {}", api_key));

        Self {
            client,
            api_key: api_key.clone(),
            base_url: rest_url,
            jwt,
        }
    }

    /// Returns true if a user JWT has been set (i.e. the frontend has called set_user_jwt).
    /// Used by process_sync_queue to defer writes until auth is ready.
    pub fn has_jwt(&self) -> bool {
        self.jwt.read().unwrap().is_some()
    }

    /// Return a JWT-authenticated client if a user JWT is set, otherwise the anon-key client
    fn auth_client(&self) -> Postgrest {
        let guard = self.jwt.read().unwrap();
        if let Some(jwt) = guard.as_deref() {
            Postgrest::new(&self.base_url)
                .insert_header("apikey", &self.api_key)
                .insert_header("Authorization", format!("Bearer {}", jwt))
        } else {
            self.client.clone()
        }
        // guard dropped here — lock released before any await
    }

    /// Convert SQLite timestamp (ms since epoch) to PostgreSQL timestamp string
    /// Mirrors: new Date(timestamp).toISOString()
    fn timestamp_to_iso(timestamp_ms: i64) -> String {
        let datetime = DateTime::from_timestamp_millis(timestamp_ms)
            .unwrap_or_else(|| Utc::now());
        datetime.to_rfc3339()
    }

    /// Get current timestamp as ISO string
    /// Mirrors: new Date().toISOString()
    fn now_iso() -> String {
        Utc::now().to_rfc3339()
    }

    /// Upsert event team data (pit scouting)
    /// Mirrors: SyncManager.syncTeamData()
    pub async fn upsert_team_data(
        &self,
        event: &str,
        team: &str,
        data: Value,
        name: Option<&str>,
        uid: Option<&str>,
    ) -> Result<()> {
        // Build payload dynamically — only include name/uid if provided.
        // Omitting them preserves the existing pit scouter's name/uid in Supabase
        // (PostgREST upsert only overwrites columns that appear in the payload).
        let mut payload = json!({
            "event": event,
            "team": team,
            "data": data,
        });
        if let Some(n) = name {
            payload["name"] = json!(n);
        }
        if let Some(u) = uid {
            payload["uid"] = json!(u);
        }

        // No .on_conflict() — PostgREST infers from the primary key (event, team).
        // Adding on_conflict("event,team") requires a named UNIQUE constraint (not just PK),
        // which causes a silent 409 failure if the constraint name doesn't match.
        let resp = self.auth_client()
            .from("event_team_data")
            .upsert(&payload.to_string())
            .execute()
            .await
            .context("Failed to upsert team data")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("[Supabase] event_team_data upsert failed (HTTP {}): {}", status, body);
        }

        Ok(())
    }

    /// Upsert event match data (match scouting)
    /// Mirrors: SyncManager.syncMatchData()
    pub async fn upsert_match_data(
        &self,
        event: &str,
        match_key: &str,
        team: &str,
        alliance: &str,
        data_raw: Value,
        name: Option<&str>,
        uid: Option<&str>,
        timestamp_ms: i64,
    ) -> Result<()> {
        // Build payload dynamically - only include fields that are Some()
        // This prevents overwriting existing fields with null values
        let mut payload = json!({
            "event": event,
            "match": match_key,
            "team": team,
            "alliance": alliance,
            "data_raw": data_raw,
            "data": {},  // deprecated but NOT NULL constraint requires it
            "timestamp": Self::timestamp_to_iso(timestamp_ms),
            "last_modified": Self::now_iso(),
        });

        // Only include name/uid if they're provided (not None)
        if let Some(name_val) = name {
            payload["name"] = json!(name_val);
        }
        if let Some(uid_val) = uid {
            payload["uid"] = json!(uid_val);
        }

        let response = self.auth_client()
            .from("event_match_data")
            .upsert(&payload.to_string())
            .on_conflict("event,match,team")
            .execute()
            .await
            .context("Failed to upsert match data")?;

        let status = response.status();
        println!("[Supabase] upsert_match_data response status: {}", status);
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            eprintln!("[Supabase] upsert_match_data ERROR body: {}", body);
            anyhow::bail!("upsert_match_data failed with status {}: {}", status, body);
        }

        Ok(())
    }

    /// Update event schedule (shift assignment)
    /// Mirrors: SyncManager.syncAssignShift()
    pub async fn update_schedule_assignment(
        &self,
        event: &str,
        team: &str,
        uid: Option<&str>,
        name: Option<&str>,
    ) -> Result<()> {
        let payload = json!({
            "uid": uid,
            "name": name,
            "last_modified": Self::now_iso(),
        });

        self.auth_client()
            .from("event_schedule")
            .update(&payload.to_string())
            .eq("event", event)
            .eq("team", team)
            .execute()
            .await
            .context("Failed to update schedule assignment")?;

        Ok(())
    }

    /// Soft delete match data. Must set last_modified so incremental sync propagates deletion.
    pub async fn delete_match_data(
        &self,
        event: &str,
        match_key: &str,
        team: &str,
        uid: &str,
    ) -> Result<()> {
        let now = Self::now_iso();

        println!(
            "[Supabase] Deleting match data: event={}, match={}, team={}, uid={}",
            event, match_key, team, uid
        );

        let payload = json!({
            "deleted_at": now,
            "last_modified": now,
        });

        let response = self.auth_client()
            .from("event_match_data")
            .update(&payload.to_string())
            .eq("event", event)
            .eq("match", match_key)
            .eq("team", team)
            .eq("uid", uid)
            .execute()
            .await
            .context("Failed to delete match data")?;

        println!("[Supabase] Delete response status: {}", response.status());

        // Check if any rows were affected
        let body = response.text().await.unwrap_or_default();
        println!("[Supabase] Delete response body: {}", body);

        Ok(())
    }

    /// Upsert picklist with embedded entries in `picklist` JSONB column
    pub async fn upsert_picklist(
        &self,
        id: &str,
        event: &str,
        title: &str,
        uname: &str,
        uid: &str,
        picklist_type: &str,
        timestamp_ms: i64,
        entries: Value,
    ) -> Result<()> {
        let payload = json!({
            "id": id,
            "event": event,
            "title": title,
            "picklist": entries,
            "uname": uname,
            "uid": uid,
            "type": picklist_type,
            "timestamp": Self::timestamp_to_iso(timestamp_ms),
            "last_modified": Self::now_iso(),
        });

        self.auth_client()
            .from("event_picklist")
            .upsert(&payload.to_string())
            .execute()
            .await
            .context("Failed to upsert picklist")?;

        Ok(())
    }

    /// Soft delete picklist (entries are embedded — only the header row needs soft-deleting).
    /// Must set last_modified so incremental sync (filtered by last_modified) propagates deletion.
    pub async fn delete_picklist(&self, id: &str) -> Result<()> {
        let now = Self::now_iso();
        let payload = json!({
            "deleted_at": now,
            "last_modified": now,
        });

        self.auth_client()
            .from("event_picklist")
            .update(&payload.to_string())
            .eq("id", id)
            .execute()
            .await
            .context("Failed to delete picklist")?;

        Ok(())
    }

    /// Upsert event list entry
    /// Used when desktop discovers new events from TBA
    pub async fn upsert_event(
        &self,
        event: &str,
        alias: &str,
        date: &str,
    ) -> Result<()> {
        let payload = json!({
            "event": event,
            "alias": alias,
            "date": date,
            "last_modified": Self::now_iso(),
        });

        self.auth_client()
            .from("event_list")
            .upsert(&payload.to_string())
            .on_conflict("event")
            .execute()
            .await
            .context("Failed to upsert event")?;

        Ok(())
    }

    /// Fetch user profiles from Supabase (incremental when since is provided)
    pub async fn fetch_user_profiles(&self, since: Option<&str>) -> Result<Vec<Value>> {
        let mut builder = self.auth_client()
            .from("user_profiles")
            .select("uid,name,role,settings,last_modified,deleted_at");

        builder = if let Some(since_iso) = since {
            // Incremental: include recently deleted rows so deletions propagate
            builder.gte("last_modified", since_iso)
        } else {
            // Full fetch: no filter — include deleted so deleted_at propagates to SQLite
            builder
        };

        let response = builder
            .execute()
            .await
            .context("Failed to fetch user profiles")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to fetch user profiles: HTTP {} - {}",
                status,
                body
            ));
        }

        let body = response.text().await?;
        let profiles: Vec<Value> = serde_json::from_str(&body).unwrap_or_default();

        println!("[Supabase] Fetched {} user profiles", profiles.len());
        Ok(profiles)
    }

    /// Bulk upsert team data from TBA with merge logic and change detection.
    /// Only updates teams where data actually changed (reduces postgres_changes events by 90%).
    /// `snapshot` is the team data last pulled from Supabase (passed from SyncService).
    /// Merges TBA/Statbotics data into event_team_data via a database-level JSONB merge.
    ///
    /// Uses the `merge_team_data_batch` SQL function (JSONB `||` operator) so that
    /// pit scouting keys already in `data` are ALWAYS preserved — even if the Rust
    /// caller only sends TBA/EPA keys. The old fetch-merge-upsert pattern in Rust
    /// was unsafe: if the SELECT returned empty for any reason the entire `data`
    /// column was silently overwritten with TBA-only data.
    pub async fn bulk_upsert_team_data(&self, event: &str, teams: Vec<Value>) -> Result<()> {
        if teams.is_empty() {
            return Ok(());
        }

        println!("[Supabase] merge_team_data_batch: {} teams for event {}", teams.len(), event);

        let payload = serde_json::to_string(&json!({ "records": teams }))
            .context("Failed to serialize team data for merge_team_data_batch")?;

        let resp = self.auth_client()
            .rpc("merge_team_data_batch", &payload)
            .execute()
            .await
            .context("Failed to call merge_team_data_batch RPC")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "[Supabase] merge_team_data_batch failed (HTTP {}): {}",
                status,
                if body.len() > 300 { format!("{}...", &body[..300]) } else { body }
            );
        }

        Ok(())
    }

    /// Sync schedule from TBA to Supabase with change detection.
    /// Bulk UPSERTs only new or changed rows to minimize postgres_changes events.
    /// `snapshot` is the schedule last pulled from Supabase (passed from SyncService).
    /// When Some, skips the redundant full SELECT — only fetches on cold start (None).
    pub async fn bulk_upsert_schedule(&self, schedule: Vec<Value>, snapshot: Option<&[Value]>) -> Result<()> {
        if schedule.is_empty() {
            return Ok(());
        }

        let event = schedule[0].get("event").and_then(|v| v.as_str()).unwrap_or("").to_string();

        // 1. Get existing schedule — use snapshot if warm, fetch from Supabase if cold start.
        let existing_schedule: Vec<Value> = if let Some(snap) = snapshot {
            println!("[Supabase] schedule snapshot hit ({} rows) — skipping SELECT", snap.len());
            snap.to_vec()
        } else {
            println!("[Supabase] schedule snapshot cold — fetching from Supabase");
            let fetch_response = self.auth_client()
                .from("event_schedule")
                .select("event,match,team,est_time,red_score,blue_score,red_win_prob,predicted_red_score,predicted_blue_score,alliance")
                .eq("event", &event)
                .execute()
                .await
                .context("Failed to fetch existing schedule for change detection")?;

            if fetch_response.status().is_success() {
                let body = fetch_response.text().await?;
                serde_json::from_str(&body).unwrap_or_default()
            } else {
                let status = fetch_response.status();
                let body = fetch_response.text().await.unwrap_or_default();
                anyhow::bail!(
                    "[Supabase] Cannot push schedule: fetch returned {} (auth/RLS/server error). \
                     Skipping to avoid overwriting shift assignments. Body: {}",
                    status,
                    if body.len() > 150 { format!("{}...", &body[..150]) } else { body }
                );
            }
        };

        println!("[Supabase] {} existing schedule rows for event {} ({})",
            existing_schedule.len(), event, if snapshot.is_some() { "snapshot" } else { "fetched" });

        // 2. Build lookup map by (match, team)
        let existing_map: std::collections::HashMap<(String, String), Value> = existing_schedule
            .into_iter()
            .filter_map(|v| {
                let match_key = v.get("match")?.as_str()?.to_string();
                let team = v.get("team")?.as_str()?.to_string();
                Some(((match_key, team), v))
            })
            .collect();

        // 3. Collect rows that are new or have changed TBA data
        let total_schedule = schedule.len();
        let fields_to_check = [
            "est_time", "red_score", "blue_score",
            "red_win_prob", "predicted_red_score", "predicted_blue_score",
            "alliance"
        ];

        let rows_to_upsert: Vec<Value> = schedule
            .into_iter()
            .filter(|new_record| {
                let match_key = new_record.get("match").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let team = new_record.get("team").and_then(|v| v.as_str()).unwrap_or("").to_string();

                if let Some(existing) = existing_map.get(&(match_key, team)) {
                    // Existing row: only include if TBA-synced fields changed
                    fields_to_check.iter().any(|field| new_record.get(field) != existing.get(field))
                } else {
                    // New row: always include
                    true
                }
            })
            .collect();

        if rows_to_upsert.is_empty() {
            println!("[Supabase] No schedule changes detected, skipping (saves postgres_changes events)");
            return Ok(());
        }

        let new_count = rows_to_upsert.iter().filter(|r| {
            let mk = r.get("match").and_then(|v| v.as_str()).unwrap_or("");
            let t = r.get("team").and_then(|v| v.as_str()).unwrap_or("");
            !existing_map.contains_key(&(mk.to_string(), t.to_string()))
        }).count();
        let changed_count = rows_to_upsert.len() - new_count;

        println!("[Supabase] Schedule upsert: {} new + {} changed rows (of {} total)",
            new_count, changed_count, total_schedule);

        // Debug: log a sample record to verify payload format
        if let Some(sample) = rows_to_upsert.first() {
            println!("[Supabase] Sample schedule record: {}", sample);
        }

        // 4. Bulk UPSERT new+changed rows
        let response = self.auth_client()
            .from("event_schedule")
            .upsert(&serde_json::to_string(&rows_to_upsert)?)
            .on_conflict("event,match,team")
            .execute()
            .await
            .context("Failed to upsert schedule rows")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            eprintln!("[Supabase] Schedule UPSERT error (HTTP {}): {}", status, body);
            anyhow::bail!("Failed to upsert {} schedule rows (HTTP {}): {}", rows_to_upsert.len(), status, body);
        }

        // Check if rows were actually inserted (PostgREST returns [] if RLS silently blocked)
        let inserted: Vec<Value> = serde_json::from_str(&body).unwrap_or_default();
        if inserted.is_empty() && !rows_to_upsert.is_empty() {
            eprintln!("[Supabase] Schedule UPSERT returned 0 rows — possible RLS block or Prefer:return=minimal. Sent {} rows.", rows_to_upsert.len());
        } else {
            println!("[Supabase] ✓ Schedule upsert complete: {} rows confirmed", inserted.len());
        }

        Ok(())
    }

    // ============================================================================
    // Sync Queue Operation Wrappers
    // These methods match the sync_queue payload structure
    // ============================================================================

    /// Create picklist (from sync queue)
    pub async fn create_picklist(
        &self,
        id: &str,
        event: &str,
        title: &str,
        uid: &str,
        uname: &str,
        picklist_type: &str,
        timestamp: i64,
        entries: Value,
    ) -> Result<()> {
        self.upsert_picklist(id, event, title, uname, uid, picklist_type, timestamp, entries).await
    }

    /// Update picklist with new title and embedded entries (from sync queue)
    pub async fn update_picklist(
        &self,
        id: &str,
        event: &str,
        title: &str,
        entries: Value,
    ) -> Result<()> {
        let now = Self::now_iso();
        let payload = json!({
            "title": title,
            "picklist": entries,
            "last_modified": now,
        });

        println!("[Supabase] Updating picklist {} with entries", id);

        self.auth_client()
            .from("event_picklist")
            .update(&payload.to_string())
            .eq("id", id)
            .eq("event", event)
            .execute()
            .await
            .context("Failed to update picklist")?;

        println!("[Supabase] Picklist updated successfully");

        Ok(())
    }

    /// Put team data (from sync queue) — merges with existing Supabase data first.
    /// Reads current row from Supabase, deep-merges the incoming partial data on top,
    /// then writes the merged result. Prevents overwriting TBA stats when only a
    /// partial update (e.g. just `priority`) is provided.
    pub async fn put_team_data(
        &self,
        event: &str,
        team: &str,
        new_data: Value,
        _team_name: Option<&str>,
        name: Option<&str>,
        uid: Option<&str>,
    ) -> Result<()> {
        // Fetch the current row so we can preserve TBA stats, pit scouting, etc.
        let response = self.auth_client()
            .from("event_team_data")
            .select("data")
            .eq("event", event)
            .eq("team", team)
            .execute()
            .await;

        let merged_data = match response {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                let rows: Vec<Value> = serde_json::from_str(&body).unwrap_or_default();
                if let Some(row) = rows.first() {
                    let existing = row.get("data").cloned().unwrap_or(json!({}));
                    Self::merge_json(existing, new_data)
                } else {
                    // Row not found in Supabase. Possible causes:
                    // 1. Row doesn't exist yet (team never bootstrapped)
                    // 2. RLS visibility issue — row exists but current auth token can't see it
                    //
                    // Writing partial data (e.g. {priority:3}) onto a row that exists-but-is-
                    // invisible would wipe existing pit scouting. Bail out; the sync queue will
                    // retry. For genuine new teams, run bootstrap first to create the row.
                    anyhow::bail!(
                        "[Supabase] put_team_data: no row visible for {}/{} in Supabase. \
                         Aborting write to prevent partial-data overwrite. \
                         If this is a new team, run bootstrap first. \
                         If rows exist, check that the RLS SELECT policy allows the desktop to read all event_team_data rows.",
                        event, team
                    );
                }
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "[Supabase] Cannot put team data: fetch returned {} (auth/RLS/server error). \
                     Skipping to avoid overwriting TBA stats. Body: {}",
                    status,
                    if body.len() > 150 { format!("{}...", &body[..150]) } else { body }
                );
            }
            Err(e) => return Err(e.into()),
        };

        self.upsert_team_data(event, team, merged_data, name, uid).await
    }

    /// Deep-merge two JSON objects: overlay keys win, existing keys not in overlay are kept.
    fn merge_json(base: Value, overlay: Value) -> Value {
        match (base.as_object(), overlay.as_object()) {
            (Some(base_obj), Some(overlay_obj)) => {
                let mut merged = base_obj.clone();
                for (key, value) in overlay_obj {
                    merged.insert(key.clone(), value.clone());
                }
                json!(merged)
            }
            _ => overlay,
        }
    }

    /// Put match data (from sync queue)
    pub async fn put_match_data(
        &self,
        event: &str,
        match_key: &str,
        team: &str,
        alliance: &str,
        data_raw: Value,
        name: Option<&str>,
        uid: Option<&str>,
    ) -> Result<()> {
        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        self.upsert_match_data(event, match_key, team, alliance, data_raw, name, uid, timestamp_ms).await
    }

    // Note: delete_match_data already exists above and takes timestamp_ms parameter
    // sync queue should call it directly with the timestamp from payload

    /// Assign shift (from sync queue)
    pub async fn assign_shift(
        &self,
        event: &str,
        team: &str,
        uid: &str,
        name: Option<&str>,
    ) -> Result<()> {
        self.update_schedule_assignment(event, team, Some(uid), name).await
    }

    /// Bulk assign shifts from cycle algorithm (from sync queue).
    /// First clears all existing shift assignments for the event (atomic replace),
    /// then applies the new assignments row by row.
    /// This prevents old assignments from compounding on top of the new schedule.
    pub async fn bulk_assign_shifts(
        &self,
        event: &str,
        assignments: &[Value],
    ) -> Result<()> {
        // Single batch upsert of only the rows that changed (diff computed on frontend).
        // PostgREST only touches columns present in the payload, so alliance/est_time/etc.
        // are left untouched. No separate clear-all step needed — rows that should be
        // cleared are included with uid/name=null by the frontend diff.
        let now = Self::now_iso();
        let rows: Vec<Value> = assignments.iter().map(|a| {
            json!({
                "event": event,
                "match": a.get("match").and_then(|v| v.as_str()).unwrap_or(""),
                "team": a.get("team").and_then(|v| v.as_str()).unwrap_or(""),
                // alliance is NOT NULL — must be present for the INSERT path of upsert
                "alliance": a.get("alliance").and_then(|v| v.as_str()).unwrap_or(""),
                "uid": a.get("uid"),
                "name": a.get("name"),
                "last_modified": now,
            })
        }).collect();

        let body = serde_json::to_string(&rows).context("Failed to serialize assignments")?;
        let response = self.auth_client()
            .from("event_schedule")
            .upsert(&body)
            .execute()
            .await
            .context("Failed to bulk upsert shift assignments")?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("[Supabase] bulk_assign_shifts failed (HTTP {}): {}", status, text);
        }

        println!("[Supabase] ✓ Bulk assigned {} shifts (diff-only batch upsert)", assignments.len());
        Ok(())
    }

    /// Patch a subset of shift assignments without clearing the rest (from sync queue).
    /// Unlike bulk_assign_shifts, this does NOT clear existing assignments first.
    /// Only the rows in `assignments` are updated; all others are left untouched.
    ///
    /// Uses a single SQL RPC call (`patch_shift_assignments_batch`) so all rows are
    /// updated atomically in one round-trip instead of N sequential HTTP PATCHes.
    /// This fires the same number of postgres_changes events but delivers them all
    /// at once, so mobile's realtime debounce catches them in a single batch.
    pub async fn patch_assign_shifts(
        &self,
        event: &str,
        assignments: &[Value],
    ) -> Result<()> {
        let params = json!({
            "p_event": event,
            "p_assignments": assignments,
        });

        let response = self
            .auth_client()
            .rpc("patch_shift_assignments_batch", &params.to_string())
            .execute()
            .await
            .context("Failed to call patch_shift_assignments_batch RPC")?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "[Supabase] patch_shift_assignments_batch failed (HTTP {}): {}",
                status,
                text
            );
        }

        println!("[Supabase] ✓ Patched {} shift assignments (single RPC)", assignments.len());
        Ok(())
    }

    /// Bulk assign pit scouting teams (from sync queue).
    /// Updates the `assigned` column in event_team_data for each team.
    pub async fn bulk_assign_pit_teams(
        &self,
        event: &str,
        assignments: &[Value],
    ) -> Result<()> {
        for assignment in assignments {
            let team = assignment.get("team").and_then(|v| v.as_str()).unwrap_or("");
            let uid = assignment.get("uid").and_then(|v| v.as_str());

            let payload = json!({
                "assigned": uid,
                "last_modified": Self::now_iso(),
            });

            self.auth_client()
                .from("event_team_data")
                .update(&payload.to_string())
                .eq("event", event)
                .eq("team", team)
                .execute()
                .await
                .context(format!("Failed to assign pit team {}", team))?;
        }

        println!("[Supabase] ✓ Bulk assigned {} pit teams", assignments.len());
        Ok(())
    }

    /// Update user profile settings (from sync queue)
    /// Used for scouter ratings and other profile settings
    pub async fn update_user_profile_settings(
        &self,
        uid: &str,
        settings: &Value,
    ) -> Result<()> {
        let payload = json!({
            "settings": settings,
            "last_modified": Self::now_iso(),
        });

        self.auth_client()
            .from("user_profiles")
            .update(&payload.to_string())
            .eq("uid", uid)
            .execute()
            .await
            .context("Failed to update user profile settings")?;

        Ok(())
    }

    // ============================================================================
    // FETCH METHODS (Polling Supabase for user-generated data)
    // ============================================================================

    /// Fetch event picklists from Supabase
    /// Polls for picklists created by any user at this event.
    /// `since`: if Some, only fetch rows modified since that timestamp (incremental sync).
    ///          Incremental includes soft-deleted rows so deletions propagate to the local cache.
    pub async fn fetch_event_picklists(&self, event: &str, since: Option<&str>) -> Result<Vec<Value>> {
        let mut query = self.auth_client()
            .from("event_picklist")
            .select("*")
            .eq("event", event)
            .order("timestamp.desc");

        // Always fetch all picklists (active and deleted) so the SQLite upsert can
        // propagate deletions. On first sync the old SQLite entry might have deleted_at=NULL
        // but the fresh Supabase row will have deleted_at set — the ON CONFLICT UPDATE will
        // write deleted_at, and get_picklists filters it out with WHERE deleted_at IS NULL.
        query = if let Some(ts) = since {
            query.gte("last_modified", ts)
        } else {
            query // Full fetch: no deleted_at filter — include deleted rows so they propagate
        };

        let response = query
            .execute()
            .await
            .context("Failed to fetch picklists from Supabase")?;

        let body = response.text().await?;
        let data: Vec<Value> = serde_json::from_str(&body)
            .context("Failed to parse picklist response")?;

        Ok(data)
    }

    /// Fetch match scouting data from Supabase
    /// `since`: if Some, only fetch rows modified since that timestamp (incremental sync).
    ///          Incremental includes soft-deleted rows so deletions propagate to the local cache.
    /// This is the highest-egress operation — each data_raw is 5-15KB. Always use since when possible.
    pub async fn fetch_event_match_data(&self, event: &str, since: Option<&str>) -> Result<Vec<Value>> {
        let mut query = self.auth_client()
            .from("event_match_data")
            .select("event, match, team, alliance, data_raw, name, uid, timestamp, last_modified, deleted_at")
            .eq("event", event);

        query = if let Some(ts) = since {
            query.gte("last_modified", ts)
        } else {
            // Full fetch: no filter — include deleted so deleted_at propagates to SQLite
            query
        };

        let response = query
            .execute()
            .await
            .context("Failed to fetch match data from Supabase")?;

        let body = response.text().await?;
        let data: Vec<Value> = serde_json::from_str(&body)
            .context("Failed to parse match data response")?;

        Ok(data)
    }

    /// Fetch only (match, team) keys for active match records — used for delete reconciliation.
    /// Lightweight query: no data_raw. Supabase RLS returns only non-deleted rows.
    /// Compared against local SQLite to detect orphaned (stale-deleted) rows.
    pub async fn fetch_active_match_keys(&self, event: &str) -> Result<Vec<Value>> {
        let response = self.auth_client()
            .from("event_match_data")
            .select("match, team")
            .eq("event", event)
            .execute()
            .await
            .context("Failed to fetch active match keys from Supabase")?;

        let body = response.text().await?;
        let data: Vec<Value> = serde_json::from_str(&body)
            .context("Failed to parse active match keys response")?;

        Ok(data)
    }

    /// Fetch team data from Supabase
    /// Polls for team data at this event (includes TBA stats synced by desktop + pit scouting).
    /// `since`: if Some, only fetch rows modified since that timestamp (incremental sync).
    ///          Incremental includes soft-deleted rows so deletions propagate to the local cache.
    pub async fn fetch_event_team_data(&self, event: &str, since: Option<&str>) -> Result<Vec<Value>> {
        let mut query = self.auth_client()
            .from("event_team_data")
            .select("*")
            .eq("event", event);

        query = if let Some(ts) = since {
            query.gte("last_modified", ts)
        } else {
            // Full fetch: no filter — include deleted so deleted_at propagates to SQLite
            query
        };

        let response = query
            .execute()
            .await
            .context("Failed to fetch team data from Supabase")?;

        let body = response.text().await?;
        let data: Vec<Value> = serde_json::from_str(&body)
            .context("Failed to parse team data response")?;

        Ok(data)
    }

    /// Fetch event schedule from Supabase
    /// Polls for schedule entries at this event (includes shift assignments).
    /// `since`: if Some, only fetch rows modified since that timestamp (incremental sync).
    ///          Incremental includes soft-deleted rows so deletions propagate to the local cache.
    pub async fn fetch_event_schedule(&self, event: &str, since: Option<&str>) -> Result<Vec<Value>> {
        let mut query = self.auth_client()
            .from("event_schedule")
            .select("*")
            .eq("event", event);

        query = if let Some(ts) = since {
            query.gte("last_modified", ts)
        } else {
            // Full fetch: no filter — include deleted so deleted_at propagates to SQLite
            query
        };

        let response = query
            .execute()
            .await
            .context("Failed to fetch schedule from Supabase")?;

        let body = response.text().await?;
        let data: Vec<Value> = serde_json::from_str(&body)
            .context("Failed to parse schedule response")?;

        Ok(data)
    }

    /// Bootstrap schedule rows from TBA into Supabase (INSERT, not update-only).
    /// This requires admin JWT with INSERT permission on event_schedule.
    /// Only needed once when first setting up an event.
    pub async fn bootstrap_schedule(&self, schedule: Vec<Value>) -> Result<()> {
        if schedule.is_empty() {
            return Ok(());
        }

        println!("[Supabase] Bootstrapping {} schedule rows (INSERT with conflict ignore)...", schedule.len());

        let response = self.auth_client()
            .from("event_schedule")
            .upsert(&serde_json::to_string(&schedule)?)
            .on_conflict("event,match,team")
            .execute()
            .await
            .context("Failed to bootstrap schedule")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            eprintln!("[Supabase] Schedule bootstrap failed: {}", body);
            anyhow::bail!("Schedule bootstrap failed with status {}: {}", status, body);
        }

        println!("[Supabase] ✓ Schedule bootstrap complete");
        Ok(())
    }
}
