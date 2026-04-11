use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http_body_util::BodyExt;
use serde_json::Value;

/// Middleware that wraps JSON responses in the format the frontend expects:
///
/// - 2xx: `{ "success": true, "data": <original_body> }`
/// - 4xx/5xx: `{ "success": false, "error": <error_message> }`
///
/// Preserves all original headers (Set-Cookie, etc.) and skips non-JSON
/// responses and health endpoints.
pub async fn wrap_response(req: Request<Body>, next: Next) -> Response {
    // Skip wrapping for health endpoints and the ServeDir `/uploads/*` path.
    // The check is `starts_with("/uploads/")`, NOT `contains`, so we only
    // skip the top-level static file route — the API upload endpoints live
    // at `/api/v1/uploads/*` and MUST be wrapped in the `{success, data}`
    // envelope that the frontend expects.
    let path = req.uri().path();
    let skip =
        path.ends_with("/health") || path.ends_with("/ready") || path.starts_with("/uploads/");

    let response = next.run(req).await;

    if skip {
        return response;
    }

    let status = response.status();

    let is_json = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with("application/json"));

    // Non-JSON success with a real body (e.g. binary uploads) — pass through.
    // Empty-body successes (unit `()` returns) are wrapped below so the
    // frontend always receives `{ "success": true, "data": null }`.
    let has_body = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .is_some_and(|len| len > 0);
    if !is_json && has_body && status.is_success() {
        return response;
    }

    // Preserve original headers (Set-Cookie, cache-control, etc.).
    let (mut parts, body) = response.into_parts();
    let bytes = match body.collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let wrapped = if status.is_success() {
        // JSON success — wrap in envelope.
        let data: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        serde_json::json!({ "success": true, "data": data })
    } else if is_json {
        // JSON error — extract error message.
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let error = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        serde_json::json!({ "success": false, "error": error })
    } else {
        // Non-JSON error (e.g. axum extractor rejection, plain text 422/404)
        // — wrap the raw text in the JSON envelope so the frontend never
        //   gets a non-JSON error body from /api/*.
        let text = String::from_utf8_lossy(&bytes);
        let error = if text.is_empty() {
            status.canonical_reason().unwrap_or("request failed")
        } else {
            &text
        };
        serde_json::json!({ "success": false, "error": error })
    };

    let json_bytes = serde_json::to_vec(&wrapped).unwrap_or_default();

    // Replace body but keep all original headers (including Set-Cookie).
    parts.headers.insert(
        "content-type",
        "application/json"
            .parse()
            .expect("valid content-type header"),
    );
    parts.headers.insert(
        "content-length",
        json_bytes
            .len()
            .to_string()
            .parse()
            .expect("valid content-length"),
    );

    Response::from_parts(parts, Body::from(json_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::middleware::{self};
    use axum::routing::get;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    /// Empty `()` response gets wrapped as {success:true, data:null}.
    #[tokio::test]
    async fn wraps_empty_body_as_json_null() {
        let app = Router::new()
            .route("/test", get(|| async {}))
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/json"
        );

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert!(json["data"].is_null());
    }

    /// JSON success response gets wrapped in {success:true, data:...}.
    #[tokio::test]
    async fn wraps_json_success() {
        let app = Router::new()
            .route(
                "/test",
                get(|| async { axum::Json(serde_json::json!({"foo": "bar"})) }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["foo"], "bar");
    }

    /// Health endpoint is NOT wrapped (skip list).
    #[tokio::test]
    async fn skips_health_endpoint() {
        let app = Router::new()
            .route(
                "/health",
                get(|| async { axum::Json(serde_json::json!({"status": "ok"})) }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // Not wrapped — raw JSON
        assert_eq!(json["status"], "ok");
        assert!(!json.as_object().unwrap().contains_key("success"));
    }

    /// JSON error response with an "error" field is wrapped as {success:false, error:"..."}.
    #[tokio::test]
    async fn wraps_json_error_with_error_field() {
        let app = Router::new()
            .route(
                "/test",
                get(|| async {
                    (
                        StatusCode::BAD_REQUEST,
                        axum::Json(serde_json::json!({"error": "bad input"})),
                    )
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"], "bad input");
        assert!(!json.as_object().unwrap().contains_key("data"));
    }

    /// Plain-text error body is wrapped as {success:false, error:"<text>"}.
    #[tokio::test]
    async fn wraps_non_json_error_as_text() {
        let app = Router::new()
            .route(
                "/test",
                get(|| async { (StatusCode::UNPROCESSABLE_ENTITY, "missing required field") }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"], "missing required field");
    }

    /// Binary response (image/png with content-length) passes through unwrapped.
    #[tokio::test]
    async fn passes_through_binary_upload() {
        let png_bytes: &[u8] = &[0x89, 0x50, 0x4E, 0x47]; // PNG magic bytes

        let app = Router::new()
            .route(
                "/test",
                get(|| async {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "image/png")
                        .header("content-length", "4")
                        .body(Body::from(png_bytes.to_vec()))
                        .unwrap()
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("content-type").unwrap(), "image/png",);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        // Should be the raw bytes, not JSON-wrapped.
        assert_eq!(&body[..], png_bytes);
    }

    /// /ready endpoint is NOT wrapped (skip list).
    #[tokio::test]
    async fn skips_ready_endpoint() {
        let app = Router::new()
            .route(
                "/ready",
                get(|| async { axum::Json(serde_json::json!({"status": "ready"})) }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/ready").body(Body::empty()).unwrap())
            .await
            .unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ready");
        assert!(!json.as_object().unwrap().contains_key("success"));
    }

    /// The API upload endpoint at `/api/v1/uploads/image` IS wrapped — the
    /// skip list only covers the top-level ServeDir path `/uploads/*`, not
    /// the API route that happens to include the word "uploads" inside it.
    ///
    /// Regression test for the bug where `path.contains("/uploads/")` also
    /// skipped `/api/v1/uploads/image`, causing the frontend to see a raw
    /// `{url, thumbnailUrl, ...}` body that failed the `success` check.
    #[tokio::test]
    async fn wraps_api_upload_endpoint() {
        let app = Router::new()
            .route(
                "/api/v1/uploads/image",
                get(|| async {
                    axum::Json(serde_json::json!({
                        "url": "http://example/uploads/images/foo.webp",
                        "thumbnailUrl": "http://example/uploads/thumbnails/foo.webp",
                        "width": 800,
                        "height": 600,
                    }))
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(
                Request::get("/api/v1/uploads/image")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // Must be wrapped — the frontend checks `data.success`.
        assert_eq!(json["success"], true);
        assert_eq!(
            json["data"]["url"],
            "http://example/uploads/images/foo.webp"
        );
        assert_eq!(json["data"]["width"], 800);
    }

    /// /uploads/ paths are NOT wrapped (skip list).
    #[tokio::test]
    async fn skips_uploads_path() {
        let app = Router::new()
            .route(
                "/uploads/{filename}",
                get(|| async {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "image/jpeg")
                        .header("content-length", "3")
                        .body(Body::from(vec![0xFF, 0xD8, 0xFF]))
                        .unwrap()
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(
                Request::get("/uploads/avatar.jpg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("content-type").unwrap(), "image/jpeg",);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        // Raw bytes, not wrapped.
        assert_eq!(&body[..], &[0xFF, 0xD8, 0xFF]);
    }

    /// Error status code is preserved after wrapping.
    #[tokio::test]
    async fn preserves_status_code() {
        let app = Router::new()
            .route(
                "/test",
                get(|| async {
                    (
                        StatusCode::BAD_REQUEST,
                        axum::Json(serde_json::json!({"error": "nope"})),
                    )
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
    }

    /// Set-Cookie header survives wrapping.
    #[tokio::test]
    async fn preserves_set_cookie_header() {
        let app = Router::new()
            .route(
                "/test",
                get(|| async {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "application/json")
                        .header("set-cookie", "session=abc123; Path=/; HttpOnly")
                        .body(Body::from(
                            serde_json::to_vec(&serde_json::json!({"id": 1})).unwrap(),
                        ))
                        .unwrap()
                }),
            )
            .layer(middleware::from_fn(wrap_response));

        let resp = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("set-cookie").unwrap(),
            "session=abc123; Path=/; HttpOnly",
        );

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["id"], 1);
    }
}
