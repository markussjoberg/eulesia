//! Repository for the `thread_locations` join table.
//!
//! Part of the Phase 2 flat-feed redesign. The canonical way to attach a
//! thread to a place going forward is [`ThreadLocationRepo::attach_primary`],
//! which takes the user's chosen location and writes one row per ancestor
//! walked via `locations.parent_id`. Feed queries should use
//! [`ThreadLocationRepo::threads_in_location_tree`] to get every thread that
//! lives at or below a given location.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, QueryOrder, QuerySelect, Statement,
};
use uuid::Uuid;

use crate::entities::thread_locations;

pub struct ThreadLocationRepo;

/// One row in the thread → location mapping.
#[derive(Debug, Clone)]
pub struct ThreadLocation {
    pub thread_id: Uuid,
    pub location_id: Uuid,
    pub is_primary: bool,
    pub depth: i16,
}

impl From<thread_locations::Model> for ThreadLocation {
    fn from(m: thread_locations::Model) -> Self {
        Self {
            thread_id: m.thread_id,
            location_id: m.location_id,
            is_primary: m.is_primary,
            depth: m.depth,
        }
    }
}

impl ThreadLocationRepo {
    /// Attach a thread to a primary location and all of its ancestors.
    ///
    /// The primary row (`depth = 0`, `is_primary = true`) is inserted first,
    /// then the ancestor chain is walked via a recursive CTE on
    /// `locations.parent_id`. Uses `ON CONFLICT DO NOTHING` so repeat calls
    /// for the same thread are safe (but see [`detach_all`] if you want to
    /// move a thread to a different primary).
    ///
    /// Returns the number of rows actually inserted (0 if the primary was
    /// already present).
    pub async fn attach_primary(
        db: &DatabaseConnection,
        thread_id: Uuid,
        primary_location_id: Uuid,
    ) -> Result<u64, DbErr> {
        // Single recursive-CTE statement: depth 0 is the chosen primary,
        // depth N+1 is `parent_id`. Safety cap at depth 8 so a miswired tree
        // cannot loop forever.
        let sql = r"
            WITH RECURSIVE ancestor_walk AS (
                SELECT $2::uuid AS location_id, 0::smallint AS depth, true AS is_primary
                UNION ALL
                SELECT l.parent_id, (aw.depth + 1)::smallint, false
                FROM ancestor_walk aw
                JOIN locations l ON l.id = aw.location_id
                WHERE l.parent_id IS NOT NULL AND aw.depth < 8
            )
            INSERT INTO thread_locations (thread_id, location_id, is_primary, depth, created_at)
            SELECT $1, location_id, is_primary, depth, now()
            FROM ancestor_walk
            WHERE location_id IS NOT NULL
            ON CONFLICT (thread_id, location_id) DO NOTHING
        ";

        let result = db
            .execute(Statement::from_sql_and_values(
                DbBackend::Postgres,
                sql,
                [thread_id.into(), primary_location_id.into()],
            ))
            .await?;
        Ok(result.rows_affected())
    }

    /// Delete every `thread_locations` row for a thread. Used when the user
    /// edits a thread and picks a different primary location.
    pub async fn detach_all(db: &DatabaseConnection, thread_id: Uuid) -> Result<u64, DbErr> {
        let result = thread_locations::Entity::delete_many()
            .filter(thread_locations::Column::ThreadId.eq(thread_id))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Return every row attached to a given thread, including the derived
    /// ancestor rows.
    pub async fn for_thread(
        db: &DatabaseConnection,
        thread_id: Uuid,
    ) -> Result<Vec<ThreadLocation>, DbErr> {
        let rows = thread_locations::Entity::find()
            .filter(thread_locations::Column::ThreadId.eq(thread_id))
            .all(db)
            .await?;
        Ok(rows.into_iter().map(ThreadLocation::from).collect())
    }

    /// Return every `thread_id` that has any row pointing at `location_id` or
    /// one of its descendants (following the `locations.parent_id` tree
    /// downward). Used by feed queries that want hierarchical roll-up: a
    /// query for "Uusimaa" returns Helsinki, Espoo, and Vantaa posts too.
    ///
    /// If you want only direct matches (`depth = 0`), use
    /// [`threads_in_location`] instead.
    pub async fn threads_in_location_tree(
        db: &DatabaseConnection,
        location_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<Uuid>, DbErr> {
        // The recursive CTE walks DOWN the `locations.parent_id` tree,
        // collecting every descendant of `location_id` (inclusive). The join
        // to `thread_locations` then gives us all matching threads.
        let sql = r"
            WITH RECURSIVE descendants AS (
                SELECT id FROM locations WHERE id = $1
                UNION ALL
                SELECT l.id
                FROM locations l
                JOIN descendants d ON l.parent_id = d.id
            )
            SELECT DISTINCT tl.thread_id
            FROM thread_locations tl
            JOIN descendants d ON tl.location_id = d.id
            ORDER BY tl.thread_id DESC
            LIMIT $2 OFFSET $3
        ";

        #[derive(Debug, sea_orm::FromQueryResult)]
        struct IdRow {
            thread_id: Uuid,
        }

        let rows = IdRow::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [
                location_id.into(),
                (limit as i64).into(),
                (offset as i64).into(),
            ],
        ))
        .all(db)
        .await?;

        Ok(rows.into_iter().map(|r| r.thread_id).collect())
    }

    /// Return every thread whose primary OR any ancestor row is exactly at
    /// `location_id`. Unlike [`threads_in_location_tree`], this does NOT
    /// recurse into descendants. Use for "strict level only" feeds
    /// (`?strict_level=true`).
    pub async fn threads_in_location(
        db: &DatabaseConnection,
        location_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> Result<Vec<Uuid>, DbErr> {
        let rows = thread_locations::Entity::find()
            .filter(thread_locations::Column::LocationId.eq(location_id))
            .order_by_desc(thread_locations::Column::ThreadId)
            .limit(limit)
            .offset(offset)
            .all(db)
            .await?;
        Ok(rows.into_iter().map(|r| r.thread_id).collect())
    }
}
