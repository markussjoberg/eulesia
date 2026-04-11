use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Join table linking a thread to the hierarchical chain of locations it
/// belongs to. The user picks one location at any admin level; the server
/// derives ancestor rows (`depth > 0`) from the `locations.parent_id` chain
/// so the thread naturally appears in region- and country-level feeds.
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "thread_locations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub thread_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub location_id: Uuid,
    /// True for the single row the user actually chose. Exactly one row per
    /// thread has this flag set, enforced by a partial unique index.
    pub is_primary: bool,
    /// Hops from the primary location. `0` for the primary row, `1` for its
    /// direct parent, `2` for grandparent, and so on.
    pub depth: i16,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::threads::Entity",
        from = "Column::ThreadId",
        to = "super::threads::Column::Id",
        on_delete = "Cascade"
    )]
    Thread,
    #[sea_orm(
        belongs_to = "super::locations::Entity",
        from = "Column::LocationId",
        to = "super::locations::Column::Id",
        on_delete = "Cascade"
    )]
    Location,
}

impl Related<super::threads::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Thread.def()
    }
}

impl Related<super::locations::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Location.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
