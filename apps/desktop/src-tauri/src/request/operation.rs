// use crate::{
//     database::json::MatchDataFormat,
//     request::{
//         response::{QueryResponse, QueryTarget},
//         MetricPrimitive, QueryMetric, QueryScope,
//     },
// };

// pub trait QueryOperation {
//     fn execute(
//         &self,
//         conn: &mut DatabaseConnection,
//         scope: &QueryScope,
//         metric: QueryMetric,
//         response: QueryResponse,
//     ) -> Result<QueryResponse, anyhow::Error>;

//     fn primitive(&self) -> MetricPrimitive;

//     fn deps(&self) -> Vec<Box<dyn QueryOperation>>;
// }

// pub struct RawValue;
// impl QueryOperation for RawValue {
//     fn execute(
//         &self,
//         conn: &mut DatabaseConnection,
//         scope: &QueryScope,
//         metric: QueryMetric,
//         mut response: QueryResponse,
//     ) -> Result<QueryResponse, anyhow::Error> {
//         let values = match_data::table
//             .select((match_data::data, match_data::match_key))
//             .filter(match_data::team_key.eq(scope.team_key()))
//             .load::<(serde_json::Value, String)>(conn)?;

//         for (raw_data, key) in values {
//             // consider caching in the future
//             let data: MatchDataFormat = serde_json::from_value(raw_data)?;
//             let value = metric.target_metric.extract_from(data)?;

//             response.add_output_value(QueryTarget::Match(key), metric.as_key().into(), value);
//         }

//         Ok(response)
//     }

//     fn primitive(&self) -> MetricPrimitive {
//         MetricPrimitive::RawValue
//     }

//     fn deps(&self) -> Vec<Box<dyn QueryOperation>> {
//         vec![]
//     }
// }

