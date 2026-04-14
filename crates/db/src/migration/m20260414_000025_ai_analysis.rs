//! Add AI content analysis columns to threads.
//!
//! `ai_analysis` stores the full `ContentUnderstanding` JSON produced by
//! Mistral when classifying a thread. Contains tags, language, location
//! hints, content type, quality score, sentiment, and entities.
//!
//! `flagged_at` / `flagged_reason` support the auto-flag moderaatio
//! pipeline: when the AI detects low quality or hateful content, these
//! columns are set so moderators can review.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .add_column(ColumnDef::new(Threads::AiAnalysis).json_binary().null())
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .add_column(
                        ColumnDef::new(Threads::FlaggedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .add_column(ColumnDef::new(Threads::FlaggedReason).text().null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .drop_column(Threads::FlaggedReason)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .drop_column(Threads::FlaggedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Threads::Table)
                    .drop_column(Threads::AiAnalysis)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Threads {
    Table,
    AiAnalysis,
    FlaggedAt,
    FlaggedReason,
}
