use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use sea_orm::sea_query::extension::postgres::PgExpr;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, Statement,
};
use serde::{Deserialize, Serialize};
use tracing::warn;
use uuid::Uuid;

use crate::AppState;
use crate::map::{MunicipalityResponse, municipality_to_response};
use eulesia_common::error::ApiError;
use eulesia_common::types::{Bounds, Coordinates, LocationStatus, LocationType, new_id};
use eulesia_db::entities::{locations, municipalities};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LocationParentResponse {
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: LocationType,
    pub admin_level: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LocationResponse {
    pub id: Option<Uuid>,
    pub name: String,
    pub name_fi: Option<String>,
    pub name_sv: Option<String>,
    pub name_en: Option<String>,
    pub display_name: String,
    pub osm_id: Option<i64>,
    pub osm_type: Option<String>,
    pub admin_level: Option<i32>,
    #[serde(rename = "type")]
    pub r#type: LocationType,
    pub country: Option<String>,
    pub coordinates: Option<Coordinates>,
    pub bounds: Option<Bounds>,
    pub population: Option<i64>,
    pub status: LocationStatus,
    pub content_count: i32,
    pub parent: Option<LocationParentResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationWithHierarchyResponse {
    #[serde(flatten)]
    location: LocationResponse,
    hierarchy: Vec<LocationParentResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationSearchResponse {
    results: Vec<LocationResponse>,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    q: String,
    country: Option<String>,
    types: Option<String>,
    limit: Option<u64>,
    include_nominatim: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReverseParams {
    lat: f64,
    lon: f64,
}

// ---------------------------------------------------------------------------
// Nominatim types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct NominatimResult {
    osm_id: Option<i64>,
    osm_type: Option<String>,
    display_name: Option<String>,
    name: Option<String>,
    lat: Option<String>,
    lon: Option<String>,
    boundingbox: Option<Vec<String>>,
    #[serde(rename = "type")]
    place_type: Option<String>,
    address: Option<NominatimAddress>,
}

#[derive(Debug, Deserialize)]
struct NominatimAddress {
    country_code: Option<String>,
    city: Option<String>,
    town: Option<String>,
    municipality: Option<String>,
    county: Option<String>,
    state: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn decimal_to_f64(d: sea_orm::prelude::Decimal) -> Option<f64> {
    d.to_string().parse::<f64>().ok()
}

fn decimal_from_f64(value: Option<f64>) -> Option<sea_orm::prelude::Decimal> {
    value.and_then(sea_orm::prelude::Decimal::from_f64_retain)
}

fn parse_types_filter(value: Option<&str>) -> Vec<LocationType> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .filter_map(|item| {
            // LocationType::from_str never fails (unknown → Other), so validate
            // via round-trip: only accept strings that survive as_str() unchanged.
            let ty: LocationType = item.parse().unwrap();
            (ty.as_str() == item).then_some(ty)
        })
        .collect()
}

fn parse_bounds(bounds: Option<&serde_json::Value>) -> Option<Bounds> {
    let value = bounds?;
    serde_json::from_value(value.clone()).ok()
}

fn parse_nominatim_bounds(bounds: Option<&Vec<String>>) -> Option<Bounds> {
    let bounds = bounds?;
    if bounds.len() != 4 {
        return None;
    }

    Some(Bounds {
        south: bounds[0].parse().ok()?,
        north: bounds[1].parse().ok()?,
        west: bounds[2].parse().ok()?,
        east: bounds[3].parse().ok()?,
    })
}

#[allow(clippy::missing_const_for_fn)]
fn location_parent_response(
    name: String,
    location_type: LocationType,
    admin_level: Option<i32>,
) -> LocationParentResponse {
    LocationParentResponse {
        name,
        r#type: location_type,
        admin_level,
    }
}

fn location_parent_from_model(model: &locations::Model) -> LocationParentResponse {
    location_parent_response(
        model.name.clone(),
        model.r#type.unwrap_or(LocationType::Other),
        model.admin_level,
    )
}

fn bounds_to_json(bounds: Bounds) -> serde_json::Value {
    serde_json::to_value(bounds).unwrap_or(serde_json::json!({}))
}

fn normalize_osm_type(osm_type: &str) -> Option<&'static str> {
    match osm_type {
        "node" | "N" => Some("node"),
        "way" | "W" => Some("way"),
        "relation" | "R" => Some("relation"),
        _ => None,
    }
}

fn nominatim_parent(address: Option<&NominatimAddress>) -> Option<LocationParentResponse> {
    let address = address?;

    address
        .municipality
        .as_ref()
        .map(|name| location_parent_response(name.clone(), LocationType::Municipality, Some(8)))
        .or_else(|| {
            address
                .city
                .as_ref()
                .map(|name| location_parent_response(name.clone(), LocationType::Other, None))
        })
        .or_else(|| {
            address
                .town
                .as_ref()
                .map(|name| location_parent_response(name.clone(), LocationType::Other, None))
        })
        .or_else(|| {
            address
                .county
                .as_ref()
                .map(|name| location_parent_response(name.clone(), LocationType::Other, None))
        })
        .or_else(|| {
            address
                .state
                .as_ref()
                .map(|name| location_parent_response(name.clone(), LocationType::Region, None))
        })
}

fn nominatim_type(result: &NominatimResult) -> LocationType {
    result
        .place_type
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(LocationType::Other)
}

async fn parent_response(
    db: &sea_orm::DatabaseConnection,
    parent_id: Option<Uuid>,
) -> Result<Option<LocationParentResponse>, ApiError> {
    let Some(parent_id) = parent_id else {
        return Ok(None);
    };

    let parent = find_location_by_id(db, parent_id, "parent location").await?;
    Ok(parent.as_ref().map(location_parent_from_model))
}

pub(crate) async fn model_to_response(
    db: &sea_orm::DatabaseConnection,
    model: locations::Model,
) -> Result<LocationResponse, ApiError> {
    let parent = parent_response(db, model.parent_id).await?;

    Ok(LocationResponse {
        id: Some(model.id),
        name: model.name.clone(),
        name_fi: model.name_fi,
        name_sv: model.name_sv,
        name_en: model.name_en,
        display_name: model.name,
        osm_id: model.osm_id,
        osm_type: model.osm_type,
        admin_level: model.admin_level,
        r#type: model.r#type.unwrap_or(LocationType::Other),
        country: model.country,
        coordinates: Coordinates::from_options(
            model.latitude.and_then(decimal_to_f64),
            model.longitude.and_then(decimal_to_f64),
        ),
        bounds: parse_bounds(model.bounds.as_ref()),
        population: model.population,
        status: model.status,
        content_count: model.content_count,
        parent,
    })
}

fn nominatim_to_response(n: NominatimResult) -> LocationResponse {
    let name = n
        .name
        .clone()
        .or_else(|| n.display_name.clone())
        .unwrap_or_default();
    let location_type = nominatim_type(&n);
    LocationResponse {
        id: None,
        name,
        name_fi: None,
        name_sv: None,
        name_en: None,
        display_name: n.display_name.unwrap_or_default(),
        osm_id: n.osm_id,
        osm_type: n.osm_type,
        admin_level: None,
        r#type: location_type,
        country: n
            .address
            .as_ref()
            .and_then(|address| address.country_code.clone()),
        coordinates: Coordinates::from_options(
            n.lat.and_then(|value| value.parse().ok()),
            n.lon.and_then(|value| value.parse().ok()),
        ),
        bounds: parse_nominatim_bounds(n.boundingbox.as_ref()),
        population: None,
        status: LocationStatus::Active,
        content_count: 0,
        parent: nominatim_parent(n.address.as_ref()),
    }
}

fn location_matches_type_filter(
    location_type: LocationType,
    type_filters: &[LocationType],
) -> bool {
    type_filters.is_empty() || type_filters.contains(&location_type)
}

async fn fetch_nominatim(query: &str, country: &str, limit: u64) -> Vec<LocationResponse> {
    let url = format!(
        "https://nominatim.openstreetmap.org/search?format=jsonv2&q={}&countrycodes={}&limit={}&addressdetails=1",
        urlencoding::encode(query),
        urlencoding::encode(country),
        limit,
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            warn!(error = %error, "failed to build nominatim client");
            return vec![];
        }
    };

    let response = match client
        .get(&url)
        .header("User-Agent", "Eulesia/1.0")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            warn!(error = %error, "nominatim search request failed");
            return vec![];
        }
    };

    match response.json::<Vec<NominatimResult>>().await {
        Ok(results) => results.into_iter().map(nominatim_to_response).collect(),
        Err(error) => {
            warn!(error = %error, "failed to parse nominatim search response");
            vec![]
        }
    }
}

