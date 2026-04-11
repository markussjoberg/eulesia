//! Create the `thread_locations` join table.
//!
//! Replaces the parallel `threads.country / municipality_id / location_id /
//! place_id` columns with a single hierarchical join: one row per (thread,
//! location) pair where `location` traces the `locations.parent_id` chain
//! from the user-chosen primary location up to the country level.
//!
//! `depth = 0` marks the row the user actually picked. `depth > 0` rows are
//! derived ancestors the server added automatically, so that a post tagged to
//! Helsinki also appears in Uusimaa and Finland feeds without the user having
//! to tick each level.
//!
//! A partial unique index guarantees exactly one primary row per thread.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ThreadLocations::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(ThreadLocations::ThreadId).uuid().not_null())
                    .col(
                        ColumnDef::new(ThreadLocations::LocationId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ThreadLocations::IsPrimary)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(ThreadLocations::Depth)
                            .small_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ThreadLocations::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .primary_key(
                        Index::create()
                            .col(ThreadLocations::ThreadId)
                            .col(ThreadLocations::LocationId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_thread_locations_thread")
                            .from(ThreadLocations::Table, ThreadLocations::ThreadId)
                            .to(Alias::new("threads"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_thread_locations_location")
                            .from(ThreadLocations::Table, ThreadLocations::LocationId)
                            .to(Alias::new("locations"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Reverse-lookup index: "which threads live in this location?"
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_thread_locations_location")
                    .table(ThreadLocations::Table)
                    .col(ThreadLocations::LocationId)
                    .col(ThreadLocations::ThreadId)
                    .to_owned(),
            )
            .await?;

        // Exactly one primary row per thread. Enforced as a partial unique
        // index over `is_primary = true` so non-primary rows can repeat.
        manager
            .get_connection()
            .execute_unprepared(
                r"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_locations_primary
                ON thread_locations (thread_id)
                WHERE is_primary = true
                ",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS uq_thread_locations_primary")
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_thread_locations_location")
                    .table(ThreadLocations::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(ThreadLocations::Table).to_owned())
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum ThreadLocations {
    Table,
    ThreadId,
    LocationId,
    IsPrimary,
    Depth,
    CreatedAt,
}
