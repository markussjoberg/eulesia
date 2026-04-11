use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr,
    EntityTrait, QueryFilter, Statement, prelude::Decimal,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entities::{locations, municipalities, threads, users};
use eulesia_common::types::{LocationStatus, LocationType, new_id};

/// Well-known UUID for the Eulesia Summary system user.
/// This is stable so that external services (import pipeline) can reference it.
pub const EULESIA_SUMMARY_USER_ID: Uuid = Uuid::from_bytes([
    0x01, 0x96, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x80, 0x00, 0xe0, 0x1e, 0x51, 0xa0, 0x00, 0x01,
]);

/// Well-known UUID for the "Finland" row in `locations`. Seeded by
/// [`sync_location_tree`] and referenced by backfill + feed queries. Matches
/// the UUIDv7 shape used by [`EULESIA_SUMMARY_USER_ID`] so the system-owned
/// well-known IDs share a visually distinct prefix.
pub const FINLAND_LOCATION_ID: Uuid = Uuid::from_bytes([
    0x01, 0x96, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x80, 0x00, 0xe0, 0x1e, 0x51, 0xa0, 0x00, 0x02,
]);

/// Well-known UUID for the "European Union" row in `locations`. Seeded by
/// [`sync_location_tree`]. Finland is NOT parented to this row (see the
/// docstring on [`sync_location_tree`] for why).
pub const EUROPEAN_UNION_LOCATION_ID: Uuid = Uuid::from_bytes([
    0x01, 0x96, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x80, 0x00, 0xe0, 0x1e, 0x51, 0xa0, 0x00, 0x03,
]);

const FINLAND_DATASET_VERSION: &str = "statfi-2026";
const FINNISH_MUNICIPALITIES_JSON: &str = include_str!("../data/fi_municipalities_2026.json");