async fn fetch_nominatim_lookup(osm_type: &str, osm_id: i64) -> Result<NominatimResult, ApiError> {
    let Some(osm_type) = normalize_osm_type(osm_type) else {
        return Err(ApiError::BadRequest(String::from("invalid osm_type")));
    };

    let prefix = match osm_type {
        "node" => "N",
        "way" => "W",
        "relation" => "R",
        _ => unreachable!("normalize_osm_type filters invalid types"),
    };

    let url = format!(
        "https://nominatim.openstreetmap.org/lookup?format=jsonv2&osm_ids={prefix}{osm_id}&addressdetails=1"
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| ApiError::Internal(format!("http client: {e}")))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Eulesia/1.0")
        .send()
        .await
        .map_err(|e| ApiError::Internal(format!("nominatim lookup request: {e}")))?;

    let results = response
        .json::<Vec<NominatimResult>>()
        .await
        .map_err(|e| ApiError::Internal(format!("nominatim lookup parse: {e}")))?;

    let result = results
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound(String::from("location not found in OSM")));
    result
}

async fn find_location_by_osm_identity(
    db: &sea_orm::DatabaseConnection,
    osm_type: &str,
    osm_id: i64,
) -> Result<Option<locations::Model>, ApiError> {
    locations::Entity::find()
        .filter(locations::Column::OsmId.eq(osm_id))
        .filter(locations::Column::OsmType.eq(osm_type))
        .one(db)
        .await
        .map_err(|e| ApiError::Database(format!("find location by osm identity: {e}")))
}

