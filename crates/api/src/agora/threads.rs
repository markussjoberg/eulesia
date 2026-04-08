use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, Query, State};
use sea_orm::ActiveValue::Set;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use tracing::warn;

use crate::AppState;
use eulesia_auth::session::{AuthUser, OptionalAuth};
use eulesia_common::error::ApiError;
use eulesia_common::types::{Coordinates, ThreadScope, ThreadSource, UserRole, new_id};
use eulesia_db::repo::blocks::BlockRepo;
use eulesia_db::repo::bookmarks::BookmarkRepo;
use eulesia_db::repo::comments::CommentRepo;
use eulesia_db::repo::follows::FollowRepo;
use eulesia_db::repo::outbox_helpers::emit_event;
use eulesia_db::repo::tags::TagRepo;
use eulesia_db::repo::thread_views::ThreadViewRepo;
use eulesia_db::repo::threads::ThreadRepo;
use eulesia_db::repo::users::UserRepo;
use eulesia_db::repo::votes::VoteRepo;

use super::types::{
    AuthorSummary, CommentListParams, CommentResponse, CreateThreadRequest, ThreadListParams,
    ThreadListResponse, ThreadResponse, ThreadWithCommentsResponse, UpdateThreadRequest,
};

const VALID_SCOPES: &[&str] = &["local", "national", "european", "personal"];
const DEFAULT_LIMIT: u64 = 20;
const MAX_LIMIT: u64 = 100;

fn validate_scope(scope: &str) -> Result<(), ApiError> {
    if !VALID_SCOPES.contains(&scope) {
        return Err(ApiError::BadRequest(format!(
            "invalid scope '{scope}': must be local, national, european, or personal"
        )));
    }
    Ok(())
}

fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT)
}

async fn resolve_municipality_id(
    db: &sea_orm::DatabaseConnection,
    scope: ThreadScope,
    req_municipality_id: Option<Uuid>,
    resolved_location: Option<&eulesia_db::entities::locations::Model>,
) -> Result<Option<Uuid>, ApiError> {
    if scope != ThreadScope::Local {
        return Ok(req_municipality_id);
    }

    if let Some(id) = req_municipality_id {
        return Ok(Some(id));
    }

    let Some(location) = resolved_location else {
        return Err(ApiError::BadRequest(
            "municipalityId is required for local scope".into(),
        ));
    };

    let coords = Coordinates::from_options(
        location.latitude.and_then(crate::locations::decimal_to_f64),
        location
            .longitude
            .and_then(crate::locations::decimal_to_f64),
    )
    .ok_or_else(|| {
        ApiError::BadRequest(
            "local threads require municipalityId or a location with coordinates".into(),
        )
    })?;

    let municipality = crate::locations::nearest_municipality(db, coords).await?;
    municipality
        .map(|m| m.id)
        .ok_or_else(|| ApiError::BadRequest("municipalityId is required for local scope".into()))
        .map(Some)
}

fn author_map(users: Vec<eulesia_db::entities::users::Model>) -> HashMap<Uuid, AuthorSummary> {
    users
        .into_iter()
        .map(|u| {
            (
                u.id,
                AuthorSummary {
                    id: u.id,
                    username: u.username,
                    name: u.name,
                    avatar_url: u.avatar_url,
                    role: u.role.parse().unwrap_or(UserRole::Citizen),
                    institution_type: u.institution_type,
                    institution_name: u.institution_name,
                    identity_verified: u.identity_verified,
                },
            )
        })
        .collect()
}

fn deleted_author() -> AuthorSummary {
    AuthorSummary {
        id: Uuid::nil(),
        username: "[deleted]".into(),
        name: "[deleted]".into(),
        avatar_url: None,
        role: UserRole::Citizen,
        institution_type: None,
        institution_name: None,
        identity_verified: false,
    }
}

#[allow(clippy::needless_pass_by_value)] // used as fn pointer in map_err
fn db_err(e: sea_orm::DbErr) -> ApiError {
    ApiError::Database(e.to_string())
}

