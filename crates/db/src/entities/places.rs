use eulesia_common::types::SyncStatus;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "places")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    pub name_fi: Option<String>,
    pub name_sv: Option<String>,
    pub name_en: Option<String>,
    pub description: Option<String>,
    pub latitude: Option<Decimal>,
    pub longitude: Option<Decimal>,
    pub radius_km: Option<Decimal>,
    pub geojson: Option<Json>,
    pub r#type: String,
    pub category: Option<String>,
    pub subcategory: Option<String>,
    pub municipality_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub country: Option<String>,
    pub address: Option<String>,
    pub source: String,
    pub source_id: Option<String>,
    pub source_url: Option<String>,
    pub osm_id: Option<String>,
    pub last_synced: Option<DateTimeWithTimeZone>,
    pub sync_status: SyncStatus,
    pub metadata: Option<Json>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::municipalities::Entity",
        from = "Column::MunicipalityId",
        to = "super::municipalities::Column::Id"
    )]
    Municipality,
    #[sea_orm(
        belongs_to = "super::locations::Entity",
        from = "Column::LocationId",
        to = "super::locations::Column::Id"
    )]
    Location,
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::CreatedBy",
        to = "super::users::Column::Id"
    )]
    Creator,
}

impl Related<super::municipalities::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Municipality.def()
    }
}

impl Related<super::locations::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Location.def()
    }
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Creator.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
