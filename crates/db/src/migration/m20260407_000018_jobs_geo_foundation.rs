use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Municipalities::Table)
                    .add_column_if_not_exists(string_len_null(Municipalities::OfficialCode, 3))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uq_municipalities_official_code")
                    .table(Municipalities::Table)
                    .col(Municipalities::OfficialCode)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(JobRuns::Table)
                    .col(uuid(JobRuns::Id).primary_key())
                    .col(string_len(JobRuns::JobName, 100).not_null())
                    .col(string_len(JobRuns::Status, 20).not_null())
                    .col(
                        timestamp_with_time_zone(JobRuns::StartedAt)
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(timestamp_with_time_zone_null(JobRuns::FinishedAt))
                    .col(json_binary_null(JobRuns::Details))
                    .col(text_null(JobRuns::Error))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_job_runs_name_started")
                    .table(JobRuns::Table)
                    .col(JobRuns::JobName)
                    .col((JobRuns::StartedAt, IndexOrder::Desc))
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(JobCursors::Table)
                    .col(string_len(JobCursors::JobName, 100).primary_key())
                    .col(text_null(JobCursors::CursorValue))
                    .col(
                        timestamp_with_time_zone(JobCursors::UpdatedAt)
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Places::Table)
                    .add_column_if_not_exists(string_len_null(Places::SourceUrl, 1000))
                    .add_column_if_not_exists(timestamp_with_time_zone_null(Places::LastSynced))
                    .add_column_if_not_exists(
                        string_len(Places::SyncStatus, 20)
                            .not_null()
                            .default("manual"),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r"
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'chk_places_sync_status'
                  ) THEN
                    ALTER TABLE places
                    ADD CONSTRAINT chk_places_sync_status
                    CHECK (sync_status IN ('manual', 'pending', 'synced', 'failed'));
                  END IF;
                END$$;
                ",
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_osm_identity
                ON locations (osm_type, osm_id)
                WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL
                ",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS uq_locations_osm_identity")
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE places DROP CONSTRAINT IF EXISTS chk_places_sync_status",
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Places::Table)
                    .drop_column(Places::SourceUrl)
                    .drop_column(Places::LastSynced)
                    .drop_column(Places::SyncStatus)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(JobCursors::Table).to_owned())
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_job_runs_name_started")
                    .table(JobRuns::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(JobRuns::Table).to_owned())
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("uq_municipalities_official_code")
                    .table(Municipalities::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Municipalities::Table)
                    .drop_column(Municipalities::OfficialCode)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Municipalities {
    Table,
    OfficialCode,
}

#[derive(DeriveIden)]
enum JobRuns {
    Table,
    Id,
    JobName,
    Status,
    StartedAt,
    FinishedAt,
    Details,
    Error,
}

#[derive(DeriveIden)]
enum JobCursors {
    Table,
    JobName,
    CursorValue,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Places {
    Table,
    SourceUrl,
    LastSynced,
    SyncStatus,
}
