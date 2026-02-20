//! TBA API Service
//! Mirrors the functionality of lib/tba/event.ts
//! Fetches data from The Blue Alliance API

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const TBA_BASE_URL: &str = "https://www.thebluealliance.com/api/v3";

/// Per-team climb data extracted from TBA score breakdowns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchClimbEntry {
    pub match_key: String,
    pub team: String,
    pub auto_climb: Option<String>,   // "L1", "L2", "L3", or None
    pub teleop_climb: Option<String>, // "L1", "L2", "L3", or None
}

/// Parse TBA climb level string into our L1/L2/L3 notation
fn parse_climb_level(level: Option<&str>) -> Option<String> {
    match level {
        Some("Level1") => Some("L1".to_string()),
        Some("Level2") => Some("L2".to_string()),
        Some("Level3") => Some("L3".to_string()),
        _ => None,
    }
}

/// Team ranking information (mirrors lib/tba/event.ts TeamRank)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamRank {
    pub key: String,              // e.g., "frc254"
    pub team: i32,                // e.g., 254
    pub name: String,             // Team nickname
    pub rank: i32,                // Ranking position
    pub record: TeamRecord,       // Win/loss/tie record
    pub next_match: Option<String>, // Next match key
    pub last_match: Option<String>, // Last match key
    pub matches: i32,             // Matches played
    pub orders: Vec<f64>,         // Ranking sort orders
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamRecord {
    pub wins: i32,
    pub losses: i32,
    pub ties: i32,
}

/// Match schedule data (mirrors lib/tba/event.ts EventSchedule)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchSchedule {
    pub red_teams: Vec<String>,
    pub blue_teams: Vec<String>,
    pub est_time: i64,               // Unix timestamp
    pub red_score: Option<i32>,
    pub blue_score: Option<i32>,
}

/// TBA API client
#[derive(Clone)]
pub struct TbaService {
    client: reqwest::Client,
    api_key: String,
}

