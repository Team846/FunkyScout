//! Statbotics Service
//! Fetches EPA (Expected Points Added) and match predictions from Statbotics API
//! https://api.statbotics.io/v3

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::sync::atomic::{AtomicU32, Ordering};

/// Global counter for Statbotics API calls (for rate limiting awareness)
static API_CALL_COUNT: AtomicU32 = AtomicU32::new(0);

/// Statbotics API client for fetching EPA and predictions
#[derive(Clone)]
pub struct StatboticsService {
    client: Client,
    base_url: String,
}

impl StatboticsService {
    /// Create new Statbotics service
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: "https://api.statbotics.io/v3".to_string(),
        }
    }

    /// Fetch EPA data for a specific team in a specific year
    /// GET /team_year/{team}/{year}
    /// Returns EPA breakdown: total_points, auto, teleop, endgame, norm
    pub async fn fetch_team_year(&self, team: i32, year: &str) -> Result<Option<Value>> {
        let call_num = API_CALL_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
        let url = format!("{}/team_year/{}/{}", self.base_url, team, year);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch team year from Statbotics")?;

        // 404 means no data for this team/year combination
        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            anyhow::bail!(
                "Statbotics API error: {} - {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }

        let data: Value = response
            .json()
            .await
            .context("Failed to parse Statbotics team_year response")?;

        Ok(Some(data))
    }

    /// Fetch EPA data for teams at an event for a specific year (DEPRECATED - use fetch_team_year for each team)
    /// GET /team_years?event={event}&year={year}&limit=1000
    /// Returns EPA breakdown: total_points, auto, teleop, endgame, norm
    /// Combines event and year filters to get current season data for teams at this event
    pub async fn fetch_event_team_years(&self, event: &str, year: &str) -> Result<Vec<Value>> {
        let call_num = API_CALL_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
        let url = format!("{}/team_years?event={}&year={}&limit=1000", self.base_url, event, year);

        println!("[Statbotics] ⚡ API Call #{}: Fetching team EPAs for event {} year {}", call_num, event, year);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch team years from Statbotics")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Statbotics API error: {} - {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }

        let data: Vec<Value> = response
            .json()
            .await
            .context("Failed to parse Statbotics team_years response")?;

        println!("[Statbotics] ⚡ API Call: Fetched {} team EPAs for event {} year {}", data.len(), event, year);

        // Debug: Log sample team numbers to verify we're getting the right teams
        if !data.is_empty() {
            let sample_teams: Vec<i64> = data.iter()
                .take(5)
                .filter_map(|t| t.get("team").and_then(|n| n.as_i64()))
                .collect();
            println!("[Statbotics] Sample team numbers from API: {:?}", sample_teams);
        }

        Ok(data)
    }

    /// Fetch match predictions for an event
    /// GET /matches?event={event}
    /// Returns win probabilities and predicted scores
    pub async fn fetch_event_matches(&self, event: &str) -> Result<Vec<Value>> {
        let call_num = API_CALL_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
        let url = format!("{}/matches?event={}", self.base_url, event);

        println!("[Statbotics] ⚡ API Call #{}: Fetching match predictions", call_num);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch matches from Statbotics")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Statbotics API error: {} - {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }

        let data: Vec<Value> = response
            .json()
            .await
            .context("Failed to parse Statbotics matches response")?;

        println!("[Statbotics] Fetched {} match predictions", data.len());
        Ok(data)
    }
}
