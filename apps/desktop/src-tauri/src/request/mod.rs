// use crate::{
//     database::json::MatchDataFormat,
//     request::{operation::QueryOperation, response::QueryResponse},
//     AppState,
// };
// use anyhow::{anyhow, Error, Ok};

// mod cache;
// pub mod operation;
// pub mod response;

// #[allow(unused)]
// impl AppState {
//     pub fn query_data(
//         &mut self,
//         mut metrics: QueryParameters,
//         scope: QueryScope,
//     ) -> Result<QueryResponse, Error> {
//         // sort requests by their number of parameter calculation dependencies
//         metrics.sort_by(|(_, a), (_, b)| a.deps().len().cmp(&b.deps().len()));
//         let mut conn = self.database;
//         let mut response = QueryResponse::initialize(&mut conn, &scope, self.curr_event().into())?;
//         for metric in metrics {
//             response = metric.1.execute(&mut conn, &scope, metric.0, response)?;
//         }

//         Ok(response)
//     }
// }

// /// List of all of our metrics we want in our output and the way we
// /// would like them, i.e. (conceptually) `[(totalPoints, rank), ...]`
// type QueryParameters = Vec<(QueryMetric, Box<dyn QueryOperation>)>;

// /// Specifies a single metric we want in our output, i.e. we want
// /// to include `GeneralMetric("totalPoints")` which is a `Number` in
// /// our final `QueryResponse`
// #[allow(unused)]
// #[derive(Debug)]
// pub struct QueryMetric {
//     base_primitive: MetricPrimitive,
//     target_metric: MetricParameter,
// }

// impl QueryMetric {
//     pub fn as_key(&self) -> &str {
//         match &self.target_metric {
//             MetricParameter::GeneralMetric(k) => k,
//             MetricParameter::TeleMetric(k) => k,
//             MetricParameter::AutoMetric(k) => k,
//             MetricParameter::TeleActions => "teleActions",
//             MetricParameter::AutoActions => "autoActions",
//         }
//     }
// }

// /// Determines exactly what metric we are trying to process, i.e.
// /// total points or robot climb time
// #[allow(unused)]
// #[derive(Debug)]
// pub enum MetricParameter {
//     GeneralMetric(String),
//     TeleMetric(String),
//     AutoMetric(String),
//     TeleActions,
//     AutoActions,
// }

// impl MetricParameter {
//     pub fn extract_from(&self, data: MatchDataFormat) -> Result<serde_json::Value, anyhow::Error> {
//         let val = match &self {
//             Self::GeneralMetric(key) => data.metrics.get(key).cloned(),
//             Self::AutoMetric(key) => data.auto.metrics.get(key).cloned(),
//             Self::TeleMetric(key) => data.tele.metrics.get(key).cloned(),
//             Self::TeleActions => Some(serde_json::to_value(&data.tele.actions)?),
//             Self::AutoActions => Some(serde_json::to_value(&data.auto.actions)?),
//         };

//         if let Some(key) = val {
//             Ok(key)
//         } else {
//             Err(anyhow!("Failed to access metric"))
//         }
//     }
// }

// /// Determines what base primitive the MetricParameter represents, i.e.
// /// `GeneralMetric("totalPoints") represents a `Number`
// #[allow(unused)]
// #[derive(Debug)]
// pub enum MetricPrimitive {
//     Number,
//     Boolean,
//     String,
//     RawValue,
// }

// /// Determines whether the query outputs the values as `Map<TeamKey, Data>`
// /// or as `Map<MatchKey, Data>`
// #[allow(unused)]
// #[derive(Debug)]
// pub enum QueryScope {
//     /// Inner value represents a list of teams to be considered;
//     /// An empty vector represents all teams
//     Teams(Vec<String>),
//     /// Inner value represents the team in question and a list of the matches to be considered;
//     /// An empty vector represents all matches
//     Matches((String, Vec<String>)),
// }

// impl QueryScope {
//     pub fn all_teams() -> Self {
//         QueryScope::Teams(Vec::new())
//     }

//     pub fn some_teams(team_keys: Vec<String>) -> Self {
//         QueryScope::Teams(team_keys)
//     }

//     pub fn team_key(&self) -> &str {
//         match self {
//             Self::Teams(_) => panic!(
//                 "Query scope is of matches, and cannot be requested a singular team key from"
//             ),
//             Self::Matches((team, _)) => team,
//         }
//     }
// }
