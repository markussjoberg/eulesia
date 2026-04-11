use axum::Json;
use axum::extract::{Path, Query, State};
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::OptionalAuth;
use eulesia_common::error::ApiError;
use eulesia_db::repo::blocks::BlockRepo;
use eulesia_db::repo::tags::TagRepo;
use eulesia_db::repo::threads::ThreadRepo;

use super::threads::enrich_threads;
use super::types::{TagWithCount, ThreadListParams, ThreadListResponse};

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

pub async fn list_tags(State(state): State<AppState>) -> Result<Json<Vec<TagWithCount>>, ApiError> {
    let tags = TagRepo::list_tags_with_counts(&state.db, 100)
        .await
        .map_err(db_err)?;

    let response = tags
        .into_iter()
        .map(|t| {
            // Derive display name: capitalize first letter
            let display_name = {
                let mut chars = t.tag.chars();
                match chars.next() {
                    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            };
            TagWithCount {
                tag: t.tag,
                count: t.count,
                display_name,
                category: None,
                description: None,
                scope: None,
            }
        })
        .collect();

    Ok(Json(response))
}

pub async fn get_tag_threads(
    opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Path(tag): Path<String>,
    Query(params): Query<ThreadListParams>,
) -> Result<Json<ThreadListResponse>, ApiError> {
    let user_id = opt_auth.0.as_ref().map(|a| a.user_id.0);
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(20).min(100);

    // Get ALL thread IDs for this tag (unpaginated).
    let (tag_thread_ids, _) = TagRepo::thread_ids_for_tag(&state.db, &tag, 0, 100_000)
        .await
        .map_err(db_err)?;

    // Compute block exclusions.
    let excluded: Vec<Uuid> = if let Some(uid) = user_id {
        let mut set = std::collections::HashSet::new();
        set.extend(
            BlockRepo::blocked_by_user(&state.db, uid)
                .await
                .map_err(db_err)?,
        );
        set.extend(
            BlockRepo::users_who_blocked(&state.db, uid)
                .await
                .map_err(db_err)?,
        );
        set.into_iter().collect()
    } else {
        vec![]
    };

    // Pass tag thread IDs into ThreadRepo::list so sorting, visibility filters,
    // and pagination are applied correctly against the intersected set.
    let sort = params.sort.as_deref().unwrap_or("recent");
    let (threads, total) = ThreadRepo::list(
        &state.db,
        params.scope.as_deref(),
        params.municipality_id,
        None,
        Some(&tag_thread_ids),
        &excluded,
        sort,
        None,
        offset,
        limit,
        false,
    )
    .await
    .map_err(db_err)?;

    let data = enrich_threads(&state.db, threads, user_id).await?;

    let page = offset / limit + 1;
    let has_more = offset + limit < total;
    Ok(Json(ThreadListResponse {
        data,
        total,
        page,
        limit,
        has_more,
        feed_scope: None,
        has_subscriptions: false,
    }))
}
