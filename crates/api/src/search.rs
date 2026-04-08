use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use sea_orm::sea_query::Expr;
use sea_orm::sea_query::extension::postgres::PgExpr;
use sea_orm::{Condition, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::{Deserialize, Serialize};
use tracing::warn;

use eulesia_common::error::ApiError;
use eulesia_db::entities::municipalities;

use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    q: String,
    r#type: Option<String>, // "threads" | "users"
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    query: String,
    processing_time_ms: i64,
    threads: Vec<serde_json::Value>,
    users: Vec<serde_json::Value>,
    places: Vec<serde_json::Value>,
    municipalities: Vec<serde_json::Value>,
    locations: Vec<serde_json::Value>,
    tags: Vec<serde_json::Value>,
}

async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResult>, ApiError> {
    let started = std::time::Instant::now();
    let limit = params.limit.unwrap_or(20).min(100);
    let search_client = state.search_client.as_ref();

    let mut result = SearchResult {
        query: params.q.clone(),
        processing_time_ms: 0,
        threads: vec![],
        users: vec![],
        places: vec![],
        municipalities: vec![],
        locations: vec![],
        tags: vec![],
    };

    let search_type = params.r#type.as_deref();

    if let Some(client) = search_client {
        if search_type.is_none() || search_type == Some("threads") {
            let threads_index = client.inner().index("threads");
            match threads_index
                .search()
                .with_query(&params.q)
                .with_limit(limit)
                .execute::<serde_json::Value>()
                .await
            {
                Ok(search_result) => {
                    result.threads = search_result.hits.into_iter().map(|h| h.result).collect();
                }
                Err(e) => {
                    warn!(error = %e, "search threads index failed");
                }
            }
        }
        if search_type.is_none() || search_type == Some("users") {
            let users_index = client.inner().index("users");
            match users_index
                .search()
                .with_query(&params.q)
                .with_limit(limit)
                .execute::<serde_json::Value>()
                .await
            {
                Ok(search_result) => {
                    result.users = search_result.hits.into_iter().map(|h| h.result).collect();
                }
                Err(e) => {
                    warn!(error = %e, "search users index failed");
                }
            }
        }
    }

    // Municipality search via DB (small dataset, no Meilisearch index needed)
    if search_type.is_none() || search_type == Some("municipalities") {
        let ilike_pattern = format!("%{}%", params.q);
        let municipalities = municipalities::Entity::find()
            .filter(
                Condition::any()
                    .add(Expr::col(municipalities::Column::Name).ilike(&ilike_pattern))
                    .add(Expr::col(municipalities::Column::NameFi).ilike(&ilike_pattern))
                    .add(Expr::col(municipalities::Column::NameSv).ilike(&ilike_pattern)),
            )
            .order_by_asc(municipalities::Column::Name)
            .limit(limit as u64)
            .all(&*state.db)
            .await
            .unwrap_or_default();

        result.municipalities = municipalities
            .into_iter()
            .map(|m| {
                serde_json::json!({
                    "id": m.id,
                    "name": m.name,
                    "nameFi": m.name_fi,
                    "region": m.region,
                })
            })
            .collect();
    }

    result.processing_time_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    Ok(Json(result))
}

async fn search_health(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let healthy = if let Some(client) = state.search_client.as_ref() {
        client.is_healthy().await
    } else {
        false
    };
    Ok(Json(serde_json::json!({ "healthy": healthy })))
}

/// GET /users/search — alias for search with type=users.
async fn user_search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let limit = params.limit.unwrap_or(10).min(50);

    if let Some(client) = state.search_client.as_ref() {
        let users_index = client.inner().index("users");
        match users_index
            .search()
            .with_query(&params.q)
            .with_limit(limit)
            .execute::<serde_json::Value>()
            .await
        {
            Ok(r) => Ok(Json(r.hits.into_iter().map(|h| h.result).collect())),
            Err(e) => {
                warn!(error = %e, "user search failed");
                Ok(Json(vec![]))
            }
        }
    } else {
        Ok(Json(vec![]))
    }
}

/// GET /search/threads — dedicated thread search.
async fn thread_search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let limit = params.limit.unwrap_or(20).min(100);

    if let Some(client) = state.search_client.as_ref() {
        let threads_index = client.inner().index("threads");
        match threads_index
            .search()
            .with_query(&params.q)
            .with_limit(limit)
            .execute::<serde_json::Value>()
            .await
        {
            Ok(r) => Ok(Json(r.hits.into_iter().map(|h| h.result).collect())),
            Err(e) => {
                warn!(error = %e, "thread search failed");
                Ok(Json(vec![]))
            }
        }
    } else {
        Ok(Json(vec![]))
    }
}

/// GET /search/places — dedicated place search.
async fn place_search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let limit = params.limit.unwrap_or(20).min(100);

    if let Some(client) = state.search_client.as_ref() {
        let places_index = client.inner().index("places");
        match places_index
            .search()
            .with_query(&params.q)
            .with_limit(limit)
            .execute::<serde_json::Value>()
            .await
        {
            Ok(r) => Ok(Json(r.hits.into_iter().map(|h| h.result).collect())),
            Err(e) => {
                warn!(error = %e, "place search failed");
                Ok(Json(vec![]))
            }
        }
    } else {
        Ok(Json(vec![]))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/search", get(search_handler))
        .route("/search/health", get(search_health))
        .route("/search/threads", get(thread_search))
        .route("/search/places", get(place_search))
        .route("/users/search", get(user_search))
        .route("/search/users", get(user_search))
}
