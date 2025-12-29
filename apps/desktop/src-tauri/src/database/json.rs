//! Contains the format for JSON data stored in match and team data rows

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
pub struct MatchDataFormat {
    pub metrics: Value,
    pub auto: Auto,
    pub tele: Tele,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Action {
    pub action: String,
    pub position: Position,
    pub time: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Auto {
    pub metrics: Value,
    pub actions: Vec<Action>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Tele {
    pub metrics: Value,
    pub actions: Vec<Action>,
}

