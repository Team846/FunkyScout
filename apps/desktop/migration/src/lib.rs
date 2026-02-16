pub use sea_orm_migration::prelude::*;

mod m20251113_173514_init;
mod m20260209_add_tba_columns;
mod m20260210_sync_queue;
mod m20260215_fix_user_roles;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20251113_173514_init::Migration),
            Box::new(m20260209_add_tba_columns::Migration),
            Box::new(m20260210_sync_queue::Migration),
            Box::new(m20260215_fix_user_roles::Migration),
        ]
    }
}


