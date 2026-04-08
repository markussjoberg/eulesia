use eulesia_common::types::{LocationStatus, LocationType};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "locations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub osm_id: Option<i64>,
    pub osm_type: Option<String>,
    pub name: String,
    pub name_local: Option<String>,
    pub name_fi: Option<String>,
    pub name_sv: Option<String>,
    pub name_en: Option<String>,
    pub admin_level: Option<i32>,
    pub r#type: Option<LocationType>,
    pub parent_id: Option<Uuid>,
    pub country: Option<String>,
    pub latitude: Option<Decimal>,
    pub longitude: Option<Decimal>,
    pub bounds: Option<Json>,
    pub population: Option<i64>,
    pub status: LocationStatus,
    pub content_count: i32,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
