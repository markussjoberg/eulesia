use std::path::PathBuf;

use axum::Json;
use axum::Router;
use axum::extract::{Multipart, State};
use axum::routing::post;
use image::imageops::FilterType;
use image::{DynamicImage, ImageReader};
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde::Serialize;
use tokio::fs;
use tracing::{error, warn};
use uuid::Uuid;

use crate::AppState;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_db::repo::users::UserRepo;

const MAX_FILE_SIZE: usize = 10 * 1024 * 1024; // 10 MB

// Wide format support — anything the `image` crate can decode
const ALLOWED_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/avif",
    // Some browsers send these
    "image/jpg",
    "image/x-png",
];

// Size limits
const MAIN_MAX_WIDTH: u32 = 1920;
const MAIN_MAX_HEIGHT: u32 = 1920;
const THUMB_WIDTH: u32 = 400;
const THUMB_HEIGHT: u32 = 300;
const AVATAR_SIZE: u32 = 400; // retina-ready (displayed at 200)

fn upload_dir() -> PathBuf {
    PathBuf::from(std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()))
}

fn file_name(user_id: Uuid) -> String {
    format!(
        "{}_{}.webp",
        &user_id.to_string()[..8],
        chrono::Utc::now().timestamp_millis()
    )
}

/// Encode a `DynamicImage` as lossy WebP via libwebp.
///
/// Quality 0–100. At 80, a typical 8MB phone JPEG becomes ~150-300KB.
fn encode_lossy_webp(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, ApiError> {
    let encoder = webp::Encoder::from_image(img)
        .map_err(|e| ApiError::Internal(format!("WebP encoder init: {e}")))?;
    let mem = encoder.encode(quality);
    Ok(mem.to_vec())
}

/// Decode image bytes (any supported format) on a blocking thread.
async fn decode_image(data: Vec<u8>) -> Result<DynamicImage, ApiError> {
    tokio::task::spawn_blocking(move || {
        let reader = ImageReader::new(std::io::Cursor::new(&data))
            .with_guessed_format()
            .map_err(|e| ApiError::BadRequest(format!("unrecognised image format: {e}")))?;
        reader
            .decode()
            .map_err(|e| ApiError::BadRequest(format!("invalid image: {e}")))
    })
    .await
    .map_err(|_| ApiError::Internal("image decode task failed".into()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarResponse {
    avatar_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageResponse {
    url: String,
    thumbnail_url: String,
    width: u32,
    height: u32,
}

/// Extract the first file field from a multipart upload.
async fn extract_file(mut multipart: Multipart) -> Result<(String, Vec<u8>), ApiError> {
    if let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("read upload: {e}")))?
    {
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        if !ALLOWED_TYPES.contains(&content_type.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "unsupported file type: {content_type}. Supported: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF"
            )));
        }

        let data = field
            .bytes()
            .await
            .map_err(|e| ApiError::BadRequest(format!("read upload: {e}")))?;

        if data.len() > MAX_FILE_SIZE {
            return Err(ApiError::BadRequest("file too large (max 10 MB)".into()));
        }

        return Ok((content_type, data.to_vec()));
    }

    Err(ApiError::BadRequest("no file uploaded".into()))
}

/// POST /uploads/avatar — upload avatar image.
async fn upload_avatar(
    auth: AuthUser,
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<Json<AvatarResponse>, ApiError> {
    use eulesia_db::entities::users;

    let (_content_type, data) = extract_file(multipart).await?;

    // Decode + resize + encode on blocking thread
    let buf = tokio::task::spawn_blocking(move || {
        let img = ImageReader::new(std::io::Cursor::new(&data))
            .with_guessed_format()
            .map_err(|e| ApiError::BadRequest(format!("unrecognised format: {e}")))?
            .decode()
            .map_err(|e| ApiError::BadRequest(format!("invalid image: {e}")))?;

        let img = img.resize_to_fill(AVATAR_SIZE, AVATAR_SIZE, FilterType::Lanczos3);
        encode_lossy_webp(&img, 80.0)
    })
    .await
    .map_err(|_| ApiError::Internal("avatar processing task failed".into()))??;

    let dir = upload_dir().join("avatars");
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::Internal(format!("create upload dir: {e}")))?;

    let name = file_name(auth.user_id.0);
    let path = dir.join(&name);

    fs::write(&path, &buf)
        .await
        .map_err(|e| ApiError::Internal(format!("write avatar: {e}")))?;

    let api_url = std::env::var("API_URL").unwrap_or_else(|_| "http://localhost:3001".into());
    let avatar_url = format!("{api_url}/uploads/avatars/{name}");

    // Delete old avatar file if it exists
    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Unauthorized)?;

    if let Some(ref old_url) = user.avatar_url {
        if let Some(old_name) = old_url.rsplit('/').next() {
            let old_path = upload_dir().join("avatars").join(old_name);
            if let Err(e) = fs::remove_file(&old_path).await {
                warn!(error = %e, "failed to delete old avatar");
            }
        }
    }

    // Update user avatar_url
    let mut am: users::ActiveModel = user.into();
    am.avatar_url = Set(Some(avatar_url.clone()));
    am.updated_at = Set(chrono::Utc::now().fixed_offset());
    am.update(&*state.db)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(AvatarResponse { avatar_url }))
}