/// Compute the set of author IDs that should be excluded from results for the
/// authenticated user (union of users they blocked + users who blocked them).
async fn blocked_ids(
    db: &sea_orm::DatabaseConnection,
    user_id: Uuid,
) -> Result<Vec<Uuid>, ApiError> {
    let blocked = BlockRepo::blocked_by_user(db, user_id)
        .await
        .map_err(db_err)?;
    let blocked_by = BlockRepo::users_who_blocked(db, user_id)
        .await
        .map_err(db_err)?;

    let mut set: HashSet<Uuid> = HashSet::new();
    set.extend(blocked);
    set.extend(blocked_by);
    Ok(set.into_iter().collect())
}

// ---------------------------------------------------------------------------
// Enrichment helpers (reused by tags module)
// ---------------------------------------------------------------------------

/// Batch-fetch municipality names by id, returning a map.
async fn fetch_municipality_names(
    db: &sea_orm::DatabaseConnection,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, String>, ApiError> {
    use eulesia_db::entities::municipalities;

    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = municipalities::Entity::find()
        .filter(municipalities::Column::Id.is_in(ids.to_vec()))
        .all(db)
        .await
        .map_err(db_err)?;

    Ok(rows.into_iter().map(|m| (m.id, m.name)).collect())
}

/// Fetch a single municipality name, returning `None` if id is `None` or not found.
async fn fetch_municipality_name(
    db: &sea_orm::DatabaseConnection,
    id: Option<Uuid>,
) -> Result<Option<String>, ApiError> {
    let Some(id) = id else { return Ok(None) };
    let map = fetch_municipality_names(db, &[id]).await?;
    Ok(map.into_values().next())
}

/// Enrich a list of thread models into full `ThreadResponse`s.
pub async fn enrich_threads(
    db: &sea_orm::DatabaseConnection,
    threads: Vec<eulesia_db::entities::threads::Model>,
    auth_user_id: Option<Uuid>,
) -> Result<Vec<ThreadResponse>, ApiError> {
    if threads.is_empty() {
        return Ok(vec![]);
    }

    let thread_ids: Vec<Uuid> = threads.iter().map(|t| t.id).collect();
    let author_ids: Vec<Uuid> = threads
        .iter()
        .map(|t| t.author_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Batch fetch authors and tags.
    let users = UserRepo::find_by_ids(db, &author_ids)
        .await
        .map_err(db_err)?;
    let tag_models = TagRepo::tags_for_threads(db, &thread_ids)
        .await
        .map_err(db_err)?;

    let authors = author_map(users);

    // Build tag lookup: thread_id -> Vec<String>
    let mut tags_map: HashMap<Uuid, Vec<String>> = HashMap::new();
    for t in tag_models {
        tags_map.entry(t.thread_id).or_default().push(t.tag);
    }

    // Batch-fetch municipality names for threads that have one.
    let municipality_ids: Vec<Uuid> = threads
        .iter()
        .filter_map(|t| t.municipality_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let municipality_name_map = fetch_municipality_names(db, &municipality_ids).await?;

    // Per-user enrichment (votes, bookmarks).
    let (vote_map, bookmark_set): (HashMap<Uuid, i16>, HashSet<Uuid>) = if let Some(uid) =
        auth_user_id
    {
        let votes = VoteRepo::get_user_votes_for_threads(db, &thread_ids, uid)
            .await
            .map_err(db_err)?;
        let bookmarks = BookmarkRepo::are_bookmarked(db, uid, &thread_ids)
            .await
            .map_err(db_err)?;

        let vm: HashMap<Uuid, i16> = votes.into_iter().map(|v| (v.thread_id, v.value)).collect();
        let bs: HashSet<Uuid> = bookmarks.into_iter().collect();
        (vm, bs)
    } else {
        (HashMap::new(), HashSet::new())
    };

    let responses = threads
        .into_iter()
        .map(|t| {
            let author = authors
                .get(&t.author_id)
                .cloned()
                .unwrap_or_else(deleted_author);
            let municipality_name = t
                .municipality_id
                .and_then(|id| municipality_name_map.get(&id).cloned());
            ThreadResponse {
                id: t.id,
                title: t.title,
                content: t.content,
                content_html: t.content_html,
                scope: t.scope.parse().unwrap_or_else(|_| {
                    warn!(thread_id = %t.id, scope = %t.scope, "unknown thread scope in DB, defaulting to national");
                    ThreadScope::National
                }),
                author,
                tags: tags_map.remove(&t.id).unwrap_or_default(),
                municipality_id: t.municipality_id,
                municipality_name,
                institutional_context: t.institutional_context,
                reply_count: t.reply_count,
                score: t.score,
                view_count: t.view_count,
                user_vote: vote_map.get(&t.id).copied(),
                is_bookmarked: bookmark_set.contains(&t.id),
                is_pinned: t.is_pinned,
                is_locked: t.is_locked,
                source: t.source.parse().unwrap_or_else(|_| {
                    warn!(thread_id = %t.id, source = %t.source, "unknown thread source in DB, defaulting to user");
                    ThreadSource::User
                }),
                source_url: t.source_url,
                source_institution_id: t.source_institution_id,
                ai_generated: t.ai_generated,
                created_at: t.created_at.to_rfc3339(),
                updated_at: t.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(responses)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list_threads(
    opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Query(params): Query<ThreadListParams>,
) -> Result<Json<ThreadListResponse>, ApiError> {
    let is_following = params.scope.as_deref() == Some("following");

    // "all" and "following" mean no scope filter in the DB query
    let scope_filter = params
        .scope
        .as_deref()
        .filter(|s| !matches!(*s, "all" | "following"));
    if let Some(scope) = scope_filter {
        validate_scope(scope)?;
    }

    let user_id = opt_auth.0.as_ref().map(|a| a.user_id.0);
    let excluded = match user_id {
        Some(uid) => blocked_ids(&state.db, uid).await?,
        None => vec![],
    };

    let sort = params.sort.as_deref().unwrap_or("recent");
    let limit = clamp_limit(params.limit);
    // Support both page-based and offset-based pagination
    let page = params.page.unwrap_or(1).max(1);
    let offset = params.offset.unwrap_or_else(|| (page - 1) * limit);

    // Check if user has any subscriptions (follows)
    let has_subscriptions = match user_id {
        Some(uid) => {
            FollowRepo::count_following(&state.db, uid)
                .await
                .map_err(db_err)?
                > 0
        }
        None => false,
    };

    // For "following" feed, resolve followed author IDs and use author_id filter
    let following_author_id = if is_following {
        if let Some(uid) = user_id {
            let (follows, _) = FollowRepo::following_of(&state.db, uid, 0, 10_000)
                .await
                .map_err(db_err)?;
            let ids: Vec<Uuid> = follows.iter().map(|f| f.followed_id).collect();
            if ids.is_empty() {
                // No follows — return empty result immediately
                return Ok(Json(ThreadListResponse {
                    data: vec![],
                    total: 0,
                    page,
                    limit,
                    has_more: false,
                    feed_scope: Some("following".into()),
                    has_subscriptions: false,
                }));
            }
            Some(ids)
        } else {
            return Err(ApiError::Unauthorized);
        }
    } else {
        None
    };

    // If filtering by tag, resolve thread IDs first, then pass them into
    // ThreadRepo::list so that sorting, visibility, and pagination are applied
    // correctly against the intersected set.
    let tag_ids = if let Some(ref tag) = params.tag {
        let (ids, _) = TagRepo::thread_ids_for_tag(&state.db, tag, 0, 100_000)
            .await
            .map_err(db_err)?;
        Some(ids)
    } else {
        None
    };

    let (threads, total) = ThreadRepo::list(
        &state.db,
        if following_author_id.is_some() {
            None
        } else {
            scope_filter
        },
        params.municipality_id,
        following_author_id.as_deref(),
        tag_ids.as_deref(),
        &excluded,
        sort,
        params.top_period.as_deref(),
        offset,
        limit,
    )
    .await
    .map_err(db_err)?;

    let data = enrich_threads(&state.db, threads, user_id).await?;
    let has_more = offset + limit < total;

    Ok(Json(ThreadListResponse {
        data,
        total,
        page,
        limit,
        has_more,
        feed_scope: params.scope.clone(),
        has_subscriptions,
    }))
}

#[allow(clippy::too_many_lines)]
pub async fn get_thread(
    opt_auth: OptionalAuth,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(comment_params): Query<CommentListParams>,
) -> Result<Json<ThreadWithCommentsResponse>, ApiError> {
    let user_id = opt_auth.0.as_ref().map(|a| a.user_id.0);

    // Compute excluded (blocked) IDs first so we can check the thread author.
    let excluded = match user_id {
        Some(uid) => blocked_ids(&state.db, uid).await?,
        None => vec![],
    };

    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    if excluded.contains(&thread.author_id) {
        return Err(ApiError::NotFound("thread not found".into()));
    }

    // Fetch comments.
    let sort = comment_params.sort.as_deref().unwrap_or("best");
    let offset = comment_params.offset.unwrap_or(0);
    let limit = clamp_limit(comment_params.limit);

    let (comments, _comments_total) =
        CommentRepo::list_for_thread(&state.db, id, &excluded, sort, offset, limit)
            .await
            .map_err(db_err)?;

    // Collect all author IDs (thread + comments).
    let mut all_author_ids: HashSet<Uuid> = HashSet::new();
    all_author_ids.insert(thread.author_id);
    for c in &comments {
        all_author_ids.insert(c.author_id);
    }
    let author_ids_vec: Vec<Uuid> = all_author_ids.into_iter().collect();

    // Batch fetch authors and tags.
    let users = UserRepo::find_by_ids(&state.db, &author_ids_vec)
        .await
        .map_err(db_err)?;
    let tags = TagRepo::tags_for_thread(&state.db, id)
        .await
        .map_err(db_err)?;

    let authors = author_map(users);

    // Per-user vote/bookmark data for the thread + comments.
    let comment_ids: Vec<Uuid> = comments.iter().map(|c| c.id).collect();
    let (thread_vote, is_bookmarked, comment_vote_map): (Option<i16>, bool, HashMap<Uuid, i16>) =
        if let Some(uid) = user_id {
            let tv = VoteRepo::get_user_vote_for_thread(&state.db, id, uid)
                .await
                .map_err(db_err)?;
            let bm = BookmarkRepo::is_bookmarked(&state.db, uid, id)
                .await
                .map_err(db_err)?;
            let cv = VoteRepo::get_user_votes_for_comments(&state.db, &comment_ids, uid)
                .await
                .map_err(db_err)?;

            let cvm: HashMap<Uuid, i16> = cv.into_iter().map(|v| (v.comment_id, v.value)).collect();
            (tv, bm, cvm)
        } else {
            (None, false, HashMap::new())
        };

    let thread_author = authors
        .get(&thread.author_id)
        .cloned()
        .unwrap_or_else(deleted_author);

    let municipality_name = fetch_municipality_name(&state.db, thread.municipality_id).await?;

    let thread_resp = ThreadResponse {
        id: thread.id,
        title: thread.title,
        content: thread.content,
        content_html: thread.content_html,
        scope: thread.scope.parse().unwrap_or_else(|_| {
            warn!(thread_id = %thread.id, scope = %thread.scope, "unknown thread scope");
            ThreadScope::National
        }),
        author: thread_author,
        tags,
        reply_count: thread.reply_count,
        score: thread.score,
        view_count: thread.view_count,
        user_vote: thread_vote,
        is_bookmarked,
        is_pinned: thread.is_pinned,
        is_locked: thread.is_locked,
        source: thread.source.parse().unwrap_or_else(|_| {
            warn!(thread_id = %thread.id, source = %thread.source, "unknown thread source");
            ThreadSource::User
        }),
        source_url: thread.source_url,
        source_institution_id: thread.source_institution_id,
        ai_generated: thread.ai_generated,
        municipality_id: thread.municipality_id,
        municipality_name,
        institutional_context: thread.institutional_context,
        created_at: thread.created_at.to_rfc3339(),
        updated_at: thread.updated_at.to_rfc3339(),
    };

    let comment_resps: Vec<CommentResponse> = comments
        .into_iter()
        .map(|c| {
            let author = authors
                .get(&c.author_id)
                .cloned()
                .unwrap_or_else(deleted_author);
            CommentResponse {
                id: c.id,
                thread_id: c.thread_id,
                parent_id: c.parent_id,
                author,
                content: c.content,
                content_html: c.content_html,
                depth: c.depth,
                score: c.score,
                user_vote: comment_vote_map.get(&c.id).copied(),
                created_at: c.created_at.to_rfc3339(),
                updated_at: c.updated_at.to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(ThreadWithCommentsResponse {
        thread: thread_resp,
        comments: comment_resps,
    }))
}

pub async fn create_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<CreateThreadRequest>,
) -> Result<Json<ThreadResponse>, ApiError> {
    let scope = req
        .scope
        .ok_or_else(|| ApiError::BadRequest("scope is required".into()))?;

    // Public threads must use local/national/european — "club" scope is only
    // valid through the club thread creation endpoint.
    if scope == ThreadScope::Club {
        return Err(ApiError::BadRequest(
            "scope 'club' is not valid for public threads; use POST /clubs/{id}/threads".into(),
        ));
    }

    if req.title.trim().is_empty() {
        return Err(ApiError::BadRequest("title must not be empty".into()));
    }
    if req.content.trim().is_empty() {
        return Err(ApiError::BadRequest("content must not be empty".into()));
    }

    let resolved_location = match (
        req.location_id,
        req.location_osm_id,
        req.location_osm_type.as_deref(),
    ) {
        (Some(location_id), _, _) => Some(
            eulesia_db::entities::locations::Entity::find_by_id(location_id)
                .one(&*state.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| ApiError::BadRequest("location_id does not exist".into()))?,
        ),
        (None, Some(location_osm_id), Some(location_osm_type)) => Some(
            crate::locations::ensure_location_by_osm(&state.db, location_osm_type, location_osm_id)
                .await?,
        ),
        (None, Some(_), None) | (None, None, Some(_)) => {
            return Err(ApiError::BadRequest(
                "location_osm_id and location_osm_type must be provided together".into(),
            ));
        }
        (None, None, None) => None,
    };

    let municipality_id = resolve_municipality_id(
        &state.db,
        scope,
        req.municipality_id,
        resolved_location.as_ref(),
    )
    .await?;

    let scope_str = scope.to_string();
    let thread_id = new_id();
    let now = chrono::Utc::now().fixed_offset();

    let thread = ThreadRepo::create(
        &state.db,
        eulesia_db::entities::threads::ActiveModel {
            id: Set(thread_id),
            title: Set(req.title),
            content: Set(req.content),
            author_id: Set(auth.user_id.0),
            scope: Set(scope_str),
            municipality_id: Set(municipality_id),
            language: Set(req.language),
            country: Set(req.country),
            location_id: Set(resolved_location.as_ref().map(|location| location.id)),
            institutional_context: Set(req.institutional_context),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(db_err)?;

    // Add tags if provided.
    if let Some(ref tags) = req.tags {
        if !tags.is_empty() {
            TagRepo::add_tags(&state.db, thread_id, tags)
                .await
                .map_err(db_err)?;
        }
    }

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_created",
        serde_json::json!({
            "id": thread.id.to_string(),
            "title": thread.title,
            "content": thread.content,
            "author_id": thread.author_id.to_string(),
            "scope": thread.scope,
            "created_at": thread.created_at.timestamp(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_created event: {e}");
    }

    if let Some(location) = resolved_location {
        crate::locations::increment_location_content_count(&state.db, location.id, 1).await?;
    }

    // Fetch author for response.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let author = AuthorSummary {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role.parse().unwrap_or(UserRole::Citizen),
        institution_type: user.institution_type,
        institution_name: user.institution_name,
        identity_verified: user.identity_verified,
    };

    let municipality_name = fetch_municipality_name(&state.db, thread.municipality_id).await?;

    Ok(Json(ThreadResponse {
        id: thread.id,
        title: thread.title,
        content: thread.content,
        content_html: thread.content_html,
        scope: thread.scope.parse().unwrap_or_else(|_| {
            warn!(thread_id = %thread.id, scope = %thread.scope, "unknown thread scope");
            ThreadScope::National
        }),
        author,
        tags: req.tags.unwrap_or_default(),
        reply_count: thread.reply_count,
        score: thread.score,
        view_count: thread.view_count,
        user_vote: None,
        is_bookmarked: false,
        is_pinned: thread.is_pinned,
        is_locked: thread.is_locked,
        source: thread.source.parse().unwrap_or_else(|_| {
            warn!(thread_id = %thread.id, source = %thread.source, "unknown thread source");
            ThreadSource::User
        }),
        source_url: thread.source_url,
        source_institution_id: thread.source_institution_id,
        ai_generated: thread.ai_generated,
        municipality_id: thread.municipality_id,
        municipality_name,
        institutional_context: thread.institutional_context,
        created_at: thread.created_at.to_rfc3339(),
        updated_at: thread.updated_at.to_rfc3339(),
    }))
}

#[allow(clippy::too_many_lines)]
pub async fn update_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateThreadRequest>,
) -> Result<Json<ThreadResponse>, ApiError> {
    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    // Allow community editing for AI-generated / bot threads (e.g. Eulesia Summary).
    let is_bot_thread = thread.ai_generated || thread.source == "minutes_import";
    if thread.author_id != auth.user_id.0 && !is_bot_thread {
        return Err(ApiError::Forbidden);
    }

    // Save current state to edit_history before updating.
    {
        use eulesia_db::entities::edit_history;
        use sea_orm::ActiveModelTrait;

        edit_history::ActiveModel {
            id: Set(new_id()),
            content_type: Set("thread".into()),
            content_id: Set(thread.id),
            edited_by: Set(auth.user_id.0),
            previous_content: Set(thread.content.clone()),
            previous_content_html: Set(thread.content_html.clone()),
            previous_title: Set(Some(thread.title.clone())),
            edited_at: Set(chrono::Utc::now().fixed_offset()),
        }
        .insert(&*state.db)
        .await
        .map_err(|e| ApiError::Database(format!("save edit history: {e}")))?;
    }

    let now = chrono::Utc::now().fixed_offset();
    let mut am = eulesia_db::entities::threads::ActiveModel {
        id: Set(id),
        updated_at: Set(now),
        ..Default::default()
    };

    if let Some(title) = req.title {
        if title.trim().is_empty() {
            return Err(ApiError::BadRequest("title must not be empty".into()));
        }
        am.title = Set(title);
    }
    if let Some(content) = req.content {
        if content.trim().is_empty() {
            return Err(ApiError::BadRequest("content must not be empty".into()));
        }
        am.content = Set(content);
    }

    let updated = ThreadRepo::update(&state.db, am).await.map_err(db_err)?;

    // Sync tags if provided.
    let tags = if let Some(new_tags) = req.tags {
        TagRepo::remove_all_tags(&state.db, id)
            .await
            .map_err(db_err)?;
        if !new_tags.is_empty() {
            TagRepo::add_tags(&state.db, id, &new_tags)
                .await
                .map_err(db_err)?;
        }
        new_tags
    } else {
        TagRepo::tags_for_thread(&state.db, id)
            .await
            .map_err(db_err)?
    };

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_updated",
        serde_json::json!({
            "id": updated.id.to_string(),
            "title": updated.title,
            "content": updated.content,
            "author_id": updated.author_id.to_string(),
            "scope": updated.scope,
            "created_at": updated.created_at.timestamp(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_updated event: {e}");
    }

    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let author = AuthorSummary {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role.parse().unwrap_or(UserRole::Citizen),
        institution_type: user.institution_type,
        institution_name: user.institution_name,
        identity_verified: user.identity_verified,
    };

    let municipality_name = fetch_municipality_name(&state.db, updated.municipality_id).await?;

    Ok(Json(ThreadResponse {
        id: updated.id,
        title: updated.title,
        content: updated.content,
        content_html: updated.content_html,
        scope: updated.scope.parse().unwrap_or_else(|_| {
            warn!(thread_id = %updated.id, scope = %updated.scope, "unknown thread scope");
            ThreadScope::National
        }),
        author,
        tags,
        reply_count: updated.reply_count,
        score: updated.score,
        view_count: updated.view_count,
        user_vote: None,
        is_bookmarked: false,
        is_pinned: updated.is_pinned,
        is_locked: updated.is_locked,
        municipality_id: updated.municipality_id,
        municipality_name,
        institutional_context: updated.institutional_context,
        source: updated.source.parse().unwrap_or_else(|_| {
            warn!(thread_id = %updated.id, source = %updated.source, "unknown thread source");
            ThreadSource::User
        }),
        source_url: updated.source_url,
        source_institution_id: updated.source_institution_id,
        ai_generated: updated.ai_generated,
        created_at: updated.created_at.to_rfc3339(),
        updated_at: updated.updated_at.to_rfc3339(),
    }))
}

pub async fn delete_thread(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    let thread = ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    // Allow author or moderator.
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("user not found".into()))?;

    let role: UserRole = user
        .role
        .parse()
        .map_err(|e: String| ApiError::Internal(e))?;

    if thread.author_id != auth.user_id.0 && !role.is_moderator() {
        return Err(ApiError::Forbidden);
    }

    ThreadRepo::soft_delete(&state.db, id)
        .await
        .map_err(db_err)?;

    if thread.deleted_at.is_none() {
        if let Some(location_id) = thread.location_id {
            crate::locations::increment_location_content_count(&state.db, location_id, -1).await?;
        }
    }

    // Best-effort search index event
    if let Err(e) = emit_event(
        &*state.db,
        "thread_deleted",
        serde_json::json!({
            "id": id.to_string(),
        }),
    )
    .await
    {
        warn!("failed to emit thread_deleted event: {e}");
    }

    Ok(())
}

/// Record a thread view. Requires authentication to prevent anonymous
/// spam. View count is incremented at most once per user per thread
/// using a dedicated `thread_views` dedup table.
pub async fn record_view(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<(), ApiError> {
    ThreadRepo::find_by_id(&state.db, id)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::NotFound("thread not found".into()))?;

    let is_new = ThreadViewRepo::record_view(&state.db, id, auth.user_id.0)
        .await
        .map_err(db_err)?;

    if is_new {
        ThreadRepo::increment_view_count(&state.db, id)
            .await
            .map_err(db_err)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- validate_scope ----

    #[test]
    fn validate_scope_local() {
        assert!(validate_scope("local").is_ok());
    }

    #[test]
    fn validate_scope_national() {
        assert!(validate_scope("national").is_ok());
    }

    #[test]
    fn validate_scope_european() {
        assert!(validate_scope("european").is_ok());
    }

    #[test]
    fn validate_scope_invalid() {
        let err = validate_scope("global").unwrap_err();
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest, got {err:?}"
        );
    }

    #[test]
    fn validate_scope_empty() {
        let err = validate_scope("").unwrap_err();
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest, got {err:?}"
        );
    }

    // ---- clamp_limit ----

    #[test]
    fn clamp_none_uses_default() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
    }

    #[test]
    fn clamp_above_max() {
        assert_eq!(clamp_limit(Some(200)), MAX_LIMIT);
    }

    #[test]
    fn clamp_within_range() {
        assert_eq!(clamp_limit(Some(50)), 50);
    }

    #[test]
    fn clamp_zero() {
        assert_eq!(clamp_limit(Some(0)), 0);
    }

    #[test]
    fn clamp_boundary() {
        assert_eq!(clamp_limit(Some(MAX_LIMIT)), MAX_LIMIT);
    }

    // ---- deleted_author ----

    #[test]
    fn deleted_author_has_placeholder_values() {
        let author = deleted_author();
        assert_eq!(author.id, Uuid::nil());
        assert_eq!(author.username, "[deleted]");
        assert_eq!(author.name, "[deleted]");
        assert!(author.avatar_url.is_none());
        assert_eq!(author.role, UserRole::Citizen);
    }

    #[test]
    fn deleted_author_serializes() {
        let author = deleted_author();
        let json = serde_json::to_value(&author).unwrap();
        let obj = json.as_object().unwrap();
        assert_eq!(obj["username"], "[deleted]");
        assert_eq!(obj["name"], "[deleted]");
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("avatarUrl"));
        assert!(obj.contains_key("role"));
    }

    // ---- author_map ----

    #[test]
    fn author_map_empty() {
        let map = author_map(vec![]);
        assert!(map.is_empty());
    }

    #[test]
    fn author_map_builds_lookup() {
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        let now = chrono::Utc::now().fixed_offset();

        let users = vec![
            eulesia_db::entities::users::Model {
                id: id1,
                username: "alice".into(),
                name: "Alice".into(),
                avatar_url: Some("https://example.com/alice.png".into()),
                role: "citizen".into(),
                email: Some("alice@example.com".into()),
                password_hash: Some(String::new()),
                municipality_id: None,
                bio: None,
                institution_type: None,
                institution_name: None,
                identity_verified: false,
                identity_provider: None,
                identity_level: "none".into(),
                identity_issuer: None,
                identity_verified_at: None,
                verified_name: None,
                rp_subject: None,
                locale: "fi".into(),
                notification_replies: true,
                notification_mentions: true,
                notification_official: true,
                onboarding_completed_at: None,
                deleted_at: None,
                created_at: now,
                updated_at: now,
                last_seen_at: None,
            },
            eulesia_db::entities::users::Model {
                id: id2,
                username: "bob".into(),
                name: "Bob".into(),
                avatar_url: None,
                role: "moderator".into(),
                email: Some("bob@example.com".into()),
                password_hash: Some(String::new()),
                municipality_id: None,
                bio: None,
                institution_type: None,
                institution_name: None,
                identity_verified: false,
                identity_provider: None,
                identity_level: "none".into(),
                identity_issuer: None,
                identity_verified_at: None,
                verified_name: None,
                rp_subject: None,
                locale: "fi".into(),
                notification_replies: true,
                notification_mentions: true,
                notification_official: true,
                onboarding_completed_at: None,
                deleted_at: None,
                created_at: now,
                updated_at: now,
                last_seen_at: None,
            },
        ];

        let map = author_map(users);
        assert_eq!(map.len(), 2);

        let alice = map.get(&id1).expect("alice should be in map");
        assert_eq!(alice.username, "alice");
        assert_eq!(alice.name, "Alice");
        assert_eq!(
            alice.avatar_url.as_deref(),
            Some("https://example.com/alice.png")
        );
        assert_eq!(alice.role, UserRole::Citizen);

        let bob = map.get(&id2).expect("bob should be in map");
        assert_eq!(bob.username, "bob");
        assert_eq!(bob.role, UserRole::Moderator);
        assert!(bob.avatar_url.is_none());
    }
}
