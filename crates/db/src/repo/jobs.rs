use eulesia_common::types::JobStatus;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseConnection, DbErr, EntityTrait};
use uuid::Uuid;

use crate::entities::{job_cursors, job_runs};

pub struct JobRepo;

impl JobRepo {
    pub async fn record_started(
        db: &DatabaseConnection,
        job_name: &str,
    ) -> Result<job_runs::Model, DbErr> {
        let now = chrono::Utc::now().fixed_offset();

        job_runs::ActiveModel {
            id: Set(Uuid::now_v7()),
            job_name: Set(job_name.to_owned()),
            status: Set(JobStatus::Running),
            started_at: Set(now),
            finished_at: Set(None),
            details: Set(None),
            error: Set(None),
        }
        .insert(db)
        .await
    }

    pub async fn record_finished(
        db: &DatabaseConnection,
        run: job_runs::Model,
        status: JobStatus,
        details: Option<serde_json::Value>,
        error: Option<String>,
    ) -> Result<job_runs::Model, DbErr> {
        let mut active: job_runs::ActiveModel = run.into();
        active.status = Set(status);
        active.finished_at = Set(Some(chrono::Utc::now().fixed_offset()));
        active.details = Set(details);
        active.error = Set(error);
        active.update(db).await
    }

    pub async fn upsert_cursor(
        db: &DatabaseConnection,
        job_name: &str,
        cursor_value: Option<&str>,
    ) -> Result<job_cursors::Model, DbErr> {
        let now = chrono::Utc::now().fixed_offset();

        if let Some(existing) = job_cursors::Entity::find_by_id(job_name.to_owned())
            .one(db)
            .await?
        {
            let mut active: job_cursors::ActiveModel = existing.into();
            active.cursor_value = Set(cursor_value.map(ToOwned::to_owned));
            active.updated_at = Set(now);
            active.update(db).await
        } else {
            job_cursors::ActiveModel {
                job_name: Set(job_name.to_owned()),
                cursor_value: Set(cursor_value.map(ToOwned::to_owned)),
                updated_at: Set(now),
            }
            .insert(db)
            .await
        }
    }
}