async fn persist_nominatim_location(
    db: &sea_orm::DatabaseConnection,
    result: &NominatimResult,
) -> Result<locations::Model, ApiError> {
    let osm_id = result
        .osm_id
        .ok_or_else(|| ApiError::BadRequest(String::from("osm_id is required")))?;
    let osm_type = result
        .osm_type
        .as_deref()
        .and_then(normalize_osm_type)
        .ok_or_else(|| ApiError::BadRequest(String::from("invalid osm_type")))?;

    let name = result
        .name
        .clone()
        .or_else(|| result.display_name.clone())
        .ok_or_else(|| ApiError::BadRequest(String::from("nominatim result is missing a name")))?;

    let model = locations::ActiveModel {
        id: Set(new_id()),
        osm_id: Set(Some(osm_id)),
        osm_type: Set(Some(String::from(osm_type))),
        name: Set(name.clone()),
        name_local: Set(Some(name.clone())),
        name_fi: Set(None),
        name_sv: Set(None),
        name_en: Set(None),
        admin_level: Set(None),
        r#type: Set(Some(nominatim_type(result))),
        parent_id: Set(None),
        country: Set(result
            .address
            .as_ref()
            .and_then(|address| address.country_code.clone())),
        latitude: Set(decimal_from_f64(
            result.lat.as_ref().and_then(|value| value.parse().ok()),
        )),
        longitude: Set(decimal_from_f64(
            result.lon.as_ref().and_then(|value| value.parse().ok()),
        )),
        bounds: Set(parse_nominatim_bounds(result.boundingbox.as_ref()).map(bounds_to_json)),
        population: Set(None),
        status: Set(LocationStatus::Active),
        content_count: Set(0),
        ..Default::default()
    };

    locations::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([locations::Column::OsmType, locations::Column::OsmId])
                .target_and_where(
                    Expr::col(locations::Column::OsmType)
                        .is_not_null()
                        .and(Expr::col(locations::Column::OsmId).is_not_null()),
                )
                .do_nothing()
                .to_owned(),
        )
        .exec(db)
        .await
        .map_err(|e| ApiError::Database(format!("insert location from nominatim: {e}")))?;

    // Re-read by OSM identity so concurrent inserts converge on the same row.
    // The unique index makes the insert idempotent, but the caller still
    // needs the full model back.
    find_location_by_osm_identity(db, osm_type, osm_id)
        .await?
        .ok_or_else(|| {
            ApiError::Internal(String::from(
                "inserted nominatim location could not be loaded",
            ))
        })
}

