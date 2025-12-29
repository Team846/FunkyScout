// //! Contains the response format for transferring calculated
// //! data between the backend and the frontend

// use diesel::prelude::*;
// use log::info;
// use moka::sync::Cache;
// use once_cell::sync::Lazy;
// use serde::{Deserialize, Serialize};
// use serde_json::{Map, Value};
// use std::{
//     cmp::Ordering,
//     collections::{BTreeMap, HashSet},
//     time::Duration,
// };

// static RESPONSE_INIT_CACHE: Lazy<Cache<String, Vec<String>>> = Lazy::new(|| {
//     Cache::builder()
//         .max_capacity(20)
//         .time_to_idle(Duration::from_secs(5))
//         .build()
// });

// use crate::{
//     database::{
//         schema::{match_list, team_list},
//         DatabaseConnection,
//     },
//     request::QueryScope,
// };

// #[derive(Serialize, Deserialize, Debug)]
// pub struct QueryResponse {
//     map: BTreeMap<QueryTarget, Map<String, Value>>,
//     tags: HashSet<QueryTag>,
// }

// impl QueryResponse {
//     pub fn new() -> Self {
//         QueryResponse {
//             map: BTreeMap::new(),
//             tags: HashSet::new(),
//         }
//     }

//     pub fn initialize(
//         conn: &mut DatabaseConnection,
//         scope: &QueryScope,
//         event: String,
//     ) -> Result<Self, anyhow::Error> {
//         let mut response = Self::new();
//         let cache = RESPONSE_INIT_CACHE.clone();

//         let keys = match scope {
//             QueryScope::Teams(_) => cache.try_get_with(format!("Team:{event}"), || {
//                 team_list::table
//                     .select(team_list::team_key)
//                     .filter(team_list::event_code.eq(event))
//                     .load::<String>(conn)
//             })?,
//             QueryScope::Matches((team, _)) => {
//                 cache.try_get_with(format!("Match:{event}"), || {
//                     match_list::table
//                         .select(match_list::team_key)
//                         .filter(match_list::event_code.eq(event))
//                         .filter(match_list::team_key.eq(team))
//                         .load::<String>(conn)
//                 })?
//             }
//         };

//         let key_filter = |target: Vec<String>, requested: &Vec<String>| {
//             if !requested.is_empty() {
//                 let req_set: HashSet<_> = requested.into_iter().collect();
//                 target.into_iter().filter(|v| req_set.contains(v)).collect()
//             } else {
//                 target
//             }
//         };
//         let filtered_keys = match scope {
//             QueryScope::Teams(team_list) => key_filter(keys, team_list),
//             QueryScope::Matches((_, match_list)) => key_filter(keys, match_list),
//         };

//         response.map.extend(filtered_keys.iter().map(|key| {
//             (
//                 match &scope {
//                     QueryScope::Matches(_) => QueryTarget::Match(key.clone()),
//                     QueryScope::Teams(_) => QueryTarget::Team(key.clone()),
//                 },
//                 Map::new(),
//             )
//         }));

//         Ok(response)
//     }

//     pub fn add_tag(&mut self, tag: QueryTag) {
//         self.tags.insert(tag);
//     }

//     pub fn remove_tag(&mut self, tag: &QueryTag) {
//         self.tags.remove(tag);
//     }

//     pub fn add_output_value(&mut self, target: QueryTarget, key: String, value: Value) {
//         let curr = match self.map.get_mut(&target) {
//             Some(val) => val,
//             None => {
//                 info!(
//                     "Failed to find team/match {:#?} in QueryResponse when inputting metric {}",
//                     target, key
//                 );
//                 return;
//             }
//         };

//         curr.insert(key, value);
//     }
// }

// #[derive(Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
// pub enum QueryTag {
//     Fresh,
//     Stale,
//     NoData,
//     Requested,
// }

// #[derive(Deserialize, PartialEq, Eq, PartialOrd, Debug)]
// pub enum QueryTarget {
//     Team(String),
//     Match(String),
// }

// impl Serialize for QueryTarget {
//     fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
//     where
//         S: serde::Serializer,
//     {
//         match self {
//             QueryTarget::Team(s) | QueryTarget::Match(s) => serializer.serialize_str(s),
//         }
//     }
// }

// impl Ord for QueryTarget {
//     fn cmp(&self, other: &Self) -> std::cmp::Ordering {
//         match (self, other) {
//             (QueryTarget::Team(a), QueryTarget::Team(b)) => a.cmp(b),
//             (QueryTarget::Match(a), QueryTarget::Match(b)) => compare_match_keys(a, b),
//             _ => Ordering::Equal,
//         }
//     }
// }

// // Compares teams based on match key order shown below
// // `qm15` < `qm23` < `sf3m1` < `sf11m1` < `f1m2` < `f1m3`
// fn compare_match_keys(a: &str, b: &str) -> Ordering {
//     let parse = |s: &str| -> (u8, u32, u32) {
//         if let Some(r) = s.strip_prefix("qm") {
//             (0, r.parse().unwrap_or(0), 0)
//         } else if let Some(r) = s.strip_prefix("sf") {
//             let (n, m) = r.split_once('m').unwrap_or((r, "0"));
//             (1, n.parse().unwrap_or(0), m.parse().unwrap_or(0))
//         } else if let Some(r) = s.strip_prefix('f') {
//             let (n, m) = r.split_once('m').unwrap_or((r, "0"));
//             (2, n.parse().unwrap_or(0), m.parse().unwrap_or(0))
//         } else {
//             (3, 0, 0)
//         }
//     };

//     parse(a).cmp(&parse(b))
// }

