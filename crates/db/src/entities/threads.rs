use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "threads")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub content_html: Option<String>,
    pub author_id: Uuid,
    pub scope: String,
    pub country: Option<String>,
    pub municipality_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub place_id: Option<Uuid>,
    pub latitude: Option<Decimal>,
    pub longitude: Option<Decimal>,
    pub institutional_context: Option<Json>,
    pub is_pinned: bool,
    pub is_locked: bool,
    pub reply_count: i32,
    pub score: i32,
    pub view_count: i32,
    pub source: String,
    pub source_url: Option<String>,
    pub source_id: Option<String>,
    pub source_institution_id: Option<Uuid>,
    pub ai_generated: bool,
    pub ai_model: Option<String>,
    pub language: Option<String>,
    pub is_hidden: bool,
    pub club_id: Option<Uuid>,
    pub ai_analysis: Option<Json>,
    pub flagged_at: Option<DateTimeWithTimeZone>,
    pub flagged_reason: Option<String>,
    pub deleted_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::AuthorId",
        to = "super::users::Column::Id"
    )]
    Author,
    #[sea_orm(has_many = "super::comments::Entity")]
    Comments,
    #[sea_orm(has_many = "super::thread_votes::Entity")]
    Votes,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Author.def()
    }
}

impl Related<super::comments::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Comments.def()
    }
}

impl Related<super::thread_votes::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Votes.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