#[derive(Debug, Clone, Deserialize)]
struct MunicipalitySeedRecord {
    official_code: String,
    name: String,
    name_fi: Option<String>,
    name_sv: Option<String>,
    region: Option<String>,
    country: Option<String>,
    population: Option<i32>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    bounds: Option<serde_json::Value>,
    designation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MunicipalitySyncReport {
    pub dataset_version: String,
    pub expected_count: usize,
    pub total_after_sync: usize,
    pub inserted: usize,
    pub updated: usize,
    pub matched_by_name: usize,
    pub coordinates_missing: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocationTreeSyncReport {
    pub country_inserted: bool,
    pub eu_inserted: bool,
    pub regions_inserted: usize,
    pub regions_total: usize,
    pub municipality_mirrors_inserted: usize,
    pub municipality_mirrors_total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThreadLocationBackfillReport {
    pub threads_scanned: usize,
    pub threads_backfilled: usize,
    pub rows_inserted: usize,
    pub threads_skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReferenceDataSyncReport {
    pub municipalities: MunicipalitySyncReport,
    pub location_tree: LocationTreeSyncReport,
    pub thread_location_backfill: ThreadLocationBackfillReport,
}

pub async fn sync_reference_data(
    db: &DatabaseConnection,
) -> Result<ReferenceDataSyncReport, DbErr> {
    // Order matters:
    //   1. Municipalities must be populated before the location tree mirrors
    //      them into `locations`.
    //   2. The location tree must exist before thread_locations can point at
    //      it.
    //   3. The summary user must exist so backfill can attribute
    //      source-institution-derived locations to summary threads.
    let municipalities = sync_finnish_municipalities(db).await?;
    ensure_summary_user(db).await?;
    let location_tree = sync_location_tree(db).await?;
    let thread_location_backfill = backfill_thread_locations(db).await?;
    Ok(ReferenceDataSyncReport {
        municipalities,
        location_tree,
        thread_location_backfill,
    })
}

/// Ensure the "Eulesia Summary" system user exists. This is the author of all
/// AI-generated summary threads. It is NOT affiliated with any institution —
/// summaries post to local scope with a municipality_id instead.
pub async fn ensure_summary_user(db: &DatabaseConnection) -> Result<(), DbErr> {
    let existing = users::Entity::find_by_id(EULESIA_SUMMARY_USER_ID)
        .one(db)
        .await?;

    if existing.is_some() {
        return Ok(());
    }

    let now = chrono::Utc::now().fixed_offset();
    users::ActiveModel {
        id: Set(EULESIA_SUMMARY_USER_ID),
        username: Set("eulesia-summary".into()),
        name: Set("Eulesia Summary".into()),
        email: Set(Some("summary@eulesia.eu".into())),
        role: Set("institution".into()),
        institution_type: Set(Some("service".into())),
        institution_name: Set(Some("Eulesia Summary".into())),
        identity_verified: Set(true),
        identity_provider: Set(Some("system".into())),
        identity_level: Set("high".into()),
        locale: Set("fi".into()),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(db)
    .await?;

    Ok(())
}

pub async fn sync_finnish_municipalities(
    db: &DatabaseConnection,
) -> Result<MunicipalitySyncReport, DbErr> {
    let seed_records = finnish_municipalities();
    let existing = municipalities::Entity::find().all(db).await?;

    let by_code: HashMap<String, municipalities::Model> = existing
        .iter()
        .filter_map(|model| {
            model
                .official_code
                .as_ref()
                .map(|code| (code.clone(), model.clone()))
        })
        .collect();

    let mut by_name = HashMap::new();
    for model in &existing {
        for key in municipality_name_keys(
            &model.name,
            model.name_fi.as_deref(),
            model.name_sv.as_deref(),
        ) {
            by_name.entry(key).or_insert_with(|| model.clone());
        }
    }

    let mut inserted = 0usize;
    let mut updated = 0usize;
    let mut matched_by_name = 0usize;

    for record in seed_records {
        let match_by_name = municipality_lookup_keys(record)
            .into_iter()
            .find_map(|key| by_name.get(&key).cloned());

        let existing_model = by_code
            .get(&record.official_code)
            .cloned()
            .or_else(|| match_by_name.clone());

        if let Some(model) = existing_model {
            if model.official_code.as_deref() != Some(record.official_code.as_str())
                && match_by_name.is_some()
            {
                matched_by_name += 1;
            }

            let mut active: municipalities::ActiveModel = model.into();
            active.official_code = Set(Some(record.official_code.clone()));
            active.name = Set(record.name.clone());
            active.name_fi = Set(record.name_fi.clone());
            active.name_sv = Set(record.name_sv.clone());
            active.region = Set(record.region.clone());
            active.country = Set(record.country.clone());
            active.population = Set(record.population);
            active.latitude = Set(decimal_from_f64(record.latitude));
            active.longitude = Set(decimal_from_f64(record.longitude));
            active.bounds = Set(record.bounds.clone());
            active.designation = Set(record.designation.clone());
            active.update(db).await?;
            updated += 1;
        } else {
            municipalities::ActiveModel {
                id: Set(new_id()),
                official_code: Set(Some(record.official_code.clone())),
                name: Set(record.name.clone()),
                name_fi: Set(record.name_fi.clone()),
                name_sv: Set(record.name_sv.clone()),
                region: Set(record.region.clone()),
                country: Set(record.country.clone()),
                population: Set(record.population),
                latitude: Set(decimal_from_f64(record.latitude)),
                longitude: Set(decimal_from_f64(record.longitude)),
                bounds: Set(record.bounds.clone()),
                designation: Set(record.designation.clone()),
                ..Default::default()
            }
            .insert(db)
            .await?;
            inserted += 1;
        }
    }

    let synced = municipalities::Entity::find().all(db).await?;
    let coordinates_missing = synced
        .iter()
        .filter(|model| model.latitude.is_none() || model.longitude.is_none())
        .count();

    Ok(MunicipalitySyncReport {
        dataset_version: String::from(FINLAND_DATASET_VERSION),
        expected_count: seed_records.len(),
        total_after_sync: synced.len(),
        inserted,
        updated,
        matched_by_name,
        coordinates_missing,
    })
}

pub fn expected_finnish_municipality_count() -> usize {
    finnish_municipalities().len()
}

fn finnish_municipalities() -> &'static Vec<MunicipalitySeedRecord> {
    static DATA: OnceLock<Vec<MunicipalitySeedRecord>> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(FINNISH_MUNICIPALITIES_JSON)
            .expect("bundled Finnish municipality dataset must be valid JSON")
    })
}

fn municipality_lookup_keys(record: &MunicipalitySeedRecord) -> Vec<String> {
    municipality_name_keys(
        &record.name,
        record.name_fi.as_deref(),
        record.name_sv.as_deref(),
    )
}

fn municipality_name_keys(name: &str, name_fi: Option<&str>, name_sv: Option<&str>) -> Vec<String> {
    let mut keys = vec![normalize_name(name)];
    if let Some(name_fi) = name_fi {
        keys.push(normalize_name(name_fi));
    }
    if let Some(name_sv) = name_sv {
        keys.push(normalize_name(name_sv));
    }
    keys
}

fn normalize_name(name: &str) -> String {
    name.trim()
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn decimal_from_f64(value: Option<f64>) -> Option<Decimal> {
    value.and_then(Decimal::from_f64_retain)
}

// ---------------------------------------------------------------------------
// Location tree seeding
// ---------------------------------------------------------------------------

/// Seed the hierarchical `locations` tree used by the flat-feed redesign:
///
/// - One `Country` row for Finland ([`FINLAND_LOCATION_ID`]) with `parent_id =
///   NULL`. Finland is kept as a top-level root rather than parented under the
///   EU row so that subscribing to "Finland" does not implicitly subscribe a
///   user to every EU-level post. The EU entry is a separate sibling tree.
/// - One `Other` row for the European Union ([`EUROPEAN_UNION_LOCATION_ID`])
///   with `parent_id = NULL`. `LocationType` does not have a `Supranational`
///   variant yet; `Other` is the pragmatic placeholder until one is added.
/// - One `Region` row per unique `municipalities.region` string. Parent is
///   Finland. IDs are freshly generated (not stable constants) — the region
///   name plus parent is used as the dedup key.
/// - One `Municipality`-type mirror row per `municipalities` row, with
///   `municipality_code = official_code` as the back-reference. Parent is the
///   region location. Raw lat/lng and bounds are copied over so the map layer
///   can read from either table during the transition.
///
/// The function is idempotent: re-running it after a partial run skips rows
/// that already exist. It never deletes or updates existing rows — later
/// re-syncs only add.
pub async fn sync_location_tree(db: &DatabaseConnection) -> Result<LocationTreeSyncReport, DbErr> {
    let now = chrono::Utc::now().fixed_offset();

    // Finland + EU (top-level roots) ---------------------------------------
    let country_inserted =
        ensure_country_location(db, FINLAND_LOCATION_ID, "Finland", "Suomi", "FI", now).await?;
    let eu_inserted = ensure_supranational_location(
        db,
        EUROPEAN_UNION_LOCATION_ID,
        "European Union",
        "Euroopan unioni",
        now,
    )
    .await?;

    // Regions --------------------------------------------------------------
    let municipality_rows = municipalities::Entity::find().all(db).await?;
    let mut unique_regions: Vec<String> = municipality_rows
        .iter()
        .filter_map(|m| m.region.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    unique_regions.sort();

    let mut region_ids: HashMap<String, Uuid> = HashMap::new();
    let mut regions_inserted = 0usize;
    for region_name in &unique_regions {
        let (id, inserted) =
            ensure_region_location(db, region_name, FINLAND_LOCATION_ID, now).await?;
        if inserted {
            regions_inserted += 1;
        }
        region_ids.insert(region_name.clone(), id);
    }

    // Municipality mirrors -------------------------------------------------
    let existing_mirrors: HashSet<String> = locations::Entity::find()
        .filter(locations::Column::MunicipalityCode.is_not_null())
        .all(db)
        .await?
        .into_iter()
        .filter_map(|l| l.municipality_code)
        .collect();

    let mut municipality_mirrors_inserted = 0usize;
    let mut municipality_mirrors_total = 0usize;
    for municipality in &municipality_rows {
        let Some(code) = &municipality.official_code else {
            continue;
        };
        municipality_mirrors_total += 1;
        if existing_mirrors.contains(code) {
            continue;
        }

        let parent_id = municipality
            .region
            .as_ref()
            .and_then(|r| region_ids.get(r).copied())
            .unwrap_or(FINLAND_LOCATION_ID);

        locations::ActiveModel {
            id: Set(new_id()),
            osm_id: Set(None),
            osm_type: Set(None),
            name: Set(municipality.name.clone()),
            name_local: Set(None),
            name_fi: Set(municipality.name_fi.clone()),
            name_sv: Set(municipality.name_sv.clone()),
            name_en: Set(None),
            admin_level: Set(Some(8)), // OSM convention: kunta = admin_level 8
            r#type: Set(Some(LocationType::Municipality)),
            parent_id: Set(Some(parent_id)),
            country: Set(municipality.country.clone()),
            latitude: Set(municipality.latitude),
            longitude: Set(municipality.longitude),
            bounds: Set(municipality.bounds.clone()),
            population: Set(municipality.population.map(i64::from)),
            status: Set(LocationStatus::Active),
            content_count: Set(0),
            municipality_code: Set(Some(code.clone())),
            created_at: Set(now),
        }
        .insert(db)
        .await?;
        municipality_mirrors_inserted += 1;
    }

    Ok(LocationTreeSyncReport {
        country_inserted,
        eu_inserted,
        regions_inserted,
        regions_total: unique_regions.len(),
        municipality_mirrors_inserted,
        municipality_mirrors_total,
    })
}

/// Insert the Finland location row if missing. Returns `true` if inserted.
async fn ensure_country_location(
    db: &DatabaseConnection,
    id: Uuid,
    name_en: &str,
    name_fi: &str,
    country_code: &str,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<bool, DbErr> {
    if locations::Entity::find_by_id(id).one(db).await?.is_some() {
        return Ok(false);
    }
    locations::ActiveModel {
        id: Set(id),
        osm_id: Set(None),
        osm_type: Set(None),
        name: Set(name_en.to_string()),
        name_local: Set(Some(name_fi.to_string())),
        name_fi: Set(Some(name_fi.to_string())),
        name_sv: Set(None),
        name_en: Set(Some(name_en.to_string())),
        admin_level: Set(Some(2)), // OSM convention: country = admin_level 2
        r#type: Set(Some(LocationType::Country)),
        parent_id: Set(None),
        country: Set(Some(country_code.to_string())),
        latitude: Set(None),
        longitude: Set(None),
        bounds: Set(None),
        population: Set(None),
        status: Set(LocationStatus::Active),
        content_count: Set(0),
        municipality_code: Set(None),
        created_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(true)
}

/// Insert the European Union location row if missing. Returns `true` if
/// inserted. Uses `LocationType::Other` because the enum has no
/// `Supranational` variant yet.
async fn ensure_supranational_location(
    db: &DatabaseConnection,
    id: Uuid,
    name_en: &str,
    name_fi: &str,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<bool, DbErr> {
    if locations::Entity::find_by_id(id).one(db).await?.is_some() {
        return Ok(false);
    }
    locations::ActiveModel {
        id: Set(id),
        osm_id: Set(None),
        osm_type: Set(None),
        name: Set(name_en.to_string()),
        name_local: Set(Some(name_fi.to_string())),
        name_fi: Set(Some(name_fi.to_string())),
        name_sv: Set(None),
        name_en: Set(Some(name_en.to_string())),
        admin_level: Set(Some(1)),
        r#type: Set(Some(LocationType::Other)),
        parent_id: Set(None),
        country: Set(None),
        latitude: Set(None),
        longitude: Set(None),
        bounds: Set(None),
        population: Set(None),
        status: Set(LocationStatus::Active),
        content_count: Set(0),
        municipality_code: Set(None),
        created_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(true)
}

/// Insert a region-level location row for a Finnish maakunta if missing.
/// Dedup key is `(name, parent_id)` — matching by name avoids creating
/// duplicates on reruns.
async fn ensure_region_location(
    db: &DatabaseConnection,
    name: &str,
    parent_id: Uuid,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<(Uuid, bool), DbErr> {
    if let Some(existing) = locations::Entity::find()
        .filter(locations::Column::Name.eq(name))
        .filter(locations::Column::ParentId.eq(parent_id))
        .filter(locations::Column::Type.eq(LocationType::Region))
        .one(db)
        .await?
    {
        return Ok((existing.id, false));
    }

    let id = new_id();
    locations::ActiveModel {
        id: Set(id),
        osm_id: Set(None),
        osm_type: Set(None),
        name: Set(name.to_string()),
        name_local: Set(Some(name.to_string())),
        name_fi: Set(Some(name.to_string())),
        name_sv: Set(None),
        name_en: Set(None),
        admin_level: Set(Some(4)), // OSM convention: maakunta = admin_level 4
        r#type: Set(Some(LocationType::Region)),
        parent_id: Set(Some(parent_id)),
        country: Set(Some("FI".to_string())),
        latitude: Set(None),
        longitude: Set(None),
        bounds: Set(None),
        population: Set(None),
        status: Set(LocationStatus::Active),
        content_count: Set(0),
        municipality_code: Set(None),
        created_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok((id, true))
}

// ---------------------------------------------------------------------------
// Thread location backfill
// ---------------------------------------------------------------------------

/// Backfill the `thread_locations` table from the existing
/// `threads.scope` / `municipality_id` / `location_id` / `place_id` fields.
///
/// Idempotent by construction: only scans threads that currently have ZERO
/// rows in `thread_locations` (LEFT JOIN NULL check). For each such thread:
///
/// - `scope = 'personal'` → no rows (the "ihmiset" tier).
/// - `scope = 'national'` → one primary row at [`FINLAND_LOCATION_ID`].
/// - `scope = 'european'` → one primary row at [`EUROPEAN_UNION_LOCATION_ID`].
/// - `scope = 'local'` + `municipality_id` → primary row at the matching
///   location (found via `municipality_code`), plus one row per ancestor
///   walked via `locations.parent_id` (depth 1, 2, ...).
/// - Thread has explicit `location_id` → primary row at that id plus ancestors.
///
/// Everything is done in a single recursive SQL statement so production
/// backfill is one round-trip instead of N. `ON CONFLICT DO NOTHING` makes
/// partial runs safe to retry.
pub async fn backfill_thread_locations(
    db: &DatabaseConnection,
) -> Result<ThreadLocationBackfillReport, DbErr> {
    // Count of threads eligible for backfill (no existing rows).
    let eligible_sql = r"
        SELECT COUNT(*) FROM threads t
        WHERE t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM thread_locations tl WHERE tl.thread_id = t.id
          )
    ";
    let threads_scanned: i64 = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            eligible_sql,
        ))
        .await?
        .and_then(|row| row.try_get_by_index::<i64>(0).ok())
        .unwrap_or(0);

    // The backfill is expressed as a single statement that walks the
    // `locations.parent_id` chain for each thread's chosen primary, then
    // inserts one row per ancestor. Uses a recursive CTE so the ancestry is
    // computed on the database side.
    //
    // Primary location resolution order:
    //   1. Direct `threads.location_id` (already an OSM location)
    //   2. `threads.place_id` → `places.location_id`
    //   3. `threads.municipality_id` → `locations.municipality_code` mirror
    //   4. `threads.scope = 'national'` → FINLAND_LOCATION_ID
    //   5. `threads.scope = 'european'` → EUROPEAN_UNION_LOCATION_ID
    //   6. None → skip (personal scope)
    let backfill_sql = r"
        WITH primary_resolved AS (
            SELECT
                t.id AS thread_id,
                COALESCE(
                    t.location_id,
                    (SELECT p.location_id FROM places p WHERE p.id = t.place_id),
                    (
                        SELECT l.id
                        FROM locations l
                        JOIN municipalities m ON m.official_code = l.municipality_code
                        WHERE m.id = t.municipality_id
                        LIMIT 1
                    ),
                    CASE
                        WHEN t.scope = 'national' THEN $1::uuid
                        WHEN t.scope = 'european' THEN $2::uuid
                        ELSE NULL
                    END
                ) AS primary_location_id
            FROM threads t
            WHERE t.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM thread_locations tl WHERE tl.thread_id = t.id
              )
        ),
        ancestor_walk AS (
            -- Depth 0: the user's chosen primary location.
            SELECT
                pr.thread_id,
                pr.primary_location_id AS location_id,
                0::smallint AS depth,
                true AS is_primary
            FROM primary_resolved pr
            WHERE pr.primary_location_id IS NOT NULL

            UNION ALL

            -- Depth N+1: walk up parent_id.
            SELECT
                aw.thread_id,
                l.parent_id AS location_id,
                (aw.depth + 1)::smallint,
                false AS is_primary
            FROM ancestor_walk aw
            JOIN locations l ON l.id = aw.location_id
            WHERE l.parent_id IS NOT NULL
              AND aw.depth < 8 -- safety cap against accidental cycles
        )
        INSERT INTO thread_locations (thread_id, location_id, is_primary, depth, created_at)
        SELECT thread_id, location_id, is_primary, depth, now()
        FROM ancestor_walk
        ON CONFLICT (thread_id, location_id) DO NOTHING
    ";

    let backend = db.get_database_backend();
    let result = db
        .execute(Statement::from_sql_and_values(
            backend,
            backfill_sql,
            [
                FINLAND_LOCATION_ID.into(),
                EUROPEAN_UNION_LOCATION_ID.into(),
            ],
        ))
        .await?;
    let rows_inserted = result.rows_affected() as usize;

    // How many threads actually received rows?
    let backfilled_sql = r"
        SELECT COUNT(DISTINCT tl.thread_id)
        FROM thread_locations tl
        WHERE tl.created_at >= now() - interval '1 minute'
    ";
    let threads_backfilled: i64 = db
        .query_one(Statement::from_string(backend, backfilled_sql))
        .await?
        .and_then(|row| row.try_get_by_index::<i64>(0).ok())
        .unwrap_or(0);

    Ok(ThreadLocationBackfillReport {
        threads_scanned: threads_scanned as usize,
        threads_backfilled: threads_backfilled as usize,
        rows_inserted,
        threads_skipped: (threads_scanned as usize).saturating_sub(threads_backfilled as usize),
    })
}

// Silence unused-import warning for threads entity until the backfill logic
// needs it programmatically (currently it uses raw SQL).
#[allow(dead_code)]
fn _threads_entity_marker() -> threads::Entity {
    threads::Entity
}

#[cfg(test)]
mod tests {
    use super::{expected_finnish_municipality_count, normalize_name};

    #[test]
    fn bundled_dataset_is_non_empty() {
        assert!(expected_finnish_municipality_count() >= 300);
    }

    #[test]
    fn municipality_name_normalization_ignores_spacing_and_case() {
        assert_eq!(normalize_name(" Etelä-Pohjanmaa "), "eteläpohjanmaa");
    }
}
