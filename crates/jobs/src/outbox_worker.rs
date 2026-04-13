use std::sync::Arc;
use std::time::Duration;

use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use uuid::Uuid;

use eulesia_db::entities::threads;
use eulesia_db::repo::outbox::OutboxRepo;
use eulesia_db::repo::sessions::SessionRepo;
use eulesia_db::repo::tags::TagRepo;
use eulesia_ingest::ai::MistralClient;
use eulesia_ingest::ai::classify_thread::{ContentUnderstanding, classify_thread};
use eulesia_notify::dispatch::NotificationDispatcher;
use eulesia_notify::types::NotificationEvent;
use eulesia_search::sync::SearchSync;

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const MAX_ATTEMPTS: i16 = 5;

/// Context passed to the outbox worker with optional integrations.
pub struct WorkerContext {
    pub db: Arc<DatabaseConnection>,
    pub dispatcher: Option<Arc<NotificationDispatcher>>,
    pub search_sync: Option<Arc<SearchSync>>,
    /// When set, new user-authored threads are classified by Mistral and
    /// auto-tagged. `None` if `MISTRAL_API_KEY` is not configured.
    pub mistral: Option<Arc<MistralClient>>,
}

pub async fn run(ctx: Arc<WorkerContext>, cancel: CancellationToken) {
    info!("outbox worker started");

    loop {
        tokio::select! {
            () = cancel.cancelled() => {
                info!("outbox worker shutting down");
                break;
            }
            () = tokio::time::sleep(POLL_INTERVAL) => {
                if let Err(e) = process_batch(&ctx).await {
                    error!(error = %e, "outbox worker batch failed");
                }
            }
        }
    }
}

async fn process_batch(ctx: &WorkerContext) -> Result<(), sea_orm::DbErr> {
    let events = OutboxRepo::fetch_pending(&ctx.db, 50).await?;
    if events.is_empty() {
        return Ok(());
    }

    info!(count = events.len(), "processing outbox events");

    for event in events {
        match process_event(ctx, &event).await {
            Ok(()) => {
                OutboxRepo::mark_completed(&ctx.db, event.id).await?;
            }
            Err(e) => {
                let msg = e.to_string();
                warn!(event_id = %event.id, error = %msg, "outbox event failed");
                if event.attempt_count >= MAX_ATTEMPTS {
                    warn!(event_id = %event.id, "event exceeded max attempts, moving to dead letter");
                    OutboxRepo::mark_dead(&ctx.db, event.id, &msg).await?;
                } else {
                    let backoff = backoff_seconds(event.attempt_count);
                    let next_at =
                        chrono::Utc::now().fixed_offset() + chrono::Duration::seconds(backoff);
                    OutboxRepo::mark_failed(&ctx.db, event.id, &msg, next_at).await?;
                }
            }
        }
    }
    Ok(())
}

