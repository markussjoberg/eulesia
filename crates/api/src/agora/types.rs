use eulesia_common::types::{ThreadScope, ThreadSource, UserRole};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadRequest {
    pub title: Option<String>,
    pub content: String,
    pub scope: Option<ThreadScope>,
    pub municipality_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    pub language: Option<String>,
    pub country: Option<String>,
    pub location_id: Option<Uuid>,
    pub location_osm_id: Option<i64>,
    pub location_osm_type: Option<String>,
    pub institutional_context: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadRequest {
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListParams {
    #[serde(alias = "feedScope")]
    pub scope: Option<String>,
    pub municipality_id: Option<Uuid>,
    #[serde(alias = "tags")]
    pub tag: Option<String>,
    #[serde(alias = "sortBy")]
    pub sort: Option<String>,
    pub top_period: Option<String>,
    pub page: Option<u64>,
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentRequest {
    pub content: String,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCommentRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub value: i16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentListParams {
    pub sort: Option<String>,
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ThreadResponse {
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub content_html: Option<String>,
    pub scope: ThreadScope,
    pub author: AuthorSummary,
    pub tags: Vec<String>,
    pub municipality_id: Option<Uuid>,
    pub municipality_name: Option<String>,
    pub institutional_context: Option<serde_json::Value>,
    pub reply_count: i32,
    pub score: i32,
    pub view_count: i32,
    pub user_vote: Option<i16>,
    pub is_bookmarked: bool,
    pub is_pinned: bool,
    pub is_locked: bool,
    pub source: ThreadSource,
    pub source_url: Option<String>,
    pub source_institution_id: Option<Uuid>,
    pub ai_generated: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ThreadWithCommentsResponse {
    #[serde(flatten)]
    pub thread: ThreadResponse,
    pub comments: Vec<CommentResponse>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResponse {
    #[serde(rename = "items")]
    pub data: Vec<ThreadResponse>,
    pub total: u64,
    pub page: u64,
    pub limit: u64,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_scope: Option<String>,
    pub has_subscriptions: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub author: AuthorSummary,
    pub content: String,
    pub content_html: Option<String>,
    pub depth: i32,
    pub score: i32,
    pub user_vote: Option<i16>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AuthorSummary {
    pub id: Uuid,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub role: UserRole,
    pub institution_type: Option<String>,
    pub institution_name: Option<String>,
    pub identity_verified: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TagWithCount {
    pub tag: String,
    pub count: i64,
    pub display_name: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct VoteResponse {
    pub score: i32,
    pub user_vote: i16,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_author() -> AuthorSummary {
        AuthorSummary {
            id: Uuid::nil(),
            username: "testuser".into(),
            name: "Test User".into(),
            avatar_url: Some("https://example.com/avatar.png".into()),
            role: UserRole::Citizen,
            institution_type: None,
            institution_name: None,
            identity_verified: false,
        }
    }

    fn sample_thread() -> ThreadResponse {
        ThreadResponse {
            id: Uuid::nil(),
            title: "Test thread".into(),
            content: "Some content".into(),
            content_html: Some("<p>Some content</p>".into()),
            scope: ThreadScope::National,
            author: sample_author(),
            tags: vec!["politics".into()],
            municipality_id: None,
            municipality_name: None,
            institutional_context: None,
            reply_count: 3,
            score: 12,
            view_count: 42,
            user_vote: Some(1),
            is_bookmarked: true,
            is_pinned: false,
            is_locked: false,
            source: ThreadSource::User,
            source_url: None,
            source_institution_id: None,
            ai_generated: false,
            created_at: "2026-01-01T00:00:00+00:00".into(),
            updated_at: "2026-01-02T00:00:00+00:00".into(),
        }
    }

    fn sample_comment() -> CommentResponse {
        CommentResponse {
            id: Uuid::nil(),
            thread_id: Uuid::nil(),
            parent_id: None,
            author: sample_author(),
            content: "A comment".into(),
            content_html: Some("<p>A comment</p>".into()),
            depth: 0,
            score: 5,
            user_vote: None,
            created_at: "2026-01-01T12:00:00+00:00".into(),
            updated_at: "2026-01-01T12:00:00+00:00".into(),
        }
    }

    /// Contract test: ThreadWithCommentsResponse serializes to the flat
    /// camelCase shape the frontend expects (ThreadWithComments extends Thread).
    #[test]
    fn thread_with_comments_matches_frontend_contract() {
        let resp = ThreadWithCommentsResponse {
            thread: sample_thread(),
            comments: vec![sample_comment()],
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().expect("response must be a JSON object");

        // Thread fields are flat at top level (not nested under "thread")
        let thread_keys = [
            "id",
            "title",
            "content",
            "contentHtml",
            "scope",
            "author",
            "tags",
            "replyCount",
            "score",
            "viewCount",
            "userVote",
            "isBookmarked",
            "isPinned",
            "isLocked",
            "createdAt",
            "updatedAt",
        ];
        for key in &thread_keys {
            assert!(obj.contains_key(*key), "missing thread field: {key}");
        }
        assert!(
            !obj.contains_key("thread"),
            "thread must be flattened, not nested"
        );

        // Comments array
        assert!(obj.contains_key("comments"), "missing comments array");
        let comments = obj["comments"].as_array().expect("comments must be array");
        assert_eq!(comments.len(), 1);

        // Comment shape
        let c = comments[0].as_object().expect("comment must be object");
        let comment_keys = [
            "id",
            "threadId",
            "parentId",
            "author",
            "content",
            "contentHtml",
            "depth",
            "score",
            "userVote",
            "createdAt",
            "updatedAt",
        ];
        for key in &comment_keys {
            assert!(c.contains_key(*key), "missing comment field: {key}");
        }

        // Author shape (on both thread and comment)
        let author_keys = ["id", "username", "name", "avatarUrl", "role"];
        for src in [&obj["author"], &c["author"]] {
            let a = src.as_object().expect("author must be object");
            for key in &author_keys {
                assert!(a.contains_key(*key), "missing author field: {key}");
            }
        }
    }

    /// Contract test: ThreadListResponse has page-based pagination fields
    /// the frontend needs for infinite scroll.
    #[test]
    fn thread_list_response_matches_frontend_contract() {
        let resp = ThreadListResponse {
            data: vec![sample_thread()],
            total: 42,
            page: 2,
            limit: 20,
            has_more: true,
            feed_scope: Some("national".into()),
            has_subscriptions: true,
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().unwrap();

        // Must use "items" key (not "data") per serde rename
        assert!(obj.contains_key("items"), "must use 'items' key");
        assert!(!obj.contains_key("data"), "must not have 'data' key");
        assert!(obj["items"].as_array().unwrap().len() == 1);

        // Pagination fields
        assert_eq!(obj["total"], 42);
        assert_eq!(obj["page"], 2);
        assert_eq!(obj["limit"], 20);
        assert_eq!(obj["hasMore"], true);
        assert_eq!(obj["feedScope"], "national");
        assert_eq!(obj["hasSubscriptions"], true);

        // No legacy "offset" field
        assert!(!obj.contains_key("offset"), "must not have legacy 'offset'");
    }

    /// feedScope is omitted when None (skip_serializing_if).
    #[test]
    fn thread_list_response_omits_null_feed_scope() {
        let resp = ThreadListResponse {
            data: vec![],
            total: 0,
            page: 1,
            limit: 20,
            has_more: false,
            feed_scope: None,
            has_subscriptions: false,
        };

        let json = serde_json::to_value(&resp).unwrap();
        let obj = json.as_object().unwrap();
        assert!(
            !obj.contains_key("feedScope"),
            "feedScope must be omitted when None"
        );
    }

    /// Contract test: TagWithCount has the enriched fields Topics page needs.
    #[test]
    fn tag_with_count_matches_frontend_contract() {
        let tag = TagWithCount {
            tag: "politics".into(),
            count: 15,
            display_name: "Politics".into(),
            category: Some("society".into()),
            description: Some("Political discussions".into()),
            scope: Some("national".into()),
        };

        let json = serde_json::to_value(&tag).unwrap();
        let obj = json.as_object().unwrap();

        let required_keys = [
            "tag",
            "count",
            "displayName",
            "category",
            "description",
            "scope",
        ];
        for key in &required_keys {
            assert!(obj.contains_key(*key), "missing tag field: {key}");
        }

        assert_eq!(obj["displayName"], "Politics");
    }

    /// Verify CreateThreadRequest deserializes with scope=None.
    #[test]
    fn create_thread_request_scope_optional() {
        let json = r#"{"title":"Hello","content":"World"}"#;
        let req: CreateThreadRequest = serde_json::from_str(json).unwrap();
        assert!(req.scope.is_none());
        assert_eq!(req.title, Some("Hello".into()));
    }

    /// Verify CreateThreadRequest works without title (title-less post).
    #[test]
    fn create_thread_request_title_optional() {
        let json = r#"{"content":"Just some content without a title"}"#;
        let req: CreateThreadRequest = serde_json::from_str(json).unwrap();
        assert!(req.title.is_none());
        assert_eq!(req.content, "Just some content without a title");
    }

    /// Verify CreateThreadRequest still accepts explicit scope.
    #[test]
    fn create_thread_request_with_scope() {
        let json = r#"{"title":"Hello","content":"World","scope":"national"}"#;
        let req: CreateThreadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.scope, Some(ThreadScope::National));
    }

    /// Verify ThreadListParams accepts page param.
    #[test]
    fn thread_list_params_accepts_page() {
        let json = r#"{"page":3,"limit":20,"sortBy":"top","topPeriod":"week"}"#;
        let params: ThreadListParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.page, Some(3));
        assert_eq!(params.sort.as_deref(), Some("top"));
        assert_eq!(params.top_period.as_deref(), Some("week"));
    }

    /// Verify ThreadListParams still accepts offset for backwards compat.
    #[test]
    fn thread_list_params_accepts_offset() {
        let json = r#"{"offset":40,"limit":20}"#;
        let params: ThreadListParams = serde_json::from_str(json).unwrap();
        assert_eq!(params.offset, Some(40));
        assert!(params.page.is_none());
    }
}
