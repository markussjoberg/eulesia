#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use uuid::Uuid;

    use crate::entities::threads;
    use crate::repo::threads::ThreadRepo;

    fn now() -> sea_orm::prelude::DateTimeWithTimeZone {
        chrono::Utc::now().fixed_offset()
    }

    fn make_thread(id: Uuid, title: &str, author_id: Uuid) -> threads::Model {
        threads::Model {
            id,
            title: title.to_string(),
            content: format!("Content for {title}"),
            content_html: None,
            author_id,
            scope: "national".to_string(),
            country: Some("FI".to_string()),
            municipality_id: None,
            location_id: None,
            place_id: None,
            latitude: None,
            longitude: None,
            institutional_context: None,
            is_pinned: false,
            is_locked: false,
            reply_count: 0,
            score: 0,
            view_count: 0,
            source: "user".to_string(),
            source_url: None,
            source_id: None,
            source_institution_id: None,
            ai_generated: false,
            ai_model: None,
            language: Some("en".to_string()),
            is_hidden: false,
            club_id: None,
            deleted_at: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn count_result(n: i64) -> BTreeMap<String, Value> {
        BTreeMap::from([("num_items".to_string(), Value::BigInt(Some(n)))])
    }

    // ── find_by_id ──

    #[tokio::test]
    async fn find_by_id_returns_thread() {
        let id = Uuid::now_v7();
        let thread = make_thread(id, "Test Thread", Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[thread.clone()]])
            .into_connection();

        let result = ThreadRepo::find_by_id(&db, id).await.unwrap();
        assert_eq!(result.unwrap().title, "Test Thread");
    }

    #[tokio::test]
    async fn find_by_id_returns_none_when_missing() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let result = ThreadRepo::find_by_id(&db, Uuid::now_v7()).await.unwrap();
        assert!(result.is_none());
    }

    // ── list ──

    #[tokio::test]
    async fn list_returns_threads_with_total() {
        let author = Uuid::now_v7();
        let t1 = make_thread(Uuid::now_v7(), "Thread One", author);
        let t2 = make_thread(Uuid::now_v7(), "Thread Two", author);

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(2)]])
            .append_query_results([vec![t1.clone(), t2.clone()]])
            .into_connection();

        let (items, total) =
            ThreadRepo::list(&db, None, None, None, None, &[], "recent", None, 0, 20, false)
                .await
                .unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(total, 2);
        assert_eq!(items[0].title, "Thread One");
    }

    #[tokio::test]
    async fn list_empty() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (items, total) =
            ThreadRepo::list(&db, None, None, None, None, &[], "recent", None, 0, 20, false)
                .await
                .unwrap();

        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    // ── list sort variants ──

    #[tokio::test]
    async fn list_with_sort_new() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (items, total) = ThreadRepo::list(&db, None, None, None, None, &[], "new", None, 0, 20, false)
            .await
            .unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn list_with_sort_top() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (items, total) = ThreadRepo::list(&db, None, None, None, None, &[], "top", None, 0, 20, false)
            .await
            .unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn list_with_sort_active() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (items, total) =
            ThreadRepo::list(&db, None, None, None, None, &[], "active", None, 0, 20, false)
                .await
                .unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn list_with_top_period_day() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (items, total) =
            ThreadRepo::list(&db, None, None, None, None, &[], "top", Some("day"), 0, 20, false)
                .await
                .unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn list_with_top_period_week() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (_, _) = ThreadRepo::list(
            &db,
            None,
            None,
            None,
            None,
            &[],
            "top",
            Some("week"),
            0,
            20,
            false,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_with_top_period_month() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (_, _) = ThreadRepo::list(
            &db,
            None,
            None,
            None,
            None,
            &[],
            "top",
            Some("month"),
            0,
            20,
            false,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_with_top_period_year() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        let (_, _) = ThreadRepo::list(
            &db,
            None,
            None,
            None,
            None,
            &[],
            "top",
            Some("year"),
            0,
            20,
            false,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_with_top_period_all() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        // "all" means no cutoff filter — same query as top without period
        let (_, _) = ThreadRepo::list(
            &db,
            None,
            None,
            None,
            None,
            &[],
            "top",
            Some("all"),
            0,
            20,
            false,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_top_period_ignored_for_non_top_sort() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[count_result(0)]])
            .append_query_results([Vec::<threads::Model>::new()])
            .into_connection();

        // top_period should be ignored when sort != "top"
        let (_, _) = ThreadRepo::list(
            &db,
            None,
            None,
            None,
            None,
            &[],
            "recent",
            Some("day"),
            0,
            20,
            false,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_empty_thread_ids_returns_empty() {
        // When thread_ids is Some(&[]) (empty slice), should short-circuit
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();

        let (items, total) =
            ThreadRepo::list(
                &db,
                None,
                None,
                None,
                Some(&[]),
                &[],
                "recent",
                None,
                0,
                20,
                false,
            )
                .await
                .unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    // ── create ──

    #[tokio::test]
    async fn create_returns_thread() {
        let thread = make_thread(Uuid::now_v7(), "New Thread", Uuid::now_v7());

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([[thread.clone()]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let active: threads::ActiveModel = thread.clone().into();
        let result = ThreadRepo::create(&db, active).await.unwrap();
        assert_eq!(result.title, "New Thread");
    }

    // ── soft_delete ──

    #[tokio::test]
    async fn soft_delete_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = ThreadRepo::soft_delete(&db, Uuid::now_v7()).await;
        assert!(result.is_ok());
    }

    // ── increment_view_count ──

    #[tokio::test]
    async fn increment_view_count_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = ThreadRepo::increment_view_count(&db, Uuid::now_v7()).await;
        assert!(result.is_ok());
    }

    // ── increment_reply_count ──

    #[tokio::test]
    async fn increment_reply_count_succeeds() {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let result = ThreadRepo::increment_reply_count(&db, Uuid::now_v7(), 1).await;
        assert!(result.is_ok());
    }
}
