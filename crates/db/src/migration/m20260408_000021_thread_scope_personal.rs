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

        // The `scope` column may use a PostgreSQL enum type that only contains
        // {local, national, european}.  ALTER TYPE ... ADD VALUE cannot run
        // inside a transaction (which sea-orm uses for migrations), so we
        // convert the column(s) to TEXT and drop the type.
        // The CHECK constraint on threads enforces valid values.
        //
        // tag_categories may not exist in all environments (e.g. CI), so we
        // handle it conditionally.
        db.execute_unprepared(
            "
            DO $$
            BEGIN
                -- Convert threads.scope if it is still an enum
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'threads' AND column_name = 'scope' AND data_type = 'USER-DEFINED'
                ) THEN
                    ALTER TABLE threads ALTER COLUMN scope TYPE TEXT USING scope::TEXT;
                END IF;

                -- Convert tag_categories.scope if the table exists and column is enum
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tag_categories' AND column_name = 'scope' AND data_type = 'USER-DEFINED'
                ) THEN
                    ALTER TABLE tag_categories ALTER COLUMN scope TYPE TEXT USING scope::TEXT;
                END IF;
            END
            $$;

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
