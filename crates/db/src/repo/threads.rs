use sea_orm::prelude::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::entities::threads;
use crate::seed::EULESIA_SUMMARY_USER_ID;

pub struct ThreadRepo;

impl ThreadRepo {
    pub async fn create(
        db: &DatabaseConnection,
        model: threads::ActiveModel,
    ) -> Result<threads::Model, DbErr> {
        model.insert(db).await
    }

    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<threads::Model>, DbErr> {
        threads::Entity::find_by_id(id)
            .filter(threads::Column::DeletedAt.is_null())
            .filter(threads::Column::IsHidden.eq(false))
            .one(db)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list(
        db: &DatabaseConnection,
        scope: Option<&str>,
        municipality_id: Option<Uuid>,
        author_ids: Option<&[Uuid]>,
        thread_ids: Option<&[Uuid]>,
        excluded_author_ids: &[Uuid],
        sort: &str,
        top_period: Option<&str>,
        offset: u64,
        limit: u64,
        hide_empty_summaries: bool,
    ) -> Result<(Vec<threads::Model>, u64), DbErr> {
        let mut query = threads::Entity::find()
            .filter(threads::Column::DeletedAt.is_null())
            .filter(threads::Column::IsHidden.eq(false))
            .filter(threads::Column::ClubId.is_null());

        if let Some(s) = scope {
            query = query.filter(threads::Column::Scope.eq(s));
        }
        if let Some(mid) = municipality_id {
            query = query.filter(threads::Column::MunicipalityId.eq(mid));
        }
        if let Some(aids) = author_ids {
            if aids.is_empty() {
                return Ok((vec![], 0));
            }
            if aids.len() == 1 {
                query = query.filter(threads::Column::AuthorId.eq(aids[0]));
            } else {
                query = query.filter(threads::Column::AuthorId.is_in(aids.to_vec()));
            }
        }
        if let Some(ids) = thread_ids {
            if ids.is_empty() {
                return Ok((vec![], 0));
            }
            query = query.filter(threads::Column::Id.is_in(ids.to_vec()));
        }
        if !excluded_author_ids.is_empty() {
            query = query.filter(threads::Column::AuthorId.is_not_in(excluded_author_ids.to_vec()));
        }

        // Hide Eulesia Summary threads with no human engagement from the
        // explore feed. Summaries are still reachable via direct institution
        // links, follow feeds, and search — this just keeps the explore feed
        // human-centered until a summary has attracted discussion.
        if hide_empty_summaries {
            query = query.filter(
                Condition::any()
                    .add(threads::Column::AuthorId.ne(EULESIA_SUMMARY_USER_ID))
                    .add(threads::Column::ReplyCount.gt(0)),
            );
        }

        // For "top" sort with a time period, filter by created_at cutoff
        if sort == "top" {
            if let Some(period) = top_period {
                let now = chrono::Utc::now();
                let cutoff = match period {
                    "day" => Some(now - chrono::Duration::days(1)),
                    "week" => Some(now - chrono::Duration::weeks(1)),
                    "month" => Some(now - chrono::Duration::days(30)),
                    "year" => Some(now - chrono::Duration::days(365)),
                    _ => None, // "all" — no cutoff
                };
                if let Some(cutoff) = cutoff {
                    query = query.filter(threads::Column::CreatedAt.gte(cutoff.fixed_offset()));
                }
            }
        }

        let total = query.clone().count(db).await?;

        let query = match sort {
            "top" => query.order_by_desc(threads::Column::Score),
            "active" => query.order_by_desc(threads::Column::UpdatedAt),
            "new" => query.order_by_desc(threads::Column::CreatedAt),
            _ => query.order_by_desc(threads::Column::CreatedAt), // "recent" default
        };

        let items = query.offset(offset).limit(limit).all(db).await?;
        Ok((items, total))
    }

    pub async fn update(
        db: &DatabaseConnection,
        model: threads::ActiveModel,
    ) -> Result<threads::Model, DbErr> {
        model.update(db).await
    }

    pub async fn soft_delete(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        threads::Entity::update_many()
            .filter(threads::Column::Id.eq(id))
            .col_expr(threads::Column::DeletedAt, Expr::current_timestamp().into())
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn increment_view_count(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        threads::Entity::update_many()
            .filter(threads::Column::Id.eq(id))
            .col_expr(
                threads::Column::ViewCount,
                Expr::col(threads::Column::ViewCount).add(1),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn increment_reply_count(
        db: &DatabaseConnection,
        id: Uuid,
        delta: i32,
    ) -> Result<(), DbErr> {
        threads::Entity::update_many()
            .filter(threads::Column::Id.eq(id))
            .col_expr(
                threads::Column::ReplyCount,
                Expr::col(threads::Column::ReplyCount).add(delta),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    pub async fn update_score(db: &DatabaseConnection, id: Uuid) -> Result<(), DbErr> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE threads SET score = (SELECT COALESCE(SUM(value), 0) FROM thread_votes WHERE thread_id = $1) WHERE id = $1",
            [id.into()],
        ))
        .await?;
        Ok(())
    }
}
