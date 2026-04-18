use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Client;
use tracing::{info, warn};

/// VAPID-authenticated Web Push client.
///
/// Sends a push signal to browser push endpoints. The browser service worker
/// receives the push event and can then fetch new data from the server.
pub struct WebPushClient {
    client: Client,
    config: Option<VapidConfig>,
}

struct VapidConfig {
    /// VAPID private key in PEM or raw base64-encoded form.
    private_key: jsonwebtoken::EncodingKey,
    /// VAPID public key (base64url-encoded, uncompressed point).
    public_key_b64: String,
    /// Contact info (mailto: or https: URL) for the VAPID JWT.
    subject: String,
}

impl Default for WebPushClient {
    fn default() -> Self {
        Self::new()
    }
}

impl WebPushClient {
    pub fn new() -> Self {
        let config = Self::load_config();
        if config.is_some() {
            info!("WebPush VAPID client configured");
        }
        Self {
            client: Client::new(),
            config,
        }
    }

    fn load_config() -> Option<VapidConfig> {
        let private_key_pem = std::env::var("VAPID_PRIVATE_KEY").ok()?;
        let public_key_b64 = std::env::var("VAPID_PUBLIC_KEY").ok()?;
        let subject =
            std::env::var("VAPID_SUBJECT").unwrap_or_else(|_| "mailto:admin@eulesia.org".into());

        // Try PEM first, then raw base64
        let key = if private_key_pem.contains("BEGIN") {
            jsonwebtoken::EncodingKey::from_ec_pem(private_key_pem.as_bytes()).ok()?
        } else {
            // Raw base64-encoded PKCS8 DER
            let der = URL_SAFE_NO_PAD.decode(&private_key_pem).ok()?;
            jsonwebtoken::EncodingKey::from_ec_der(&der)
        };

        Some(VapidConfig {
            private_key: key,
            public_key_b64,
            subject,
        })
    }

    fn create_vapid_jwt(&self, config: &VapidConfig, audience: &str) -> Result<String, String> {
        let now = chrono::Utc::now().timestamp();
        let claims = serde_json::json!({
            "aud": audience,
            "exp": now + 86400, // 24 hours
            "sub": config.subject,
        });

        let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        jsonwebtoken::encode(&header, &claims, &config.private_key)
            .map_err(|e| format!("VAPID JWT: {e}"))
    }

    pub async fn send(&self, endpoint: &str, _p256dh: &str, _auth: &str, _payload: &str) {
        // Extract the origin from the endpoint URL. Used as the VAPID audience
        // and as a non-sensitive identifier for logs (full endpoint URLs
        // contain per-subscription auth material).
        let endpoint_origin = match url::Url::parse(endpoint) {
            Ok(u) => format!("{}://{}", u.scheme(), u.host_str().unwrap_or("")),
            Err(_) => {
                warn!("invalid push endpoint URL");
                return;
            }
        };

        let config = if let Some(c) = &self.config {
            c
        } else {
            info!(endpoint_origin, "WebPush not configured, skipping");
            return;
        };

        let audience = endpoint_origin.clone();

        let jwt = match self.create_vapid_jwt(config, &audience) {
            Ok(t) => t,
            Err(e) => {
                warn!(error = %e, "failed to create VAPID JWT");
                return;
            }
        };

        let auth_header = format!("vapid t={jwt}, k={}", config.public_key_b64,);

        // Send a content-less push (signal-only). The service worker
        // receives the event and can fetch updates via the API.
        match self
            .client
            .post(endpoint)
            .header("Authorization", &auth_header)
            .header("TTL", "86400")
            .header("Content-Length", "0")
            .body(Vec::new())
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 201 {
                    info!(endpoint_origin, "WebPush notification sent");
                } else if status.as_u16() == 410 {
                    // 410 Gone — subscription expired, should be cleaned up
                    info!(endpoint_origin, "WebPush subscription expired (410)");
                } else {
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, endpoint_origin, "WebPush send failed");
                }
            }
            Err(e) => warn!(error = %e, endpoint_origin, "WebPush HTTP request failed"),
        }
    }
}
