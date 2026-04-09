use sea_orm_migration::prelude::*;

pub struct Migration;

const MIGRATION_NAME: &str = "m20260409_000022_municipality_designation";

impl MigrationName for Migration {
    fn name(&self) -> &str {
        MIGRATION_NAME
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add designation column ("kaupunki" or "kunta") to municipalities
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("municipalities"))
                    .add_column(ColumnDef::new(Alias::new("designation")).string().null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("municipalities"))
                    .drop_column(Alias::new("designation"))
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}