impl TbaService {
    /// Create a new TBA service with API key
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Fetch basic event metadata from TBA (name, start date)
    /// Returns (short_name, start_date) — used for bootstrapping event_list entry.
    pub async fn fetch_event_info(&self, event: &str) -> Result<(String, String)> {
        let data: serde_json::Value = self.fetch_json(&format!("/event/{}", event)).await?;
        let short_name = data["short_name"]
            .as_str()
            .or_else(|| data["name"].as_str())
            .unwrap_or(event)
            .to_string();
        let start_date = data["start_date"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok((short_name, start_date))
    }

    /// Fetch event teams with rankings (mirrors fetchTBAEventTeams)
    /// Makes 2 TBA API calls - use only for bootstrap
    pub async fn fetch_event_teams(&self, event: &str) -> Result<Vec<TeamRank>> {
        // Fetch team statuses (contains rankings)
        let statuses: HashMap<String, serde_json::Value> = self
            .fetch_json(&format!("/event/{}/teams/statuses", event))
            .await?;

        // Fetch team basic info
        let teams: Vec<serde_json::Value> = self
            .fetch_json(&format!("/event/{}/teams", event))
            .await?;

        // Check if event hasn't started (no rankings)
        let first_team_key = teams
            .get(0)
            .and_then(|t| t["key"].as_str())
            .context("No teams found")?;

        if !statuses.contains_key(first_team_key) {
            // No rankings yet - return teams with default values
            return Ok(teams
                .into_iter()
                .filter_map(|team| {
                    Some(TeamRank {
                        key: team["key"].as_str()?.to_string(),
                        team: team["team_number"].as_i64()? as i32,
                        name: team["nickname"].as_str()?.to_string(),
                        rank: 0,
                        record: TeamRecord {
                            wins: 0,
                            losses: 0,
                            ties: 0,
                        },
                        next_match: None,
                        last_match: None,
                        matches: 0,
                        orders: vec![],
                    })
                })
                .collect());
        }

        // Merge teams with statuses - include all teams even if status is missing
        Ok(teams
            .into_iter()
            .filter_map(|team| {
                let key = team["key"].as_str()?.to_string();
                let team_number = team["team_number"].as_i64()? as i32;
                let name = team["nickname"].as_str()?.to_string();

                // Get status if available, otherwise use defaults
                let status = statuses.get(&key);

                Some(TeamRank {
                    key,
                    team: team_number,
                    name,
                    rank: status
                        .and_then(|s| s["qual"]["ranking"]["rank"].as_i64())
                        .unwrap_or(0) as i32,
                    record: TeamRecord {
                        wins: status
                            .and_then(|s| s["qual"]["ranking"]["record"]["wins"].as_i64())
                            .unwrap_or(0) as i32,
                        losses: status
                            .and_then(|s| s["qual"]["ranking"]["record"]["losses"].as_i64())
                            .unwrap_or(0) as i32,
                        ties: status
                            .and_then(|s| s["qual"]["ranking"]["record"]["ties"].as_i64())
                            .unwrap_or(0) as i32,
                    },
                    next_match: status
                        .and_then(|s| s["next_match_key"].as_str())
                        .map(|s| s.to_string()),
                    last_match: status
                        .and_then(|s| s["last_match_key"].as_str())
                        .map(|s| s.to_string()),
                    matches: status
                        .and_then(|s| s["qual"]["ranking"]["matches_played"].as_i64())
                        .unwrap_or(0) as i32,
                    orders: status
                        .and_then(|s| s["qual"]["ranking"]["sort_orders"].as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
                        .unwrap_or_default(),
                })
            })
            .collect())
    }

    /// Fetch only team statuses/rankings (mirrors fetchTBATeamStatuses)
    /// Makes 1 TBA API call - use for runtime polling (50% fewer calls)
    pub async fn fetch_team_statuses(&self, event: &str) -> Result<HashMap<String, serde_json::Value>> {
        self.fetch_json(&format!("/event/{}/teams/statuses", event))
            .await
    }

    /// Fetch match schedule (mirrors fetchTBAMatchSchedule)
    pub async fn fetch_match_schedule(&self, event: &str) -> Result<HashMap<String, MatchSchedule>> {
        let matches: Vec<serde_json::Value> = self
            .fetch_json(&format!("/event/{}/matches/simple", event))
            .await?;

        Ok(matches
            .into_iter()
            .filter_map(|m| {
                let key = m["key"].as_str()?.to_string();
                Some((
                    key,
                    MatchSchedule {
                        red_teams: m["alliances"]["red"]["team_keys"]
                            .as_array()?
                            .iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect(),
                        blue_teams: m["alliances"]["blue"]["team_keys"]
                            .as_array()?
                            .iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect(),
                        est_time: m["predicted_time"].as_i64().unwrap_or(0),
                        red_score: m["alliances"]["red"]["score"].as_i64().map(|s| s as i32),
                        blue_score: m["alliances"]["blue"]["score"].as_i64().map(|s| s as i32),
                    },
                ))
            })
            .collect())
    }

    /// Fetch event OPRs (Offensive Power Rating) and related stats
    /// GET /event/{event_key}/oprs
    /// Returns OPR, DPR (Defensive Power Rating), CCWM (Calculated Contribution to Winning Margin)
    pub async fn fetch_oprs(&self, event: &str) -> Result<serde_json::Value> {
        self.fetch_json(&format!("/event/{}/oprs", event))
            .await
    }

    /// Fetch match score breakdowns to extract climb data per robot
    /// GET /event/{event}/matches (full endpoint, NOT /matches/simple)
    /// Parses autoTowerRobot1/2/3 and endGameTowerRobot1/2/3 from score_breakdown
    pub async fn fetch_match_breakdowns(&self, event: &str) -> Result<Vec<MatchClimbEntry>> {
        let matches: Vec<serde_json::Value> = self
            .fetch_json(&format!("/event/{}/matches", event))
            .await?;

        let mut entries = Vec::new();

        for m in &matches {
            let key = match m["key"].as_str() {
                Some(k) => k.to_string(),
                None => continue,
            };

            // Only process played matches (score != -1)
            let red_score = m["alliances"]["red"]["score"].as_i64().unwrap_or(-1);
            if red_score == -1 {
                continue;
            }

            // Parse climb data for both alliances
            for alliance in &["red", "blue"] {
                let team_keys = match m["alliances"][alliance]["team_keys"].as_array() {
                    Some(arr) => arr.clone(),
                    None => continue,
                };

                for (robot_idx, team_key_val) in team_keys.iter().enumerate() {
                    let team_key = match team_key_val.as_str() {
                        Some(k) => k.to_string(),
                        None => continue,
                    };

                    let robot_num = robot_idx + 1; // 1, 2, or 3

                    let auto_key = format!("autoTowerRobot{}", robot_num);
                    let teleop_key = format!("endGameTowerRobot{}", robot_num);

                    let auto_climb = parse_climb_level(
                        m["score_breakdown"][alliance][&auto_key].as_str()
                    );
                    let teleop_climb = parse_climb_level(
                        m["score_breakdown"][alliance][&teleop_key].as_str()
                    );

                    entries.push(MatchClimbEntry {
                        match_key: key.clone(),
                        team: team_key,
                        auto_climb,
                        teleop_climb,
                    });
                }
            }
        }

        Ok(entries)
    }

    /// Generic fetch with TBA API key auth
    async fn fetch_json<T: serde::de::DeserializeOwned>(&self, endpoint: &str) -> Result<T> {
        let url = format!("{}{}", TBA_BASE_URL, endpoint);

        let response = self
            .client
            .get(&url)
            .header("X-TBA-Auth-Key", &self.api_key)
            .header("User-Agent", "FunkyScout/Desktop")
            .send()
            .await
            .context(format!("Failed to fetch from TBA: {}", endpoint))?;

        if !response.status().is_success() {
            anyhow::bail!(
                "TBA API returned error {}: {}",
                response.status(),
                endpoint
            );
        }

        response
            .json()
            .await
            .context(format!("Failed to parse TBA response: {}", endpoint))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires API key
    async fn test_fetch_team_statuses() {
        let api_key = std::env::var("TBA_API_KEY").expect("TBA_API_KEY not set");
        let service = TbaService::new(api_key);

        let statuses = service
            .fetch_team_statuses("2025cada")
            .await
            .expect("Failed to fetch statuses");

        assert!(!statuses.is_empty());
    }
}
