//! Statbotics Service
//! Fetches EPA (Expected Points Added) and match predictions from Statbotics API
//! https://api.statbotics.io/v3

use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;

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

    /// Fetch EPA data for all teams at an event
    /// GET /team_years?event={event}
    /// Returns EPA breakdown: total_points, auto, teleop, endgame, norm
    pub async fn fetch_event_team_years(&self, event: &str) -> Result<Vec<Value>> {
        let url = format!("{}/team_years?event={}", self.base_url, event);

        println!("[Statbotics] Fetching team EPAs: {}", url);

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

        println!("[Statbotics] Fetched {} team EPAs", data.len());
        Ok(data)
    }

    /// Fetch match predictions for an event
    /// GET /matches?event={event}
    /// Returns win probabilities and predicted scores
    pub async fn fetch_event_matches(&self, event: &str) -> Result<Vec<Value>> {
        let url = format!("{}/matches?event={}", self.base_url, event);

        println!("[Statbotics] Fetching match predictions: {}", url);

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
