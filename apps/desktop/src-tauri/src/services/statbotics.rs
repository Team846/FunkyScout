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
        API_CALL_COUNT.fetch_add(1, Ordering::SeqCst);
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

    /// Fetch EPA data for all teams in a year, paginating until all results are retrieved.
    /// Uses full-year pagination (1000/page) then caller filters for event teams.
    /// The ?event= filter on this endpoint does not reliably return event-specific teams.
    pub async fn fetch_event_team_years(&self, _event: &str, year: &str) -> Result<Vec<Value>> {
        let mut all_data = Vec::new();
        let mut offset = 0;
        let limit = 1000;
        let max_pages = 5; // up to 5000 teams (current FRC has ~4000)

        for page in 0..max_pages {
            let call_num = API_CALL_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
            let url = format!("{}/team_years?year={}&limit={}&offset={}",
                self.base_url, year, limit, offset);

            println!("[Statbotics] ⚡ API Call #{}: Fetching {} team EPAs (page {}/{})",
                call_num, year, page + 1, max_pages);

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

            let fetched_count = data.len();
            all_data.extend(data);

            println!("[Statbotics] Page {}: {} teams (total so far: {})", page + 1, fetched_count, all_data.len());

            if fetched_count < limit {
                break;
            }
            offset += limit;
        }

        println!("[Statbotics] ✓ Total: {} team EPAs for year {}", all_data.len(), year);
        Ok(all_data)
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
