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

        // Add 'personal' and 'club' to the PostgreSQL enum type (if not already present).
        // 'club' was added via CHECK constraint in migration 17 but the enum type was never updated.
        db.execute_unprepared(
            "
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'scope'::regtype AND enumlabel = 'personal') THEN
                    ALTER TYPE scope ADD VALUE 'personal';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'scope'::regtype AND enumlabel = 'club') THEN
                    ALTER TYPE scope ADD VALUE 'club';
                END IF;
            END
            $$;
            ",
        )
        .await?;

        // Update the CHECK constraint to include 'personal'.
        db.execute_unprepared(
            "
            ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
            ALTER TABLE threads ADD CONSTRAINT chk_threads_scope CHECK (scope IN ('local', 'national', 'european', 'personal', 'club'));
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Note: PostgreSQL does not support removing values from an enum type.
        // We only revert the CHECK constraint.
        manager
            .get_connection()
            .execute_unprepared(
                "
                ALTER TABLE threads DROP CONSTRAINT IF EXISTS chk_threads_scope;
                ALTER TABLE threads ADD CONSTRAINT chk_threads_scope CHECK (scope IN ('local', 'national', 'european', 'club'));
                ",
            )
            .await?;
        Ok(())
    }
}
