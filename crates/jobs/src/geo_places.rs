use std::collections::HashMap;

use chrono::Utc;
use reqwest::Client;
use sea_orm::prelude::Decimal;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, QueryFilter, Set, Statement,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tracing::info;
use uuid::Uuid;

use eulesia_common::types::{Coordinates, SyncStatus};
use eulesia_db::entities::{municipalities, places};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    Inserted,
    Updated,
}

#[derive(Debug, Clone)]
pub struct LipasImportConfig {
    pub enabled: bool,
    pub base_url: String,
    pub page_size: u32,
}

#[derive(Debug, Clone)]
pub struct OsmImportConfig {
    pub enabled: bool,
    pub interpreter_url: String,
    pub timeout_seconds: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LipasImportReport {
    pub sports_sites_seen: usize,
    pub lois_seen: usize,
    pub inserted: usize,
    pub updated: usize,
    pub skipped_without_geometry: usize,
    pub nearest_municipality_backfills: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct OsmImportReport {
    pub seen: usize,
    pub inserted: usize,
    pub updated: usize,
    pub skipped_without_geometry: usize,
    pub skipped_without_name: usize,
    pub libraries: usize,
    pub parks: usize,
    pub playgrounds: usize,
    pub beaches: usize,
}

#[derive(Debug, Error)]
pub enum PlaceImportError {
    #[error("http error ({context}): {source}")]
    Http {
        context: &'static str,
        source: reqwest::Error,
    },
    #[error("database error ({context}): {source}")]
    Database {
        context: &'static str,
        source: sea_orm::DbErr,
    },
    #[error("row parse error: {0}")]
    Row(String),
}

#[derive(Debug, Deserialize)]
struct LipasPage<T> {
    items: Vec<T>,
    pagination: LipasPagination,
}

#[derive(Debug, Deserialize)]
struct LipasPagination {
    #[serde(rename = "total-pages")]
    total_pages: u32,
}

#[derive(Debug, Deserialize)]
struct LipasSportsSite {
    name: String,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    www: Option<String>,
    status: String,
    #[serde(rename = "lipas-id")]
    lipas_id: i64,
    #[serde(rename = "type")]
    kind: LipasType,
    location: LipasLocation,
    #[serde(default)]
    admin: Option<String>,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    properties: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct LipasType {
    #[serde(rename = "type-code")]
    type_code: i64,
}

#[derive(Debug, Deserialize)]
struct LipasLocation {
    city: LipasCity,
    #[serde(default)]
    address: Option<String>,
    geometries: LipasFeatureCollection,
    #[serde(default, rename = "postal-code")]
    postal_code: Option<String>,
    #[serde(default, rename = "postal-office")]
    postal_office: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LipasCity {
    #[serde(rename = "city-code")]
    city_code: i32,
}

#[derive(Debug, Deserialize)]
struct LipasLoi {
    name: LocalizedName,
    status: String,
    id: Uuid,
    geometries: LipasFeatureCollection,
    #[serde(rename = "loi-type")]
    loi_type: String,
    #[serde(rename = "loi-category")]
    loi_category: String,
}

#[derive(Debug, Deserialize, Default)]
struct LocalizedName {
    #[serde(default)]
    fi: Option<String>,
    #[serde(default)]
    se: Option<String>,
    #[serde(default)]
    en: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LipasFeatureCollection {
    features: Vec<LipasFeature>,
}

#[derive(Debug, Deserialize)]
struct LipasFeature {
    geometry: LipasGeometry,
}

#[derive(Debug, Deserialize)]
struct LipasGeometry {
    #[serde(rename = "type")]
    kind: String,
    coordinates: Value,
}

#[derive(Debug, Deserialize)]
struct OverpassResponse {
    elements: Vec<OverpassElement>,
}

#[derive(Debug, Deserialize)]
struct OverpassElement {
    #[serde(rename = "type")]
    element_type: String,
    id: i64,
    #[serde(default)]
    lat: Option<f64>,
    #[serde(default)]
    lon: Option<f64>,
    #[serde(default)]
    center: Option<OverpassCenter>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct OverpassCenter {
    lat: f64,
    lon: f64,
}

struct PlaceCandidate {
    source: String,
    source_id: String,
    name: String,
    name_fi: Option<String>,
    name_sv: Option<String>,
    name_en: Option<String>,
    description: Option<String>,
    coordinates: Coordinates,
    place_type: String,
    category: Option<String>,
    subcategory: Option<String>,
    municipality_id: Option<Uuid>,
    country: String,
    address: Option<String>,
    source_url: Option<String>,
    osm_id: Option<String>,
    metadata: Value,
}

pub async fn sync_lipas_places(
    db: &DatabaseConnection,
    config: &LipasImportConfig,
) -> Result<LipasImportReport, PlaceImportError> {
    let client = Client::builder()
        .user_agent("eulesia-jobs/0.1.0")
        .build()
        .map_err(|e| PlaceImportError::Http {
            context: "build client",
            source: e,
        })?;
    let municipalities_by_code = municipality_lookup(db).await?;
    let existing_places = existing_source_places(db, "lipas").await?;

    let mut report = LipasImportReport {
        sports_sites_seen: 0,
        lois_seen: 0,
        inserted: 0,
        updated: 0,
        skipped_without_geometry: 0,
        nearest_municipality_backfills: 0,
    };

    let sports_sites =
        fetch_paged::<LipasSportsSite>(&client, &config.base_url, "sports-sites", config.page_size)
            .await?;
    for site in sports_sites {
        report.sports_sites_seen += 1;

        let Some(candidate) =
            sports_site_candidate(&site, &config.base_url, &municipalities_by_code)
        else {
            report.skipped_without_geometry += 1;
            continue;
        };

        match upsert_place(db, existing_places.get(&candidate.source_id), candidate).await? {
            UpsertOutcome::Updated => report.updated += 1,
            UpsertOutcome::Inserted => report.inserted += 1,
        }
    }

    let lois = fetch_paged::<LipasLoi>(&client, &config.base_url, "lois", config.page_size).await?;
    for loi in lois {
        report.lois_seen += 1;

        let Some(mut candidate) = loi_candidate(&loi, &config.base_url) else {
            report.skipped_without_geometry += 1;
            continue;
        };

        if candidate.municipality_id.is_none() {
            candidate.municipality_id = nearest_municipality_id(db, candidate.coordinates).await?;
            if candidate.municipality_id.is_some() {
                report.nearest_municipality_backfills += 1;
            }
        }

        match upsert_place(db, existing_places.get(&candidate.source_id), candidate).await? {
            UpsertOutcome::Updated => report.updated += 1,
            UpsertOutcome::Inserted => report.inserted += 1,
        }
    }

    info!(?report, "lipas place sync completed");
    Ok(report)
}

pub async fn sync_osm_places(
    db: &DatabaseConnection,
    config: &OsmImportConfig,
) -> Result<OsmImportReport, PlaceImportError> {
    let client = Client::builder()
        .user_agent("eulesia-jobs/0.1.0")
        .build()
        .map_err(|e| PlaceImportError::Http {
            context: "build client",
            source: e,
        })?;
    let existing_places = existing_source_places(db, "osm").await?;
    let elements = fetch_overpass_elements(&client, config).await?;

    let mut report = OsmImportReport {
        seen: 0,
        inserted: 0,
        updated: 0,
        skipped_without_geometry: 0,
        skipped_without_name: 0,
        libraries: 0,
        parks: 0,
        playgrounds: 0,
        beaches: 0,
    };

    for element in elements {
        report.seen += 1;

        let Some(coordinates) = overpass_coordinates(&element) else {
            report.skipped_without_geometry += 1;
            continue;
        };

        let Some((category, subcategory)) = osm_category(&element.tags) else {
            continue;
        };

        match category.as_str() {
            "osm:library" => report.libraries += 1,
            "osm:park" => report.parks += 1,
            "osm:playground" => report.playgrounds += 1,
            "osm:beach" => report.beaches += 1,
            _ => {}
        }

        let Some(name) = osm_name(&element.tags) else {
            report.skipped_without_name += 1;
            continue;
        };

        let candidate = PlaceCandidate {
            source: String::from("osm"),
            source_id: format!("{}/{}", element.element_type, element.id),
            name,
            name_fi: element
                .tags
                .get("name:fi")
                .cloned()
                .or_else(|| element.tags.get("name").cloned()),
            name_sv: element.tags.get("name:sv").cloned(),
            name_en: element.tags.get("name:en").cloned(),
            description: element.tags.get("description").cloned(),
            coordinates,
            place_type: osm_place_type(&element),
            category: Some(category),
            subcategory: Some(subcategory),
            municipality_id: nearest_municipality_id(db, coordinates).await?,
            country: String::from("FI"),
            address: osm_address(&element.tags),
            source_url: Some(format!(
                "https://www.openstreetmap.org/{}/{}",
                element.element_type, element.id
            )),
            osm_id: Some(element.id.to_string()),
            metadata: json!({ "tags": element.tags }),
        };

        match upsert_place(db, existing_places.get(&candidate.source_id), candidate).await? {
            UpsertOutcome::Updated => report.updated += 1,
            UpsertOutcome::Inserted => report.inserted += 1,
        }
    }

    info!(?report, "osm place sync completed");
    Ok(report)
}

async fn fetch_paged<T>(
    client: &Client,
    base_url: &str,
    resource: &str,
    page_size: u32,
) -> Result<Vec<T>, PlaceImportError>
where
    T: for<'de> Deserialize<'de>,
{
    let mut page = 1;
    let mut items = Vec::new();

    loop {
        let page_response = client
            .get(format!("{base_url}/{resource}"))
            .query(&[("page", page), ("page-size", page_size)])
            .send()
            .await
            .map_err(|e| PlaceImportError::Http {
                context: "send paged request",
                source: e,
            })?
            .error_for_status()
            .map_err(|e| PlaceImportError::Http {
                context: "paged request status",
                source: e,
            })?
            .json::<LipasPage<T>>()
            .await
            .map_err(|e| PlaceImportError::Http {
                context: "parse paged response",
                source: e,
            })?;

        let total_pages = page_response.pagination.total_pages;
        items.extend(page_response.items);
        if page >= total_pages {
            break;
        }
        page += 1;
    }

    Ok(items)
}

async fn fetch_overpass_elements(
    client: &Client,
    config: &OsmImportConfig,
) -> Result<Vec<OverpassElement>, PlaceImportError> {
    let response = client
        .post(&config.interpreter_url)
        .timeout(std::time::Duration::from_secs(u64::from(
            config.timeout_seconds,
        )))
        .body(build_osm_query(config.timeout_seconds))
        .send()
        .await
        .map_err(|e| PlaceImportError::Http {
            context: "send overpass request",
            source: e,
        })?
        .error_for_status()
        .map_err(|e| PlaceImportError::Http {
            context: "overpass request status",
            source: e,
        })?
        .json::<OverpassResponse>()
        .await
        .map_err(|e| PlaceImportError::Http {
            context: "parse overpass response",
            source: e,
        })?;

    Ok(response.elements)
}

async fn municipality_lookup(
    db: &DatabaseConnection,
) -> Result<HashMap<String, Uuid>, PlaceImportError> {
    Ok(municipalities::Entity::find()
        .all(db)
        .await
        .map_err(|e| PlaceImportError::Database {
            context: "lookup municipalities",
            source: e,
        })?
        .into_iter()
        .filter_map(|municipality| {
            municipality
                .official_code
                .map(|code| (code, municipality.id))
        })
        .collect())
}

async fn existing_source_places(
    db: &DatabaseConnection,
    source: &str,
) -> Result<HashMap<String, places::Model>, PlaceImportError> {
    Ok(places::Entity::find()
        .filter(places::Column::Source.eq(source))
        .all(db)
        .await
        .map_err(|e| PlaceImportError::Database {
            context: "lookup existing source places",
            source: e,
        })?
        .into_iter()
        .filter_map(|place| place.source_id.clone().map(|source_id| (source_id, place)))
        .collect())
}
fn sports_site_candidate(
    site: &LipasSportsSite,
    base_url: &str,
    municipalities_by_code: &HashMap<String, Uuid>,
) -> Option<PlaceCandidate> {
    let (place_type, coordinates) = geometry_center(&site.location.geometries)?;
    let municipality_code = format!("{:03}", site.location.city.city_code);

    Some(PlaceCandidate {
        source: String::from("lipas"),
        source_id: site.lipas_id.to_string(),
        name: site.name.clone(),
        name_fi: Some(site.name.clone()),
        name_sv: None,
        name_en: None,
        description: site.comment.clone(),
        coordinates,
        place_type,
        category: Some(String::from("lipas:sports-site")),
        subcategory: Some(format!("lipas:type:{}", site.kind.type_code)),
        municipality_id: municipalities_by_code.get(&municipality_code).copied(),
        country: String::from("FI"),
        address: site.location.address.clone(),
        source_url: Some(format!("{base_url}/sports-sites/{}", site.lipas_id)),
        osm_id: None,
        metadata: json!({
            "typeCode": site.kind.type_code,
            "status": site.status,
            "website": site.www,
            "admin": site.admin,
            "owner": site.owner,
            "postalCode": site.location.postal_code,
            "postalOffice": site.location.postal_office,
            "properties": site.properties,
        }),
    })
}
fn loi_candidate(loi: &LipasLoi, base_url: &str) -> Option<PlaceCandidate> {
    let (place_type, coordinates) = geometry_center(&loi.geometries)?;
    let name = loi
        .name
        .fi
        .clone()
        .or_else(|| loi.name.se.clone())
        .or_else(|| loi.name.en.clone())
        .unwrap_or_else(|| loi.loi_type.clone());

    Some(PlaceCandidate {
        source: String::from("lipas"),
        source_id: loi.id.to_string(),
        name,
        name_fi: loi.name.fi.clone(),
        name_sv: loi.name.se.clone(),
        name_en: loi.name.en.clone(),
        description: None,
        coordinates,
        place_type,
        category: Some(format!("lipas:{}", loi.loi_category)),
        subcategory: Some(format!("lipas:{}", loi.loi_type)),
        municipality_id: None,
        country: String::from("FI"),
        address: None,
        source_url: Some(format!("{base_url}/lois/{}", loi.id)),
        osm_id: None,
        metadata: json!({
            "status": loi.status,
            "loiType": loi.loi_type,
            "loiCategory": loi.loi_category,
        }),
    })
}

/// Returns the outcome of the upsert operation.
async fn upsert_place(
    db: &DatabaseConnection,
    existing: Option<&places::Model>,
    candidate: PlaceCandidate,
) -> Result<UpsertOutcome, PlaceImportError> {
    let now = Utc::now().fixed_offset();

    let mut active = match existing {
        Some(existing) => existing.clone().into(),
        None => places::ActiveModel {
            id: Set(Uuid::now_v7()),
            source: Set(candidate.source),
            source_id: Set(Some(candidate.source_id)),
            radius_km: Set(None),
            geojson: Set(None),
            location_id: Set(None),
            created_by: Set(None),
            created_at: Set(now),
            ..Default::default()
        },
    };

    active.name = Set(candidate.name);
    active.name_fi = Set(candidate.name_fi);
    active.name_sv = Set(candidate.name_sv);
    active.name_en = Set(candidate.name_en);
    active.description = Set(candidate.description);
    active.latitude = Set(decimal_from_f64(candidate.coordinates.latitude));
    active.longitude = Set(decimal_from_f64(candidate.coordinates.longitude));
    active.r#type = Set(candidate.place_type);
    active.category = Set(candidate.category);
    active.subcategory = Set(candidate.subcategory);
    active.municipality_id = Set(candidate.municipality_id);
    active.country = Set(Some(candidate.country));
    active.address = Set(candidate.address);
    active.source_url = Set(candidate.source_url);
    active.osm_id = Set(candidate.osm_id);
    active.last_synced = Set(Some(now));
    active.sync_status = Set(SyncStatus::Synced);
    active.metadata = Set(Some(candidate.metadata));
    active.updated_at = Set(now);

    if existing.is_some() {
        active
            .update(db)
            .await
            .map_err(|e| PlaceImportError::Database {
                context: "update place",
                source: e,
            })?;
        Ok(UpsertOutcome::Updated)
    } else {
        active
            .insert(db)
            .await
            .map_err(|e| PlaceImportError::Database {
                context: "insert place",
                source: e,
            })?;
        Ok(UpsertOutcome::Inserted)
    }
}

async fn nearest_municipality_id(
    db: &DatabaseConnection,
    coords: Coordinates,
) -> Result<Option<Uuid>, PlaceImportError> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"
            SELECT id
            FROM municipalities
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY POWER(latitude::float8 - $1, 2) + POWER(longitude::float8 - $2, 2)
            LIMIT 1
            ",
            [coords.latitude.into(), coords.longitude.into()],
        ))
        .await
        .map_err(|e| PlaceImportError::Database {
            context: "nearest municipality query",
            source: e,
        })?;

    row.map(|row| row.try_get("", "id"))
        .transpose()
        .map_err(|error| PlaceImportError::Row(error.to_string()))
}

fn geometry_center(geometries: &LipasFeatureCollection) -> Option<(String, Coordinates)> {
    for feature in &geometries.features {
        let mut points = Vec::new();
        collect_points(&feature.geometry.coordinates, &mut points);
        if points.is_empty() {
            continue;
        }

        let count = f64::from(u32::try_from(points.len()).ok()?);
        let (sum_lon, sum_lat) = points
            .iter()
            .fold((0.0, 0.0), |(lon, lat), [point_lon, point_lat]| {
                (lon + point_lon, lat + point_lat)
            });

        return Some((
            place_type_for_geometry(&feature.geometry.kind).to_owned(),
            Coordinates {
                latitude: sum_lat / count,
                longitude: sum_lon / count,
            },
        ));
    }

    None
}

fn place_type_for_geometry(kind: &str) -> &'static str {
    match kind {
        "LineString" | "MultiLineString" => "route",
        "Polygon" | "MultiPolygon" => "area",
        "Point" | "MultiPoint" => "poi",
        _ => "landmark",
    }
}

fn collect_points(value: &Value, points: &mut Vec<[f64; 2]>) {
    if let Some(pair) = value.as_array() {
        if pair.len() == 2 {
            if let (Some(lon), Some(lat)) = (pair[0].as_f64(), pair[1].as_f64()) {
                points.push([lon, lat]);
                return;
            }
        }

        for child in pair {
            collect_points(child, points);
        }
    }
}

fn decimal_from_f64(value: f64) -> Option<Decimal> {
    Decimal::from_f64_retain(value)
}

fn build_osm_query(timeout_seconds: u32) -> String {
    format!(
        r#"[out:json][timeout:{timeout_seconds}];
area["ISO3166-1"="FI"][admin_level=2]->.searchArea;
(
  nwr["amenity"="library"](area.searchArea);
  nwr["leisure"="park"](area.searchArea);
  nwr["leisure"="playground"](area.searchArea);
  nwr["natural"="beach"](area.searchArea);
  nwr["tourism"="beach"](area.searchArea);
  nwr["leisure"="beach_resort"](area.searchArea);
);
out center tags;"#
    )
}

fn overpass_coordinates(element: &OverpassElement) -> Option<Coordinates> {
    if let (Some(lat), Some(lon)) = (element.lat, element.lon) {
        return Some(Coordinates {
            latitude: lat,
            longitude: lon,
        });
    }

    element.center.as_ref().map(|center| Coordinates {
        latitude: center.lat,
        longitude: center.lon,
    })
}

fn osm_name(tags: &HashMap<String, String>) -> Option<String> {
    tags.get("name:fi")
        .cloned()
        .or_else(|| tags.get("name").cloned())
        .or_else(|| tags.get("name:sv").cloned())
        .or_else(|| tags.get("name:en").cloned())
}

fn osm_address(tags: &HashMap<String, String>) -> Option<String> {
    let street = tags.get("addr:street");
    let number = tags.get("addr:housenumber");
    let city = tags.get("addr:city");

    let mut parts = Vec::new();
    match (street, number) {
        (Some(street), Some(number)) => parts.push(format!("{street} {number}")),
        (Some(street), None) => parts.push(street.clone()),
        (None, Some(number)) => parts.push(number.clone()),
        (None, None) => {}
    }
    if let Some(city) = city {
        parts.push(city.clone());
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

fn osm_place_type(element: &OverpassElement) -> String {
    let tags = &element.tags;
    if tags.contains_key("leisure") && element.element_type != "node" {
        return String::from("area");
    }
    if tags.contains_key("natural") && element.element_type != "node" {
        return String::from("area");
    }
    if tags.contains_key("tourism") && element.element_type != "node" {
        return String::from("area");
    }

    String::from("poi")
}

fn osm_category(tags: &HashMap<String, String>) -> Option<(String, String)> {
    match (
        tags.get("amenity").map(String::as_str),
        tags.get("leisure").map(String::as_str),
        tags.get("natural").map(String::as_str),
        tags.get("tourism").map(String::as_str),
    ) {
        (Some("library"), _, _, _) => {
            Some((String::from("osm:library"), String::from("amenity:library")))
        }
        (_, Some("park"), _, _) => Some((String::from("osm:park"), String::from("leisure:park"))),
        (_, Some("playground"), _, _) => Some((
            String::from("osm:playground"),
            String::from("leisure:playground"),
        )),
        (_, _, Some("beach"), _) => {
            Some((String::from("osm:beach"), String::from("natural:beach")))
        }
        (_, _, _, Some("beach")) => {
            Some((String::from("osm:beach"), String::from("tourism:beach")))
        }
        (_, Some("beach_resort"), _, _) => Some((
            String::from("osm:beach"),
            String::from("leisure:beach_resort"),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        LipasFeatureCollection, build_osm_query, collect_points, geometry_center, osm_address,
        osm_category, osm_name, place_type_for_geometry,
    };

    #[test]
    fn place_type_maps_known_geometry_families() {
        assert_eq!(place_type_for_geometry("Point"), "poi");
        assert_eq!(place_type_for_geometry("LineString"), "route");
        assert_eq!(place_type_for_geometry("Polygon"), "area");
        assert_eq!(place_type_for_geometry("Unknown"), "landmark");
    }

    #[test]
    fn collect_points_flattens_nested_coordinate_arrays() {
        let value = serde_json::json!([[[24.0, 61.0], [25.0, 62.0]]]);
        let mut points = Vec::new();
        collect_points(&value, &mut points);
        assert_eq!(points, vec![[24.0, 61.0], [25.0, 62.0]]);
    }

    #[test]
    fn geometry_center_averages_polygon_points() {
        let geometries: LipasFeatureCollection = serde_json::from_value(serde_json::json!({
            "features": [{
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[24.0, 61.0], [26.0, 61.0], [26.0, 63.0], [24.0, 63.0]]]
                }
            }]
        }))
        .expect("geometry fixture should deserialize");

        let (place_type, coords) =
            geometry_center(&geometries).expect("geometry center should exist");

        assert_eq!(place_type, "area");
        assert!((coords.latitude - 62.0).abs() < f64::EPSILON);
        assert!((coords.longitude - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn osm_query_targets_curated_categories() {
        let query = build_osm_query(180);
        assert!(query.contains(r#""amenity"="library""#));
        assert!(query.contains(r#""leisure"="park""#));
        assert!(query.contains(r#""leisure"="playground""#));
        assert!(query.contains(r#""natural"="beach""#));
    }

    #[test]
    fn osm_category_recognizes_curated_tags() {
        let tags = HashMap::from([(String::from("amenity"), String::from("library"))]);
        assert_eq!(
            osm_category(&tags),
            Some((String::from("osm:library"), String::from("amenity:library")))
        );
    }

    #[test]
    fn osm_name_prefers_finnish_then_generic() {
        let tags = HashMap::from([
            (String::from("name"), String::from("Central Library")),
            (String::from("name:fi"), String::from("Keskustakirjasto")),
        ]);
        assert_eq!(osm_name(&tags).as_deref(), Some("Keskustakirjasto"));
    }

    #[test]
    fn osm_address_compacts_known_addr_fields() {
        let tags = HashMap::from([
            (String::from("addr:street"), String::from("Mannerheimintie")),
            (String::from("addr:housenumber"), String::from("5")),
            (String::from("addr:city"), String::from("Helsinki")),
        ]);
        assert_eq!(
            osm_address(&tags).as_deref(),
            Some("Mannerheimintie 5, Helsinki")
        );
    }
}
