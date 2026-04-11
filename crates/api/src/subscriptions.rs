use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::agora::threads::enrich_threads;
use crate::agora::types::ThreadListResponse;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_db::repo::subscriptions::SubscriptionRepo;
use eulesia_db::repo::threads::ThreadRepo;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeRequest {
    entity_type: String,
    entity_id: String,
    #[serde(default = "default_notify")]
    notify: Option<String>,
}

#[allow(clippy::unnecessary_wraps)]
fn default_notify() -> Option<String> {
    Some("all".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionResponse {
    entity_type: String,
    entity_id: String,
    notify: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionCheckResponse {
    subscribed: bool,
    notify: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedParams {
    #[serde(default = "default_limit")]
    limit: u64,
    #[serde(default)]
    offset: u64,
}

const fn default_limit() -> u64 {
    20
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /subscriptions — upsert a subscription.
async fn subscribe(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<SubscribeRequest>,
) -> Result<Json<SubscriptionResponse>, ApiError> {
    let notify = req.notify.as_deref().unwrap_or("all");

    let model = SubscriptionRepo::upsert(
        &state.db,
        auth.user_id.0,
        &req.entity_type,
        &req.entity_id,
        notify,
    )
    .await
    .map_err(db_err)?;

    Ok(Json(SubscriptionResponse {
        entity_type: model.entity_type,
        entity_id: model.entity_id,
        notify: model.notify,
        created_at: model.created_at.to_rfc3339(),
    }))
}

/// DELETE `/subscriptions/{entity_type}/{entity_id}`
async fn unsubscribe(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((entity_type, entity_id)): Path<(String, String)>,
) -> Result<(), ApiError> {
    SubscriptionRepo::delete(&state.db, auth.user_id.0, &entity_type, &entity_id)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// GET /subscriptions — list all subscriptions for the current user.
async fn list_subscriptions(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<SubscriptionResponse>>, ApiError> {
    let items = SubscriptionRepo::list_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?;

    let data = items
        .into_iter()
        .map(|m| SubscriptionResponse {
            entity_type: m.entity_type,
            entity_id: m.entity_id,
            notify: m.notify,
            created_at: m.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(data))
}

/// GET `/subscriptions/check/{entity_type}/{entity_id}`
async fn check_subscription(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((entity_type, entity_id)): Path<(String, String)>,
) -> Result<Json<SubscriptionCheckResponse>, ApiError> {
    let sub = SubscriptionRepo::check(&state.db, auth.user_id.0, &entity_type, &entity_id)
        .await
        .map_err(db_err)?;

    Ok(Json(SubscriptionCheckResponse {
        subscribed: sub.is_some(),
        notify: sub.map(|s| s.notify),
    }))
}

/// GET /subscriptions/feed — personalized thread feed based on subscriptions.
async fn subscription_feed(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<FeedParams>,
) -> Result<Json<ThreadListResponse>, ApiError> {
    let limit = params.limit.clamp(1, 100);
    let offset = params.offset;

    let (thread_ids, total) =
        SubscriptionRepo::feed_thread_ids(&state.db, auth.user_id.0, limit, offset)
            .await
            .map_err(db_err)?;

    let page = offset / limit + 1;
    let has_subscriptions = total > 0;

    if thread_ids.is_empty() {
        return Ok(Json(ThreadListResponse {
            data: vec![],
            total: 0,
            page,
            limit,
            has_more: false,
            feed_scope: None,
            has_subscriptions,
        }));
    }

    // Fetch full thread models using the existing repo (thread_ids filter, no scope/author filter).
    let (threads, _) = ThreadRepo::list(
        &state.db,
        None,
        None,
        None,
        Some(&thread_ids),
        &[],
        "recent",
        None,
        0,
        limit,
        false,
    )
    .await
    .map_err(db_err)?;

    let data = enrich_threads(&state.db, threads, Some(auth.user_id.0)).await?;
    let has_more = offset + limit < total;

    Ok(Json(ThreadListResponse {
        data,
        total,
        page,
        limit,
        has_more,
        feed_scope: None,
        has_subscriptions,
    }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/subscriptions", post(subscribe).get(list_subscriptions))
        .route(
            "/subscriptions/check/{entity_type}/{entity_id}",
            get(check_subscription),
        )
        .route("/subscriptions/feed", get(subscription_feed))
        .route(
            "/subscriptions/{entity_type}/{entity_id}",
            delete(unsubscribe),
        )
}
