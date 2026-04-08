use sea_orm_migration::prelude::*;

pub struct Migration;

const MIGRATION_NAME: &str = "m20260408_000021_thread_scope_personal";

impl MigrationName for Migration {
    fn name(&self) -> &str {
        MIGRATION_NAME
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // The `scope` column currently uses a PostgreSQL enum type that only
        // contains {local, national, european}.  ALTER TYPE ... ADD VALUE
        // cannot run inside a transaction (which sea-orm uses for migrations),
        // so we convert the column to TEXT instead.  The CHECK constraint
        // already enforces valid values.
        db.execute_unprepared(
            "
            ALTER TABLE threads
                ALTER COLUMN scope TYPE TEXT USING scope::TEXT;

            DROP TYPE IF EXISTS scope;

            ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
            ALTER TABLE threads ADD CONSTRAINT chk_threads_scope
                CHECK (scope IN ('local', 'national', 'european', 'personal', 'club'));
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "
                ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
                ALTER TABLE threads ADD CONSTRAINT chk_threads_scope
                    CHECK (scope IN ('local', 'national', 'european', 'club'));
                ",
            )
            .await?;
        Ok(())
    }
}
