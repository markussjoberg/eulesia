use std::fmt::Write;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use eulesia_common::types::MapPointType;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Statement, Value,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{Coordinates, new_id};
use eulesia_db::entities::{clubs, municipalities, places, threads};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MapPoint {
    pub id: Uuid,
    pub point_type: MapPointType,
    pub name: String,
    pub coordinates: Coordinates,
    pub meta: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MapPointsResponse {
    points: Vec<MapPoint>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PlaceResponse {
    pub id: Uuid,
    pub name: String,
    pub name_fi: Option<String>,
    pub name_sv: Option<String>,
    pub description: Option<String>,
    pub coordinates: Option<Coordinates>,
    pub place_type: String,
    pub category: Option<String>,
    pub municipality_id: Option<Uuid>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoundsParams {
    north: f64,
    south: f64,
    east: f64,
    west: f64,
    types: Option<String>,
    categories: Option<String>,
    time_preset: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    scope: Option<String>,
    language: Option<String>,
    tags: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceListParams {
    page: Option<u64>,
    limit: Option<u64>,
    r#type: Option<String>,
    category: Option<String>,
    municipality_id: Option<Uuid>,
    search: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePlaceRequest {
    name: String,
    name_fi: Option<String>,
    name_sv: Option<String>,
    name_en: Option<String>,
    description: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    place_type: String,
    category: Option<String>,
    municipality_id: Option<Uuid>,
    location_id: Option<Uuid>,
    country: Option<String>,
    address: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    pub category: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MunicipalityResponse {
    pub id: Uuid,
    pub name: String,
    pub name_fi: Option<String>,
    pub name_sv: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub population: Option<i32>,
    pub coordinates: Option<Coordinates>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MapThreadSummary {
    id: Uuid,
    title: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MapClubSummary {
    id: Uuid,
    name: String,
    member_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaginatedPlacesResponse {
    items: Vec<PlaceResponse>,
    total: u64,
    page: u64,
    limit: u64,
    has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationDetailsResponse {
    id: Uuid,
    name: String,
    coordinates: Option<Coordinates>,
    threads: Vec<MapThreadSummary>,
    clubs: Vec<MapClubSummary>,
    municipality: Option<MunicipalityResponse>,
    place: Option<PlaceResponse>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn decimal_to_f64(d: sea_orm::prelude::Decimal) -> Option<f64> {
    d.to_string().parse().ok()
}

fn decimal_from_f64(value: Option<f64>) -> Option<sea_orm::prelude::Decimal> {
    value.and_then(sea_orm::prelude::Decimal::from_f64_retain)
}

fn parse_csv(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_type_filters(value: Option<&str>) -> Vec<MapPointType> {
    parse_csv(value)
        .into_iter()
        .filter_map(|item| item.parse().ok())
        .collect()
}

fn effective_date_range(
    time_preset: Option<&str>,
    date_from: Option<&str>,
    date_to: Option<&str>,
) -> (
    Option<chrono::DateTime<chrono::FixedOffset>>,
    Option<chrono::DateTime<chrono::FixedOffset>>,
) {
    let explicit_from =
        date_from.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    let explicit_to = date_to.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());

    if explicit_from.is_some() || explicit_to.is_some() {
        return (explicit_from, explicit_to);
    }

    let now = chrono::Utc::now().fixed_offset();
    let derived_from = match time_preset {
        Some("week") => Some(now - chrono::Duration::days(7)),
        Some("month") => Some(now - chrono::Duration::days(30)),
        Some("year") => Some(now - chrono::Duration::days(365)),
        _ => None,
    };

    (derived_from, None)
}

fn contains_type(filters: &[MapPointType], candidate: MapPointType) -> bool {
    filters.is_empty() || filters.contains(&candidate)
}

fn place_to_response(place: places::Model) -> PlaceResponse {
    PlaceResponse {
        id: place.id,
        name: place.name,
        name_fi: place.name_fi,
        name_sv: place.name_sv,
        description: place.description,
        coordinates: Coordinates::from_options(
            place.latitude.and_then(decimal_to_f64),
            place.longitude.and_then(decimal_to_f64),
        ),
        place_type: place.r#type,
        category: place.category,
        municipality_id: place.municipality_id,
        created_at: place.created_at.to_rfc3339(),
    }
}

pub(crate) fn municipality_to_response(
    municipality: municipalities::Model,
) -> MunicipalityResponse {
    MunicipalityResponse {
        id: municipality.id,
        name: municipality.name,
        name_fi: municipality.name_fi,
        name_sv: municipality.name_sv,
        region: municipality.region,
        country: municipality.country,
        population: municipality.population,
        coordinates: Coordinates::from_options(
            municipality.latitude.and_then(decimal_to_f64),
            municipality.longitude.and_then(decimal_to_f64),
        ),
    }
}

pub(crate) async fn municipality_response_by_id(
    db: &sea_orm::DatabaseConnection,
    municipality_id: Option<Uuid>,
) -> Result<Option<MunicipalityResponse>, ApiError> {
    let Some(municipality_id) = municipality_id else {
        return Ok(None);
    };

    let municipality = municipalities::Entity::find_by_id(municipality_id)
        .one(db)
        .await
        .map_err(|e| ApiError::Database(format!("find municipality: {e}")))?;

    Ok(municipality.map(municipality_to_response))
}

fn push_value<T>(values: &mut Vec<Value>, value: T) -> usize
where
    T: Into<Value>,
{
    values.push(value.into());
    values.len()
}

fn append_thread_filters(
    sql: &mut String,
    values: &mut Vec<Value>,
    params: &BoundsParams,
    table_alias: &str,
    club_only: bool,
) {
    if club_only {
        let _ = write!(sql, " AND {table_alias}.club_id IS NOT NULL");
    } else {
        let _ = write!(sql, " AND {table_alias}.club_id IS NULL");
    }

    if let Some(scope) = params.scope.as_deref() {
        let position = push_value(values, scope.to_owned());
        let _ = write!(sql, " AND {table_alias}.scope = ${position}");
    }

    if let Some(language) = params.language.as_deref() {
        let position = push_value(values, language.to_owned());
        let _ = write!(sql, " AND {table_alias}.language = ${position}");
    }

    let (date_from, date_to) = effective_date_range(
        params.time_preset.as_deref(),
        params.date_from.as_deref(),
        params.date_to.as_deref(),
    );
    if let Some(date_from) = date_from {
        let position = push_value(values, date_from);
        let _ = write!(sql, " AND {table_alias}.created_at >= ${position}");
    }
    if let Some(date_to) = date_to {
        let position = push_value(values, date_to);
        let _ = write!(sql, " AND {table_alias}.created_at <= ${position}");
    }

    let tags = parse_csv(params.tags.as_deref());
    if !tags.is_empty() {
        let mut placeholders = Vec::with_capacity(tags.len());
        for tag in tags {
            let position = push_value(values, tag);
            placeholders.push(format!("${position}"));
        }
        let _ = write!(
            sql,
            " AND EXISTS (
                SELECT 1
                FROM thread_tags tt
                WHERE tt.thread_id = {table_alias}.id
                  AND tt.tag IN ({})
              )",
            placeholders.join(",")
        );
    }
}

const fn municipality_thread_count_subquery() -> &'static str {
    r"
        SELECT COUNT(*)
        FROM threads t
        WHERE t.municipality_id = m.id
          AND t.deleted_at IS NULL
          AND t.is_hidden = false
    "
}

fn parse_map_point_fields(
    row: &sea_orm::QueryResult,
    point_type: MapPointType,
    label: &str,
    meta: serde_json::Value,
) -> Result<MapPoint, ApiError> {
    Ok(MapPoint {
        id: row
            .try_get("", "id")
            .map_err(|e| ApiError::Database(format!("parse {label} id: {e}")))?,
        point_type,
        name: row
            .try_get("", "name")
            .map_err(|e| ApiError::Database(format!("parse {label} name: {e}")))?,
        coordinates: Coordinates {
            latitude: row
                .try_get("", "lat")
                .map_err(|e| ApiError::Database(format!("parse {label} lat: {e}")))?,
            longitude: row
                .try_get("", "lon")
                .map_err(|e| ApiError::Database(format!("parse {label} lon: {e}")))?,
        },
        meta,
    })
}

fn thread_to_summary(thread: threads::Model) -> MapThreadSummary {
    MapThreadSummary {
        id: thread.id,
        title: thread.title,
        created_at: thread.created_at.to_rfc3339(),
    }
}

async fn visible_threads_for_place(
    db: &sea_orm::DatabaseConnection,
    place_id: Uuid,
) -> Result<Vec<MapThreadSummary>, ApiError> {
    threads::Entity::find()
        .filter(threads::Column::PlaceId.eq(place_id))
        .filter(threads::Column::DeletedAt.is_null())
        .filter(threads::Column::IsHidden.eq(false))
        .order_by_desc(threads::Column::CreatedAt)
        .limit(5)
        .all(db)
        .await
        .map_err(|e| ApiError::Database(format!("list place threads: {e}")))
        .map(|threads| threads.into_iter().map(thread_to_summary).collect())
}

async fn query_thread_points(
    db: &sea_orm::DatabaseConnection,
    params: &BoundsParams,
    club_only: bool,
) -> Result<Vec<MapPoint>, ApiError> {
    let mut sql = String::from(
        r"
        SELECT
          t.id,
          t.title AS name,
          t.latitude::float8 AS lat,
          t.longitude::float8 AS lon,
          t.scope,
          t.language,
          t.reply_count,
          t.score
        FROM threads t
        WHERE t.latitude IS NOT NULL
          AND t.longitude IS NOT NULL
          AND t.deleted_at IS NULL
          AND t.is_hidden = false
          AND t.latitude BETWEEN $1 AND $2
          AND t.longitude BETWEEN $3 AND $4
        ",
    );

    let mut values = vec![
        params.south.into(),
        params.north.into(),
        params.west.into(),
        params.east.into(),
    ];

    append_thread_filters(&mut sql, &mut values, params, "t", club_only);

    sql.push_str(" ORDER BY t.created_at DESC LIMIT 500");

    let rows = db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            values,
        ))
        .await
        .map_err(|e| ApiError::Database(format!("map thread query: {e}")))?;

    let point_type = if club_only {
        MapPointType::Club
    } else {
        MapPointType::Thread
    };

    rows.into_iter()
        .map(|row| {
            let meta = serde_json::json!({
                "scope": row.try_get::<String>("", "scope").ok(),
                "language": row.try_get::<Option<String>>("", "language").ok().flatten(),
                "replyCount": row.try_get::<i32>("", "reply_count").ok(),
                "score": row.try_get::<i32>("", "score").ok(),
            });
            parse_map_point_fields(&row, point_type, "map thread", meta)
        })
        .collect()
}

async fn query_place_points(
    db: &sea_orm::DatabaseConnection,
    params: &BoundsParams,
) -> Result<Vec<MapPoint>, ApiError> {
    let mut sql = String::from(
        r"
        SELECT
          p.id,
          p.name,
          p.latitude::float8 AS lat,
          p.longitude::float8 AS lon,
          p.category
        FROM places p
        WHERE p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          AND p.latitude BETWEEN $1 AND $2
          AND p.longitude BETWEEN $3 AND $4
        ",
    );

    let mut values = vec![
        params.south.into(),
        params.north.into(),
        params.west.into(),
        params.east.into(),
    ];

    let categories = parse_csv(params.categories.as_deref());
    if !categories.is_empty() {
        let mut placeholders = Vec::with_capacity(categories.len());
        for category in categories {
            let position = push_value(&mut values, category);
            placeholders.push(format!("${position}"));
        }
        let _ = write!(sql, " AND p.category IN ({})", placeholders.join(","));
    }

    sql.push_str(" ORDER BY p.name ASC LIMIT 500");

    let rows = db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            values,
        ))
        .await
        .map_err(|e| ApiError::Database(format!("map place query: {e}")))?;

    rows.into_iter()
        .map(|row| {
            let meta = serde_json::json!({
                "category": row.try_get::<Option<String>>("", "category").ok().flatten(),
            });
            parse_map_point_fields(&row, MapPointType::Place, "map place", meta)
        })
        .collect()
}

async fn query_municipality_points(
    db: &sea_orm::DatabaseConnection,
    params: &BoundsParams,
) -> Result<Vec<MapPoint>, ApiError> {
    let values = vec![
        params.south.into(),
        params.north.into(),
        params.west.into(),
        params.east.into(),
    ];

    let thread_count_sql = municipality_thread_count_subquery();

    let mut sql = String::from(
        r"
        SELECT
          m.id,
          m.name,
          m.latitude::float8 AS lat,
          m.longitude::float8 AS lon,
          (
        ",
    );
    sql.push_str(thread_count_sql);
    sql.push_str(
        r"
            )::bigint AS thread_count
        FROM municipalities m
        WHERE m.latitude IS NOT NULL
          AND m.longitude IS NOT NULL
          AND m.latitude BETWEEN $1 AND $2
          AND m.longitude BETWEEN $3 AND $4
        ORDER BY m.name ASC
        LIMIT 500
        ",
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            values,
        ))
        .await
        .map_err(|e| ApiError::Database(format!("map municipality query: {e}")))?;

    rows.into_iter()
        .map(|row| {
            let meta = serde_json::json!({
                "threadCount": row.try_get::<i64>("", "thread_count").ok(),
            });
            parse_map_point_fields(&row, MapPointType::Municipality, "municipality", meta)
        })
        .collect()
}

async fn recent_threads_for_municipality(
    db: &sea_orm::DatabaseConnection,
    municipality_id: Uuid,
    exclude_thread_id: Option<Uuid>,
) -> Result<Vec<MapThreadSummary>, ApiError> {
    let mut query = threads::Entity::find()
        .filter(threads::Column::MunicipalityId.eq(municipality_id))
        .filter(threads::Column::DeletedAt.is_null())
        .filter(threads::Column::IsHidden.eq(false))
        .order_by_desc(threads::Column::CreatedAt)
        .limit(5);

    if let Some(thread_id) = exclude_thread_id {
        query = query.filter(threads::Column::Id.ne(thread_id));
    }

    query
        .all(db)
        .await
        .map_err(|e| ApiError::Database(format!("list municipality threads: {e}")))
        .map(|threads| threads.into_iter().map(thread_to_summary).collect())
}

async fn place_by_id(
    db: &sea_orm::DatabaseConnection,
    place_id: Uuid,
) -> Result<Option<PlaceResponse>, ApiError> {
    let place = places::Entity::find_by_id(place_id)
        .one(db)
        .await
        .map_err(|e| ApiError::Database(format!("find place: {e}")))?;
    Ok(place.map(place_to_response))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn get_map_points(
    State(state): State<AppState>,
    Query(params): Query<BoundsParams>,
) -> Result<Json<MapPointsResponse>, ApiError> {
    let type_filters = parse_type_filters(params.types.as_deref());
    let mut points = Vec::new();

    if contains_type(&type_filters, MapPointType::Thread) {
        points.extend(query_thread_points(&state.db, &params, false).await?);
    }
    if contains_type(&type_filters, MapPointType::Club) {
        points.extend(query_thread_points(&state.db, &params, true).await?);
    }
    if contains_type(&type_filters, MapPointType::Place) {
        points.extend(query_place_points(&state.db, &params).await?);
    }
    if contains_type(&type_filters, MapPointType::Municipality) {
        points.extend(query_municipality_points(&state.db, &params).await?);
    }

    Ok(Json(MapPointsResponse { points }))
}

async fn list_places(
    State(state): State<AppState>,
    Query(params): Query<PlaceListParams>,
) -> Result<Json<PaginatedPlacesResponse>, ApiError> {
    let page = params.page.unwrap_or(1).max(1);
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = (page - 1)
        .checked_mul(limit)
        .ok_or_else(|| ApiError::BadRequest("page value too large".into()))?;

    let mut query = places::Entity::find();

    if let Some(ref place_type) = params.r#type {
        query = query.filter(places::Column::Type.eq(place_type.as_str()));
    }
    if let Some(ref category) = params.category {
        query = query.filter(places::Column::Category.eq(category.as_str()));
    }
    if let Some(municipality_id) = params.municipality_id {
        query = query.filter(places::Column::MunicipalityId.eq(municipality_id));
    }
    if let Some(ref search) = params.search {
        let pattern = format!("%{}%", search.trim());
        if !search.trim().is_empty() {
            query = query.filter(
                places::Column::Name
                    .like(&pattern)
                    .or(places::Column::Description.like(&pattern)),
            );
        }
    }

    let total = query
        .clone()
        .count(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("count places: {e}")))?;

    let items = query
        .order_by_asc(places::Column::Name)
        .offset(offset)
        .limit(limit)
        .all(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("list places: {e}")))?;

    Ok(Json(PaginatedPlacesResponse {
        items: items.into_iter().map(place_to_response).collect(),
        total,
        page,
        limit,
        has_more: offset.saturating_add(limit) < total,
    }))
}

async fn create_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreatePlaceRequest>,
) -> Result<Json<PlaceResponse>, ApiError> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::BadRequest(String::from("name must not be empty")));
    }

    let now = chrono::Utc::now().fixed_offset();
    let place = places::ActiveModel {
        id: Set(new_id()),
        name: Set(name),
        name_fi: Set(req.name_fi),
        name_sv: Set(req.name_sv),
        name_en: Set(req.name_en),
        description: Set(req.description),
        latitude: Set(decimal_from_f64(req.latitude)),
        longitude: Set(decimal_from_f64(req.longitude)),
        r#type: Set(req.place_type),
        category: Set(req.category),
        municipality_id: Set(req.municipality_id),
        location_id: Set(req.location_id),
        country: Set(req.country),
        address: Set(req.address),
        source: Set(String::from("user")),
        created_by: Set(Some(auth.user_id.0)),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&*state.db)
    .await
    .map_err(|e| ApiError::Database(format!("create place: {e}")))?;

    Ok(Json(place_to_response(place)))
}