pub(crate) async fn ensure_location_by_osm(
    db: &sea_orm::DatabaseConnection,
    osm_type: &str,
    osm_id: i64,
) -> Result<locations::Model, ApiError> {
    let normalized_osm_type = normalize_osm_type(osm_type)
        .ok_or_else(|| ApiError::BadRequest(String::from("invalid osm_type")))?;

    if let Some(existing) = find_location_by_osm_identity(db, normalized_osm_type, osm_id).await? {
        return Ok(existing);
    }

    let nominatim = fetch_nominatim_lookup(normalized_osm_type, osm_id).await?;
    persist_nominatim_location(db, &nominatim).await
}

pub(crate) async fn increment_location_content_count(
    db: &sea_orm::DatabaseConnection,
    location_id: Uuid,
    delta: i32,
) -> Result<(), ApiError> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r"
        UPDATE locations
        SET content_count = GREATEST(content_count + $2, 0)
        WHERE id = $1
        ",
        [location_id.into(), delta.into()],
    ))
    .await
    .map_err(|e| ApiError::Database(format!("update location content count: {e}")))?;

    Ok(())
}

pub(crate) async fn nearest_municipality(
    db: &sea_orm::DatabaseConnection,
    coords: Coordinates,
) -> Result<Option<municipalities::Model>, ApiError> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"
            SELECT id
            FROM municipalities
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY
              POWER(latitude::float8 - $1, 2)
              + POWER(longitude::float8 - $2, 2)
            LIMIT 1
            ",
            [coords.latitude.into(), coords.longitude.into()],
        ))
        .await
        .map_err(|e| ApiError::Database(format!("reverse municipality lookup: {e}")))?;

    let Some(row) = row else {
        return Ok(None);
    };

    let municipality_id: Uuid = row
        .try_get("", "id")
        .map_err(|e| ApiError::Database(format!("parse reverse municipality id: {e}")))?;

    municipalities::Entity::find_by_id(municipality_id)
        .one(db)
        .await
        .map_err(|e| ApiError::Database(format!("load reverse municipality: {e}")))
}

async fn find_location_by_id(
    db: &sea_orm::DatabaseConnection,
    location_id: Uuid,
    label: &str,
) -> Result<Option<locations::Model>, ApiError> {
    locations::Entity::find_by_id(location_id)
        .one(db)
        .await
        .map_err(|e| ApiError::Database(format!("find {label}: {e}")))
}

