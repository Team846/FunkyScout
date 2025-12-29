//! localdb
//! The local database handles storing data fetched from the backend (Supabase)
//! and third party data sources like TBA

use anyhow::Result;
use migration::{Migrator, MigratorTrait};
use sea_orm::{Database, DatabaseConnection};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
pub mod entity;
pub mod json;

// Object to handle communication with the SQLite Database
// Contains a connecction pool to pull from when accessing the db
pub struct LocalDatabase {
    database_path: PathBuf,
    db: DatabaseConnection,
}

impl LocalDatabase {
    /// Creates a new handle to the local database
    /// Will create a new database file if it does not exist
    pub async fn new(app_handle: &AppHandle) -> Result<Self> {
        let dir = app_handle.path().app_data_dir()?;
        let database_path = dir.join("database.sqlite");
        std::fs::create_dir_all(&dir)?;

        let db =
            Database::connect(format!("sqlite://{}?mode=rwc", database_path.display())).await?;

        Migrator::up(&db, None).await?;

        Ok(Self { database_path, db })
    }

    /// Resets the database by removing the file
    pub async fn reset(self) -> Result<()> {
        self.db.close().await?;
        std::fs::remove_file(&self.database_path)?;

        Ok(())
    }
}
