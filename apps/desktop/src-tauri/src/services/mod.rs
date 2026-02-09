//! Services module
//! Contains business logic for fetching and syncing data

pub mod statbotics;
pub mod supabase;
pub mod sync;
pub mod tba;

pub use statbotics::StatboticsService;
pub use supabase::SupabaseService;
pub use sync::SyncService;
pub use tba::TbaService;