/// DELETE /uploads/avatar — remove avatar.
async fn delete_avatar(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    use eulesia_db::entities::users;

    let user = UserRepo::find_by_id(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Unauthorized)?;

    if let Some(ref old_url) = user.avatar_url {
        if let Some(old_name) = old_url.rsplit('/').next() {
            let old_path = upload_dir().join("avatars").join(old_name);
            if let Err(e) = fs::remove_file(&old_path).await {
                warn!(error = %e, "failed to delete old avatar file");
            }
        }
    }

    let mut am: users::ActiveModel = user.into();
    am.avatar_url = Set(None);
    am.updated_at = Set(chrono::Utc::now().fixed_offset());
    am.update(&*state.db)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// POST /uploads/image — upload content image.
async fn upload_image(
    auth: AuthUser,
    State(_state): State<AppState>,
    multipart: Multipart,
) -> Result<Json<ImageResponse>, ApiError> {
    let user_id = auth.user_id.0;
    let (content_type, data) = extract_file(multipart).await.inspect_err(|e| {
        error!(user_id = %user_id, error = %e, "upload_image: extract_file failed");
    })?;
    let data_len = data.len();

    // Decode on blocking thread
    let img = decode_image(data).await.inspect_err(|e| {
        error!(
            user_id = %user_id,
            content_type = %content_type,
            bytes = data_len,
            error = %e,
            "upload_image: decode_image failed"
        );
    })?;

    // Resize + encode main image and thumbnail on blocking thread
    let (main_buf, thumb_buf, width, height) = tokio::task::spawn_blocking(move || {
        // Main: fit within max dimensions, preserve aspect ratio
        let main_img = img.resize(MAIN_MAX_WIDTH, MAIN_MAX_HEIGHT, FilterType::Lanczos3);
        let w = main_img.width();
        let h = main_img.height();
        let main_buf = encode_lossy_webp(&main_img, 82.0)?;

        // Thumbnail: cover crop
        let thumb_img = img.resize_to_fill(THUMB_WIDTH, THUMB_HEIGHT, FilterType::Lanczos3);
        let thumb_buf = encode_lossy_webp(&thumb_img, 75.0)?;

        Ok::<_, ApiError>((main_buf, thumb_buf, w, h))
    })
    .await
    .map_err(|e| {
        error!(user_id = %user_id, error = %e, "upload_image: blocking encode task panicked");
        ApiError::Internal("image processing task failed".into())
    })?
    .inspect_err(|e| {
        error!(user_id = %user_id, error = %e, "upload_image: encode failed");
    })?;

    let images_dir = upload_dir().join("images");
    let thumbs_dir = upload_dir().join("thumbnails");
    fs::create_dir_all(&images_dir).await.map_err(|e| {
        error!(
            user_id = %user_id,
            dir = %images_dir.display(),
            error = %e,
            "upload_image: create images dir failed"
        );
        ApiError::Internal(format!("create upload dir: {e}"))
    })?;
    fs::create_dir_all(&thumbs_dir).await.map_err(|e| {
        error!(
            user_id = %user_id,
            dir = %thumbs_dir.display(),
            error = %e,
            "upload_image: create thumbnails dir failed"
        );
        ApiError::Internal(format!("create upload dir: {e}"))
    })?;

    let name = file_name(user_id);
    let image_path = images_dir.join(&name);
    let thumb_path = thumbs_dir.join(&name);

    fs::write(&image_path, &main_buf).await.map_err(|e| {
        error!(
            user_id = %user_id,
            path = %image_path.display(),
            error = %e,
            "upload_image: write main image failed"
        );
        ApiError::Internal(format!("write image: {e}"))
    })?;
    fs::write(&thumb_path, &thumb_buf).await.map_err(|e| {
        error!(
            user_id = %user_id,
            path = %thumb_path.display(),
            error = %e,
            "upload_image: write thumbnail failed"
        );
        ApiError::Internal(format!("write thumbnail: {e}"))
    })?;

    let api_url = std::env::var("API_URL").unwrap_or_else(|_| "http://localhost:3001".into());

    Ok(Json(ImageResponse {
        url: format!("{api_url}/uploads/images/{name}"),
        thumbnail_url: format!("{api_url}/uploads/thumbnails/{name}"),
        width,
        height,
    }))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/uploads/avatar", post(upload_avatar).delete(delete_avatar))
        .route("/uploads/image", post(upload_image))
        .layer(axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024))
}
