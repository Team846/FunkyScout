use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // SQLite doesn't support ALTER TABLE to modify CHECK constraints
        // We need to recreate the tables without the role CHECK constraint
        // Or simply don't enforce it - Supabase will handle validation

        // Temporary approach: Create new table without CHECK, copy data, swap tables
        db.execute_unprepared(
            "CREATE TABLE user_profiles_new (
                uid TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                settings TEXT NOT NULL DEFAULT '{}',
                last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                deleted_at INTEGER,
                inflight BOOLEAN NOT NULL DEFAULT FALSE
            )"
        ).await?;

        // Copy existing data
        db.execute_unprepared(
            "INSERT INTO user_profiles_new
             SELECT uid, name, role, settings, last_modified, deleted_at, inflight
             FROM user_profiles"
        ).await?;

        // Drop old table
        db.execute_unprepared("DROP TABLE user_profiles").await?;

        // Rename new table
        db.execute_unprepared("ALTER TABLE user_profiles_new RENAME TO user_profiles").await?;

        // Recreate trigger
        db.execute_unprepared(
            "CREATE TRIGGER upd_time_user_profiles AFTER UPDATE ON user_profiles
             FOR EACH ROW
             BEGIN
                 UPDATE user_profiles SET last_modified = strftime('%s','now') * 1000 WHERE uid=OLD.uid;
             END"
        ).await?;

        // Same for user_roles table
        db.execute_unprepared(
            "CREATE TABLE user_roles_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                role TEXT NOT NULL,
                permission TEXT NOT NULL
            )"
        ).await?;

        db.execute_unprepared(
            "INSERT INTO user_roles_new
             SELECT id, role, permission
             FROM user_roles"
        ).await?;

        db.execute_unprepared("DROP TABLE user_roles").await?;
        db.execute_unprepared("ALTER TABLE user_roles_new RENAME TO user_roles").await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Restore CHECK constraints
        let db = manager.get_connection();

        db.execute_unprepared(
            "CREATE TABLE user_profiles_new (
                uid TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'scouter', 'admin')),
                settings TEXT NOT NULL DEFAULT '{}',
                last_modified INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                deleted_at INTEGER,
                inflight BOOLEAN NOT NULL DEFAULT FALSE
            )"
        ).await?;

        db.execute_unprepared(
            "INSERT INTO user_profiles_new
             SELECT uid, name, role, settings, last_modified, deleted_at, inflight
             FROM user_profiles"
        ).await?;

        db.execute_unprepared("DROP TABLE user_profiles").await?;
        db.execute_unprepared("ALTER TABLE user_profiles_new RENAME TO user_profiles").await?;

        db.execute_unprepared(
            "CREATE TRIGGER upd_time_user_profiles AFTER UPDATE ON user_profiles
             FOR EACH ROW
             BEGIN
                 UPDATE user_profiles SET last_modified = strftime('%s','now') * 1000 WHERE uid=OLD.uid;
             END"
        ).await?;

        db.execute_unprepared(
            "CREATE TABLE user_roles_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'scouter', 'admin')),
                permission TEXT NOT NULL
            )"
        ).await?;

        db.execute_unprepared(
            "INSERT INTO user_roles_new
             SELECT id, role, permission
             FROM user_roles"
        ).await?;

        db.execute_unprepared("DROP TABLE user_roles").await?;
        db.execute_unprepared("ALTER TABLE user_roles_new RENAME TO user_roles").await?;

        Ok(())
    }
}
