use std::collections::HashMap;
use std::sync::OnceLock;

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait, prelude::Decimal,
};
use serde::{Deserialize, Serialize};

use crate::entities::municipalities;
use eulesia_common::types::new_id;

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
pub struct ReferenceDataSyncReport {
    pub municipalities: MunicipalitySyncReport,
}

pub async fn sync_reference_data(
    db: &DatabaseConnection,
) -> Result<ReferenceDataSyncReport, DbErr> {
    let municipalities = sync_finnish_municipalities(db).await?;
    Ok(ReferenceDataSyncReport { municipalities })
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