async fn hierarchy_response(
    db: &sea_orm::DatabaseConnection,
    model: locations::Model,
) -> Result<LocationWithHierarchyResponse, ApiError> {
    let mut hierarchy = Vec::new();
    let mut cursor = model.parent_id;

    while let Some(parent_id) = cursor {
        let Some(parent) = find_location_by_id(db, parent_id, "location hierarchy").await? else {
            break;
        };

        hierarchy.push(location_parent_from_model(&parent));
        cursor = parent.parent_id;
    }

    Ok(LocationWithHierarchyResponse {
        location: model_to_response(db, model).await?,
        hierarchy,
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /locations/search?q=...&country=FI&types=municipality&includeNominatim=true
async fn search_locations(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<LocationSearchResponse>, ApiError> {
    let query = params.q.trim();
    if query.is_empty() {
        return Err(ApiError::BadRequest(String::from(
            "query parameter 'q' is required",
        )));
    }

    let country = params.country.unwrap_or_else(|| String::from("FI"));
    let limit = params.limit.unwrap_or(10).min(50);
    let include_nominatim = params.include_nominatim.unwrap_or(true);
    let type_filters = parse_types_filter(params.types.as_deref());
    let ilike_pattern = format!("%{query}%");

    let mut local_query = locations::Entity::find()
        .filter(
            Condition::any()
                .add(Expr::col(locations::Column::Name).ilike(&ilike_pattern))
                .add(Expr::col(locations::Column::NameFi).ilike(&ilike_pattern))
                .add(Expr::col(locations::Column::NameSv).ilike(&ilike_pattern))
                .add(Expr::col(locations::Column::NameEn).ilike(&ilike_pattern)),
        )
        .filter(locations::Column::Country.eq(&country))
        .order_by_desc(locations::Column::ContentCount)
        .order_by_desc(locations::Column::Population)
        .limit(limit);

    if !type_filters.is_empty() {
        local_query = local_query
            .filter(locations::Column::Type.is_in(type_filters.iter().map(LocationType::as_str)));
    }

    let local_models = local_query
        .all(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("search locations: {e}")))?;

    let mut local_results = Vec::with_capacity(local_models.len());
    for model in local_models {
        local_results.push(model_to_response(&state.db, model).await?);
    }

    if !include_nominatim || local_results.len() >= limit as usize {
        return Ok(Json(LocationSearchResponse {
            results: local_results,
            source: String::from("cache"),
        }));
    }

    let local_osm_ids: std::collections::HashSet<(Option<String>, Option<i64>)> = local_results
        .iter()
        .map(|location| (location.osm_type.clone(), location.osm_id))
        .collect();

    let mut combined = local_results.clone();
    let nominatim_results = fetch_nominatim(query, &country, limit).await;
    for result in nominatim_results {
        if !location_matches_type_filter(result.r#type, &type_filters) {
            continue;
        }

        let identity = (result.osm_type.clone(), result.osm_id);
        if local_osm_ids.contains(&identity) {
            continue;
        }

        if combined.len() >= limit as usize {
            break;
        }
        combined.push(result);
    }

    let source = match (
        local_results.is_empty(),
        combined.len() > local_results.len(),
    ) {
        (false, true) => "mixed",
        (true, true) => "nominatim",
        _ => "cache",
    };

    Ok(Json(LocationSearchResponse {
        results: combined,
        source: String::from(source),
    }))
}

/// GET /locations/{id}
async fn get_location(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<LocationWithHierarchyResponse>, ApiError> {
    let location = find_location_by_id(&state.db, id, "location")
        .await?
        .ok_or_else(|| ApiError::NotFound(String::from("location not found")))?;

    Ok(Json(hierarchy_response(&state.db, location).await?))
}

/// GET /locations/osm/{osmType}/{osmId}
async fn osm_lookup(
    State(state): State<AppState>,
    Path((osm_type, osm_id)): Path<(String, i64)>,
) -> Result<Json<LocationWithHierarchyResponse>, ApiError> {
    let location = ensure_location_by_osm(&state.db, &osm_type, osm_id).await?;
    Ok(Json(hierarchy_response(&state.db, location).await?))
}

/// GET /locations/reverse?lat=...&lon=...
async fn reverse_lookup(
    State(state): State<AppState>,
    Query(params): Query<ReverseParams>,
) -> Result<Json<MunicipalityResponse>, ApiError> {
    let municipality = nearest_municipality(
        &state.db,
        Coordinates {
            latitude: params.lat,
            longitude: params.lon,
        },
    )
    .await?
    .ok_or_else(|| ApiError::NotFound(String::from("municipality not found")))?;

    Ok(Json(municipality_to_response(municipality)))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/locations/search", get(search_locations))
        .route("/locations/reverse", get(reverse_lookup))
        .route("/locations/osm/{osm_type}/{osm_id}", get(osm_lookup))
        .route("/locations/{id}", get(get_location))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_search_response_shape() {
        let resp = LocationSearchResponse {
            results: vec![LocationResponse {
                id: Some(Uuid::nil()),
                name: String::from("Helsinki"),
                name_fi: Some(String::from("Helsinki")),
                name_sv: Some(String::from("Helsingfors")),
                name_en: None,
                display_name: String::from("Helsinki"),
                osm_id: Some(34914),
                osm_type: Some(String::from("relation")),
                admin_level: Some(8),
                r#type: LocationType::Municipality,
                country: Some(String::from("FI")),
                coordinates: Some(Coordinates {
                    latitude: 60.1699,
                    longitude: 24.9384,
                }),
                bounds: None,
                population: Some(674_500),
                status: LocationStatus::Active,
                content_count: 3,
                parent: None,
            }],
            source: String::from("cache"),
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json
            .as_object()
            .expect("location search response must be an object");
        assert!(obj.contains_key("results"));
        assert!(obj.contains_key("source"));
    }

    #[test]
    fn normalize_osm_type_accepts_short_codes() {
        assert_eq!(normalize_osm_type("R"), Some("relation"));
        assert_eq!(normalize_osm_type("node"), Some("node"));
        assert_eq!(normalize_osm_type("bad"), None);
    }
}
