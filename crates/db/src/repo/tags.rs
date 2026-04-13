use sea_orm::*;
use serde::Serialize;
use uuid::Uuid;

use crate::entities::thread_tags;

#[derive(Debug, Serialize, FromQueryResult)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

pub struct TagRepo;

impl TagRepo {
    pub async fn add_tags(
        db: &DatabaseConnection,
        thread_id: Uuid,
        tags: &[String],
    ) -> Result<(), DbErr> {
        // Deduplicate input tags.
        let unique_tags: std::collections::BTreeSet<&str> =
            tags.iter().map(String::as_str).collect();
        if unique_tags.is_empty() {
            return Ok(());
        }
        let models: Vec<thread_tags::ActiveModel> = unique_tags
            .into_iter()
            .map(|t| thread_tags::ActiveModel {
                thread_id: Set(thread_id),
                tag: Set(t.to_string()),
            })
            .collect();
        thread_tags::Entity::insert_many(models).exec(db).await?;
        Ok(())
    }

    /// Like [`Self::add_tags`] but silently ignores duplicates that already
    /// exist. Used by the AI classification pipeline which runs after the
    /// user's own tags have already been saved.
    pub async fn add_tags_ignore_duplicates(
        db: &DatabaseConnection,
        thread_id: Uuid,
        tags: &[String],
    ) -> Result<(), DbErr> {
        let unique_tags: std::collections::BTreeSet<&str> =
            tags.iter().map(String::as_str).collect();
        if unique_tags.is_empty() {
            return Ok(());
        }
        for tag in unique_tags {
            let model = thread_tags::ActiveModel {
                thread_id: Set(thread_id),
                tag: Set(tag.to_string()),
            };
            // ON CONFLICT (thread_id, tag) DO NOTHING
            thread_tags::Entity::insert(model)
                .on_conflict(
                    sea_orm::sea_query::OnConflict::columns([
                        thread_tags::Column::ThreadId,
                        thread_tags::Column::Tag,
                    ])
                    .do_nothing()
                    .to_owned(),
                )
                .do_nothing()
                .exec(db)
                .await?;
        }
        Ok(())
    }

    pub async fn remove_tags(
        db: &DatabaseConnection,
        thread_id: Uuid,
        tags: &[String],
    ) -> Result<(), DbErr> {
        if tags.is_empty() {
            return Ok(());
        }
        thread_tags::Entity::delete_many()
            .filter(thread_tags::Column::ThreadId.eq(thread_id))
            .filter(thread_tags::Column::Tag.is_in(tags.to_vec()))
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn remove_all_tags(db: &DatabaseConnection, thread_id: Uuid) -> Result<(), DbErr> {
        thread_tags::Entity::delete_many()
            .filter(thread_tags::Column::ThreadId.eq(thread_id))
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn tags_for_thread(
        db: &DatabaseConnection,
        thread_id: Uuid,
    ) -> Result<Vec<String>, DbErr> {
        let items = thread_tags::Entity::find()
            .filter(thread_tags::Column::ThreadId.eq(thread_id))
            .all(db)
            .await?;
        Ok(items.into_iter().map(|t| t.tag).collect())
    }

    pub async fn tags_for_threads(
        db: &DatabaseConnection,
        thread_ids: &[Uuid],
    ) -> Result<Vec<thread_tags::Model>, DbErr> {
        if thread_ids.is_empty() {
            return Ok(vec![]);
        }
        thread_tags::Entity::find()
            .filter(thread_tags::Column::ThreadId.is_in(thread_ids.to_vec()))
            .all(db)
            .await
    }

    pub async fn list_tags_with_counts(
        db: &DatabaseConnection,
        limit: u64,
    ) -> Result<Vec<TagCount>, DbErr> {
        TagCount::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT tt.tag, COUNT(*)::bigint AS count FROM thread_tags tt JOIN threads t ON t.id = tt.thread_id WHERE t.deleted_at IS NULL AND t.is_hidden = false GROUP BY tt.tag ORDER BY count DESC LIMIT $1",
            [limit.into()],
        ))
        .all(db)
        .await
    }

    pub async fn thread_ids_for_tag(
        db: &DatabaseConnection,
        tag: &str,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<Uuid>, u64), DbErr> {
        let total = thread_tags::Entity::find()
            .filter(thread_tags::Column::Tag.eq(tag))
            .count(db)
            .await?;
        let items = thread_tags::Entity::find()
            .filter(thread_tags::Column::Tag.eq(tag))
            .offset(offset)
            .limit(limit)
            .all(db)
            .await?;
        Ok((items.into_iter().map(|t| t.thread_id).collect(), total))
    }
}
