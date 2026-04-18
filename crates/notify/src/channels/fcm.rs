use reqwest::Client;
use serde::Deserialize;
use tracing::{info, warn};

/// FCM HTTP v1 API client using Google service account JWT auth.
pub struct FcmClient {
    client: Client,
    config: Option<FcmConfig>,
}

struct FcmConfig {
    project_id: String,
    client_email: String,
    private_key: jsonwebtoken::EncodingKey,
}

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
}

impl Default for FcmClient {
    fn default() -> Self {
        Self::new()
    }
}

impl FcmClient {
    pub fn new() -> Self {
        let config = Self::load_config();
        if config.is_some() {
            info!("FCM client configured");
        }
        Self {
            client: Client::new(),
            config,
        }
    }

    fn load_config() -> Option<FcmConfig> {
        // Try GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON)
        let json = if let Ok(path) = std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
            std::fs::read_to_string(path).ok()?
        } else if let Ok(json) = std::env::var("FCM_SERVICE_ACCOUNT_JSON") {
            json
        } else {
            return None;
        };

        let sa: ServiceAccount = serde_json::from_str(&json).ok()?;
        let key = jsonwebtoken::EncodingKey::from_rsa_pem(sa.private_key.as_bytes()).ok()?;

        Some(FcmConfig {
            project_id: sa.project_id,
            client_email: sa.client_email,
            private_key: key,
        })
    }

    fn create_access_token(&self, config: &FcmConfig) -> Result<String, String> {
        let now = chrono::Utc::now().timestamp();
        let claims = serde_json::json!({
            "iss": config.client_email,
            "scope": "https://www.googleapis.com/auth/firebase.messaging",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        });

        let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        let jwt = jsonwebtoken::encode(&header, &claims, &config.private_key)
            .map_err(|e| format!("JWT encode: {e}"))?;

        Ok(jwt)
    }

    pub async fn send(&self, device_token: &str, title: &str, body: &str) {
        let token_fp = &device_token[..8.min(device_token.len())];
        let config = if let Some(c) = &self.config {
            c
        } else {
            info!(token_fp, title, "FCM not configured, skipping");
            return;
        };

        let jwt = match self.create_access_token(config) {
            Ok(t) => t,
            Err(e) => {
                warn!(error = %e, "failed to create FCM JWT");
                return;
            }
        };

        // Exchange JWT for access token via Google OAuth2
        let token_resp = match self
            .client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", &jwt),
            ])
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "FCM OAuth2 token exchange failed");
                return;
            }
        };

        if !token_resp.status().is_success() {
            let status = token_resp.status();
            let body = token_resp.text().await.unwrap_or_default();
            warn!(status = %status, body = %body, "FCM OAuth2 token exchange returned error");
            return;
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
        }

        let access_token = match token_resp.json::<TokenResponse>().await {
            Ok(t) => t.access_token,
            Err(e) => {
                warn!(error = %e, "failed to parse FCM OAuth2 response");
                return;
            }
        };

        // Send FCM HTTP v1 message
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            config.project_id
        );

        let payload = serde_json::json!({
            "message": {
                "token": device_token,
                "notification": {
                    "title": title,
                    "body": body,
                }
            }
        });

        match self
            .client
            .post(&url)
            .bearer_auth(&access_token)
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    info!(token_fp, title, "FCM notification sent");
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, "FCM send failed");
                }
            }
            Err(e) => warn!(error = %e, "FCM HTTP request failed"),
        }
    }
}