async fn place_categories(
    State(state): State<AppState>,
) -> Result<Json<Vec<CategoryCount>>, ApiError> {
    let rows = state
        .db
        .query_all(Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            String::from(
                r"
                SELECT category, COUNT(*) AS count
                FROM places
                WHERE category IS NOT NULL
                GROUP BY category
                ORDER BY count DESC
                ",
            ),
        ))
        .await
        .map_err(|e| ApiError::Database(format!("place categories query: {e}")))?;

    rows.into_iter()
        .map(|row| {
            Ok(CategoryCount {
                category: row
                    .try_get("", "category")
                    .map_err(|e| ApiError::Database(format!("parse category: {e}")))?,
                count: row
                    .try_get("", "count")
                    .map_err(|e| ApiError::Database(format!("parse count: {e}")))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()
        .map(Json)
}

async fn list_municipalities(
    State(state): State<AppState>,
) -> Result<Json<Vec<MunicipalityResponse>>, ApiError> {
    let municipalities = municipalities::Entity::find()
        .order_by_asc(municipalities::Column::Name)
        .all(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("list municipalities: {e}")))?;

    Ok(Json(
        municipalities
            .into_iter()
            .map(municipality_to_response)
            .collect(),
    ))
}

async fn map_location_detail(
    State(state): State<AppState>,
    Path((location_type, id)): Path<(String, Uuid)>,
) -> Result<Json<LocationDetailsResponse>, ApiError> {
    match location_type.as_str() {
        "thread" | "club" => {
            let thread = threads::Entity::find_by_id(id)
                .one(&*state.db)
                .await
                .map_err(|e| ApiError::Database(format!("find thread: {e}")))?
                .filter(|thread| thread.deleted_at.is_none())
                .ok_or_else(|| ApiError::NotFound(String::from("thread not found")))?;

            let municipality =
                municipality_response_by_id(&state.db, thread.municipality_id).await?;
            let place = if let Some(place_id) = thread.place_id {
                place_by_id(&state.db, place_id).await?
            } else {
                None
            };
            let related_threads = match thread.municipality_id {
                Some(municipality_id) => {
                    recent_threads_for_municipality(&state.db, municipality_id, Some(thread.id))
                        .await?
                }
                None => vec![],
            };
            let clubs = if let Some(club_id) = thread.club_id {
                clubs::Entity::find_by_id(club_id)
                    .one(&*state.db)
                    .await
                    .map_err(|e| ApiError::Database(format!("find club: {e}")))?
                    .map(|club| {
                        vec![MapClubSummary {
                            id: club.id,
                            name: club.name,
                            member_count: club.member_count,
                        }]
                    })
                    .unwrap_or_default()
            } else {
                vec![]
            };

            Ok(Json(LocationDetailsResponse {
                id: thread.id,
                name: thread.title,
                coordinates: Coordinates::from_options(
                    thread.latitude.and_then(decimal_to_f64),
                    thread.longitude.and_then(decimal_to_f64),
                ),
                threads: related_threads,
                clubs,
                municipality,
                place,
            }))
        }
        "place" => {
            let place = places::Entity::find_by_id(id)
                .one(&*state.db)
                .await
                .map_err(|e| ApiError::Database(format!("find place: {e}")))?
                .ok_or_else(|| ApiError::NotFound(String::from("place not found")))?;

            let threads = visible_threads_for_place(&state.db, place.id).await?;
            let municipality =
                municipality_response_by_id(&state.db, place.municipality_id).await?;
            let place_response = place_to_response(place.clone());

            Ok(Json(LocationDetailsResponse {
                id: place.id,
                name: place.name,
                coordinates: Coordinates::from_options(
                    place.latitude.and_then(decimal_to_f64),
                    place.longitude.and_then(decimal_to_f64),
                ),
                threads,
                clubs: vec![],
                municipality,
                place: Some(place_response),
            }))
        }
        "municipality" => {
            let municipality = municipalities::Entity::find_by_id(id)
                .one(&*state.db)
                .await
                .map_err(|e| ApiError::Database(format!("find municipality: {e}")))?
                .ok_or_else(|| ApiError::NotFound(String::from("municipality not found")))?;

            let related_threads =
                recent_threads_for_municipality(&state.db, municipality.id, None).await?;
            let municipality_response = municipality_to_response(municipality.clone());

            Ok(Json(LocationDetailsResponse {
                id: municipality.id,
                name: municipality.name,
                coordinates: Coordinates::from_options(
                    municipality.latitude.and_then(decimal_to_f64),
                    municipality.longitude.and_then(decimal_to_f64),
                ),
                threads: related_threads,
                clubs: vec![],
                municipality: Some(municipality_response),
                place: None,
            }))
        }
        _ => Err(ApiError::NotFound(String::from("unknown location type"))),
    }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/map/points", get(get_map_points))
        .route("/map/location/{type}/{id}", get(map_location_detail))
        .route("/map/places/categories", get(place_categories))
        .route("/map/places", get(list_places).post(create_place))
        .route("/map/municipalities", get(list_municipalities))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_point_serializes_correctly() {
        let point = MapPoint {
            id: Uuid::nil(),
            point_type: MapPointType::Club,
            name: String::from("Test Club"),
            coordinates: Coordinates {
                latitude: 60.17,
                longitude: 24.94,
            },
            meta: serde_json::json!({}),
        };

        let json = serde_json::to_value(&point).unwrap();
        let obj = json.as_object().unwrap();
        for key in ["id", "pointType", "name", "coordinates", "meta"] {
            assert!(obj.contains_key(key), "missing map point field: {key}");
        }
        assert_eq!(obj["pointType"], "club");
    }

    #[test]
    fn map_points_response_shape() {
        let response = MapPointsResponse {
            points: vec![MapPoint {
                id: Uuid::nil(),
                point_type: MapPointType::Thread,
                name: String::from("Test"),
                coordinates: Coordinates {
                    latitude: 60.0,
                    longitude: 25.0,
                },
                meta: serde_json::json!({}),
            }],
        };

        let json = serde_json::to_value(&response).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("points"));
        assert_eq!(obj["points"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn type_filter_parsing_accepts_known_point_types() {
        let parsed = parse_type_filters(Some("thread,club,place"));
        assert_eq!(parsed.len(), 3);
        assert!(parsed.contains(&MapPointType::Thread));
        assert!(parsed.contains(&MapPointType::Club));
        assert!(parsed.contains(&MapPointType::Place));
    }

    #[test]
    fn thread_filter_helper_applies_all_requested_predicates() {
        let params = BoundsParams {
            north: 61.0,
            south: 60.0,
            east: 26.0,
            west: 24.0,
            types: None,
            categories: None,
            time_preset: Some(String::from("week")),
            date_from: None,
            date_to: None,
            scope: Some(String::from("national")),
            language: Some(String::from("fi")),
            tags: Some(String::from("climate,water")),
        };

        let mut sql = String::from("SELECT COUNT(*) FROM threads t WHERE 1 = 1");
        let mut values = Vec::new();
        append_thread_filters(&mut sql, &mut values, &params, "t", false);

        assert!(sql.contains("club_id IS NULL"));
        assert!(sql.contains("t.scope = $1"));
        assert!(sql.contains("t.language = $2"));
        assert!(sql.contains("t.created_at >= $3"));
        assert!(sql.contains("tt.thread_id = t.id"));
        assert!(sql.contains("tt.tag IN ($4,$5)"));
        assert_eq!(values.len(), 5);
    }

    #[test]
    fn municipality_thread_count_query_is_not_filter_aware() {
        let thread_count_sql = municipality_thread_count_subquery();
        assert!(thread_count_sql.contains("t.deleted_at IS NULL"));
        assert!(thread_count_sql.contains("t.is_hidden = false"));
        assert!(thread_count_sql.contains("t.municipality_id = m.id"));
        assert!(!thread_count_sql.contains(".scope"));
        assert!(!thread_count_sql.contains(".language"));
        assert!(!thread_count_sql.contains(".created_at"));
        assert!(!thread_count_sql.contains("thread_tags"));
    }
}