async fn process_event(
    ctx: &WorkerContext,
    event: &eulesia_db::entities::outbox::Model,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match event.event_type.as_str() {
        "session_cleanup" => {
            let deleted = SessionRepo::cleanup_expired(&ctx.db).await?;
            if deleted > 0 {
                info!(deleted, "cleaned up expired sessions");
            }
            Ok(())
        }
        "notification" => {
            if let Some(ref dispatcher) = ctx.dispatcher {
                let notification =
                    serde_json::from_value::<NotificationEvent>(event.payload.clone())?;
                dispatcher.dispatch(&notification).await?;
            }
            Ok(())
        }
        // Search index sync events
        "thread_created" | "thread_updated" | "thread_deleted" | "user_created"
        | "user_updated" => {
            if let Some(ref sync) = ctx.search_sync {
                sync.process_event(event.event_type.as_str(), &event.payload)
                    .await?;
            }

            // AI classification for newly created user threads.
            if event.event_type == "thread_created" {
                if let Some(ref mistral) = ctx.mistral {
                    maybe_classify_thread(&ctx.db, mistral, &event.payload).await;
                }
            }

            Ok(())
        }
        "magic_link" => {
            let email = event
                .payload
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let url = event
                .payload
                .get("verifyUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if let Some(ref dispatcher) = ctx.dispatcher {
                let subject = "Kirjaudu Eulesiaan";
                let body = format!(
                    r#"<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                    <h2>Kirjaudu Eulesiaan</h2>
                    <p>Klikkaa alla olevaa linkkiä kirjautuaksesi:</p>
                    <p><a href="{url}" style="display: inline-block; padding: 12px 24px;
                        background: #2563eb; color: #fff; text-decoration: none;
                        border-radius: 6px;">Kirjaudu sisään</a></p>
                    <p style="color: #666; font-size: 14px;">Linkki vanhenee 15 minuutin kuluttua.
                    Jos et pyytänyt tätä, voit jättää viestin huomiotta.</p>
                    </div>"#,
                );
                dispatcher
                    .send_email(email, subject, &body)
                    .await
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
                info!(email = %email, "magic link email sent");
            } else {
                info!(email = %email, "magic link email skipped (dispatcher not configured)");
            }
            Ok(())
        }
        other => {
            warn!(event_type = other, "unknown outbox event type, skipping");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// AI content classification
// ---------------------------------------------------------------------------

/// Best-effort AI classification of a new thread. Errors are logged and
/// swallowed — they never fail the outbox event or prevent search indexing.
async fn maybe_classify_thread(
    db: &DatabaseConnection,
    mistral: &MistralClient,
    payload: &serde_json::Value,
) {
    // Skip AI-generated threads (minutes import etc.) — they already have tags.
    let source = payload
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("user");
    if source != "user" {
        return;
    }

    let Some(thread_id_str) = payload.get("id").and_then(|v| v.as_str()) else {
        return;
    };
    let Ok(thread_id) = thread_id_str.parse::<Uuid>() else {
        return;
    };

    let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let content = payload
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if content.is_empty() && title.is_empty() {
        return;
    }

    let analysis = match classify_thread(mistral, title, content).await {
        Ok(a) => a,
        Err(e) => {
            warn!(thread_id = %thread_id, error = %e, "AI classification failed");
            return;
        }
    };

    info!(
        thread_id = %thread_id,
        tags = ?analysis.tags,
        language = %analysis.language,
        quality = ?analysis.quality_score,
        sentiment = ?analysis.sentiment,
        "classified thread"
    );

    // 1. Add AI-generated tags (ignore duplicates with user tags).
    let tags: Vec<String> = analysis
        .tags
        .iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty() && t.len() <= 100)
        .take(5)
        .collect();
    if let Err(e) = TagRepo::add_tags_ignore_duplicates(db, thread_id, &tags).await {
        warn!(thread_id = %thread_id, error = %e, "failed to add AI tags");
    }

    // 2. Store full analysis + update language.
    let analysis_json = serde_json::to_value(&analysis).ok();
    let flagged = should_flag(&analysis);

    let now = chrono::Utc::now().fixed_offset();
    let mut update = threads::ActiveModel {
        id: Set(thread_id),
        ..Default::default()
    };

    if let Some(json) = analysis_json {
        update.ai_analysis = Set(Some(json));
    }

    // Set language if the thread doesn't have one yet.
    if !analysis.language.is_empty() {
        // Only update if currently NULL — use a raw update to avoid
        // overwriting an explicit user choice.
        let _ = sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "UPDATE threads SET language = $1 WHERE id = $2 AND language IS NULL",
            [analysis.language.clone().into(), thread_id.into()],
        );
        // For ai_analysis we always set it:
    }

    if flagged {
        let reason = build_flag_reason(&analysis);
        update.flagged_at = Set(Some(now));
        update.flagged_reason = Set(Some(reason.clone()));
        warn!(thread_id = %thread_id, reason = %reason, "thread auto-flagged");
    }

    if let Err(e) = update.update(db).await {
        warn!(thread_id = %thread_id, error = %e, "failed to save AI analysis");
    }
}

fn should_flag(analysis: &ContentUnderstanding) -> bool {
    if let Some(score) = analysis.quality_score {
        if score < 0.3 {
            return true;
        }
    }
    matches!(analysis.sentiment.as_deref(), Some("hateful"))
}

fn build_flag_reason(analysis: &ContentUnderstanding) -> String {
    let mut reasons = Vec::new();
    if let Some(score) = analysis.quality_score {
        if score < 0.3 {
            reasons.push(format!("low quality score: {score:.2}"));
        }
    }
    if matches!(analysis.sentiment.as_deref(), Some("hateful")) {
        reasons.push("hateful sentiment".to_string());
    }
    reasons.join("; ")
}

fn backoff_seconds(attempt: i16) -> i64 {
    // Exponential backoff: 30s, 60s, 120s, 240s, 480s
    i64::from(30 * (1 << attempt.clamp(0, 4)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_attempt_0() {
        assert_eq!(backoff_seconds(0), 30);
    }

    #[test]
    fn backoff_attempt_1() {
        assert_eq!(backoff_seconds(1), 60);
    }

    #[test]
    fn backoff_attempt_2() {
        assert_eq!(backoff_seconds(2), 120);
    }

    #[test]
    fn backoff_attempt_3() {
        assert_eq!(backoff_seconds(3), 240);
    }

    #[test]
    fn backoff_attempt_4() {
        assert_eq!(backoff_seconds(4), 480);
    }

    #[test]
    fn backoff_attempt_5_capped() {
        assert_eq!(backoff_seconds(5), 480);
    }

    #[test]
    fn backoff_negative_attempt_clamped() {
        assert_eq!(backoff_seconds(-1), 30);
    }

    #[test]
    fn should_flag_low_quality() {
        let analysis = ContentUnderstanding {
            tags: vec![],
            language: "fi".into(),
            location_hints: vec![],
            scope_hint: None,
            content_type: None,
            quality_score: Some(0.1),
            sentiment: Some("neutral".into()),
            entities: vec![],
        };
        assert!(should_flag(&analysis));
    }

    #[test]
    fn should_flag_hateful() {
        let analysis = ContentUnderstanding {
            tags: vec![],
            language: "fi".into(),
            location_hints: vec![],
            scope_hint: None,
            content_type: None,
            quality_score: Some(0.5),
            sentiment: Some("hateful".into()),
            entities: vec![],
        };
        assert!(should_flag(&analysis));
    }

    #[test]
    fn should_not_flag_good_content() {
        let analysis = ContentUnderstanding {
            tags: vec!["kaavoitus".into()],
            language: "fi".into(),
            location_hints: vec![],
            scope_hint: None,
            content_type: None,
            quality_score: Some(0.8),
            sentiment: Some("constructive".into()),
            entities: vec![],
        };
        assert!(!should_flag(&analysis));
    }
}
