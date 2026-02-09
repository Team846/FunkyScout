//! Supabase Service
//! Handles pushing data from desktop to Supabase (upstream sync)
//! Mirrors lib/sync/SyncManager.ts patterns for timestamp conversion and upsert logic

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use postgrest::Postgrest;
use serde_json::{json, Value};

/// Supabase client for pushing data upstream
#[derive(Clone)]
pub struct SupabaseService {
    client: Postgrest,
    api_key: String,
}

impl SupabaseService {
    /// Create new Supabase service
    pub fn new(url: String, api_key: String) -> Self {
        let client = Postgrest::new(url)
            .insert_header("apikey", &api_key)
            .insert_header("Authorization", format!("Bearer {}", api_key));

        Self { client, api_key }
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
        let payload = json!({
            "event": event,
            "team": team,
            "data": data,
            "name": name,
            "uid": uid,
        });

        self.client
            .from("event_team_data")
            .upsert(&payload.to_string())
            .on_conflict("event,team")
            .execute()
            .await
            .context("Failed to upsert team data")?;

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
        let payload = json!({
            "event": event,
            "match": match_key,
            "team": team,
            "alliance": alliance,
            "data_raw": data_raw,
            "name": name,
            "uid": uid,
            "timestamp": Self::timestamp_to_iso(timestamp_ms),
            "last_modified": Self::now_iso(),
        });

        self.client
            .from("event_match_data")
            .upsert(&payload.to_string())
            .on_conflict("event,match,team,uid,timestamp")
            .execute()
            .await
            .context("Failed to upsert match data")?;

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

        self.client
            .from("event_schedule")
            .update(&payload.to_string())
            .eq("event", event)
            .eq("team", team)
            .execute()
            .await
            .context("Failed to update schedule assignment")?;

        Ok(())
    }

    /// Soft delete match data
    /// Mirrors: SyncManager.syncDeleteMatchData()
    pub async fn delete_match_data(
        &self,
        event: &str,
        match_key: &str,
        team: &str,
        uid: &str,
        timestamp_ms: i64,
    ) -> Result<()> {
        let payload = json!({
            "deleted_at": Self::now_iso(),
        });

        self.client
            .from("event_match_data")
            .update(&payload.to_string())
            .eq("event", event)
            .eq("match", match_key)
            .eq("team", team)
            .eq("uid", uid)
            .eq("timestamp", &Self::timestamp_to_iso(timestamp_ms))
            .execute()
            .await
            .context("Failed to delete match data")?;

        Ok(())
    }

    /// Upsert picklist header
    /// Mirrors: SyncManager.syncPicklistCreate()
    pub async fn upsert_picklist(
        &self,
        id: &str,
        event: &str,
        title: &str,
        uname: &str,
        uid: &str,
        picklist_type: &str,
        timestamp_ms: i64,
    ) -> Result<()> {
        let payload = json!({
            "id": id,
            "event": event,
            "title": title,
            "picklist": [],  // deprecated field - empty array
            "uname": uname,
            "uid": uid,
            "type": picklist_type,
            "timestamp": Self::timestamp_to_iso(timestamp_ms),
            "last_modified": Self::now_iso(),
        });

        self.client
            .from("event_picklist")
            .upsert(&payload.to_string())
            .execute()
            .await
            .context("Failed to upsert picklist")?;

        Ok(())
    }

    /// Upsert picklist entries
    /// Mirrors: SyncManager.syncPicklistCreate() entries part
    pub async fn upsert_picklist_entries(
        &self,
        event: &str,
        picklist_id: &str,
        entries: Vec<(String, i32, Option<Value>)>, // (team, rank, flags)
    ) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }

        let payload: Vec<Value> = entries
            .into_iter()
            .map(|(team, rank, flags)| {
                json!({
                    "event": event,
                    "id": picklist_id,
                    "team": team,
                    "rank": rank,
                    "flags": flags,
                    "last_modified": Self::now_iso(),
                })
            })
            .collect();

        self.client
            .from("event_picklist_entries")
            .upsert(&serde_json::to_string(&payload)?)
            .execute()
            .await
            .context("Failed to upsert picklist entries")?;

        Ok(())
    }

    /// Delete picklist entries (for picklist update)
    pub async fn delete_picklist_entries(&self, picklist_id: &str) -> Result<()> {
        self.client
            .from("event_picklist_entries")
            .delete()
            .eq("id", picklist_id)
            .execute()
            .await
            .context("Failed to delete picklist entries")?;

        Ok(())
    }

    /// Soft delete picklist
    /// Mirrors: SyncManager.syncPicklistDelete()
    pub async fn delete_picklist(&self, id: &str) -> Result<()> {
        let payload = json!({
            "deleted_at": Self::now_iso(),
        });

        // Soft delete picklist header
        self.client
            .from("event_picklist")
            .update(&payload.to_string())
            .eq("id", id)
            .execute()
            .await
            .context("Failed to delete picklist")?;

        // Soft delete entries
        self.client
            .from("event_picklist_entries")
            .update(&payload.to_string())
            .eq("id", id)
            .execute()
            .await
            .context("Failed to delete picklist entries")?;

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

        self.client
            .from("event_list")
            .upsert(&payload.to_string())
            .on_conflict("event")
            .execute()
            .await
            .context("Failed to upsert event")?;

        Ok(())
    }

    /// Bulk upsert team data from TBA
    /// Used to push TBA rankings/statuses to Supabase
    pub async fn bulk_upsert_team_data(&self, teams: Vec<Value>) -> Result<()> {
        if teams.is_empty() {
            return Ok(());
        }

        self.client
            .from("event_team_data")
            .upsert(&serde_json::to_string(&teams)?)
            .on_conflict("event,team")
            .execute()
            .await
            .context("Failed to bulk upsert team data")?;

        Ok(())
    }

    /// Bulk upsert schedule from TBA
    pub async fn bulk_upsert_schedule(&self, schedule: Vec<Value>) -> Result<()> {
        if schedule.is_empty() {
            return Ok(());
        }

        self.client
            .from("event_schedule")
            .upsert(&serde_json::to_string(&schedule)?)
            .on_conflict("event,match,team")
            .execute()
            .await
            .context("Failed to bulk upsert schedule")?;

        Ok(())
    }

    /// Bulk upsert match data (scores, timings from TBA)
    pub async fn bulk_upsert_match_data(&self, matches: Vec<Value>) -> Result<()> {
        if matches.is_empty() {
            return Ok(());
        }

        self.client
            .from("event_match_data")
            .upsert(&serde_json::to_string(&matches)?)
            .on_conflict("event,match,team")
            .execute()
            .await
            .context("Failed to bulk upsert match data")?;

        Ok(())
    }
}
