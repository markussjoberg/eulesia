//! Add `municipality_code` back-reference column to `locations`.
//!
//! Part of the Phase 2 flat-feed redesign: the `locations` table becomes the
//! canonical hierarchical source for places, and every `municipalities` row
//! will be mirrored into `locations` via this code. Keeping both tables
//! side-by-side lets us migrate callers incrementally.
//!
//! The column is nullable because most `locations` rows (OSM-imported) do not
//! correspond to a Finnish municipality. A partial unique index enforces that
//! at most one location row can mirror a given `official_code`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("locations"))
                    .add_column_if_not_exists(
                        ColumnDef::new(Alias::new("municipality_code"))
                            .string_len(10)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Partial unique index: null values are allowed to repeat, but every
        // non-null code must be unique across `locations`.
        manager
            .get_connection()
            .execute_unprepared(
                r"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_municipality_code
                ON locations (municipality_code)
                WHERE municipality_code IS NOT NULL
                ",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS uq_locations_municipality_code")
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("locations"))
                    .drop_column(Alias::new("municipality_code"))
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
