//! Server-side SEO: meta tag injection and `/sitemap.xml`.
//!
//! ## How it works
//!
//! The built SPA `apps/web/public/index.html` contains placeholder comments:
//!
//! ```html
//! <!--SEO_HEAD_START--><title>Eulesia</title>...<!--SEO_HEAD_END-->
//! <!--SEO_NOSCRIPT_START--><!--SEO_NOSCRIPT_END-->
//! ```
//!
//! The server's SPA fallback calls [`inject_meta`] for every HTML page request.
//! It parses the path, fetches a minimal amount of data from the database
//! (thread title, municipality name), then replaces the placeholder block with
//! correct `<title>` / `<meta>` / `<link>` tags so crawlers and social-media
//! link-preview bots see route-specific metadata without running JavaScript.
//!
//! ## OG images
//!
//! The default OG image (`/og-default.png`) is served as a static file by the
//! frontend `ServeDir`. Runtime SVG rendering (resvg/usvg/tiny-skia/fontdb)
//! is available when needed — see `Cargo.toml` comment.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use sea_orm::EntityTrait;
use tracing::warn;
use uuid::Uuid;

use eulesia_db::entities::municipalities;
use eulesia_db::repo::threads::ThreadRepo;

use crate::AppState;

const SITE_NAME: &str = "Eulesia";
const DEFAULT_DESCRIPTION: &str = "Eurooppalainen kansalaisdemokratia-alusta";

// ---------------------------------------------------------------------------
// Public routes (root level — not under /api/, which robots.txt blocks)
// ---------------------------------------------------------------------------

pub fn routes() -> Router<AppState> {
    Router::new().route("/sitemap.xml", get(sitemap))
}

// ---------------------------------------------------------------------------
// Public: SPA meta injection — called from server/main.rs SPA fallback
// ---------------------------------------------------------------------------

/// Inject route-specific SEO meta tags into the pre-read `index.html` template.
///
/// Returns the full HTML document with the `<!--SEO_HEAD_START-->` /
/// `<!--SEO_HEAD_END-->` block replaced by correct `<title>` and `<meta>` tags.
///
/// If `state.index_html` is `None` (API-only mode), an empty shell is returned.
pub async fn inject_meta(path: &str, state: &AppState) -> Html<Vec<u8>> {
    let Some(template) = state.index_html.as_deref() else {
        return Html(b"<!DOCTYPE html><html><head></head><body></body></html>".to_vec());
    };

    let base = state.config.frontend_origin.trim_end_matches('/');
    let meta = resolve_meta(path, &state.db, base).await;
    Html(apply_meta(template, &meta).into_bytes())
}

// ---------------------------------------------------------------------------
// Sitemap handler
// ---------------------------------------------------------------------------

async fn sitemap(State(state): State<AppState>) -> Response {
    let base = state.config.frontend_origin.trim_end_matches('/');

    let munis = municipalities::Entity::find()
        .all(state.db.as_ref())
        .await
        .unwrap_or_else(|e| {
            warn!(error = %e, "sitemap: failed to fetch municipalities");
            vec![]
        });

    let mut xml = String::with_capacity(4096);
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");

    for (path, freq, priority) in &[
        ("/", "weekly", "1.0"),
        ("/agora", "daily", "0.9"),
        ("/kunnat", "weekly", "0.8"),
        ("/about", "monthly", "0.5"),
        ("/terms", "monthly", "0.3"),
        ("/privacy", "monthly", "0.3"),
    ] {
        push_url(&mut xml, &format!("{base}{path}"), freq, priority);
    }

    for m in &munis {
        push_url(&mut xml, &format!("{base}/kunnat/{}", m.id), "daily", "0.7");
    }

    xml.push_str("</urlset>\n");

    let mut response = xml.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    response
}

fn push_url(out: &mut String, loc: &str, changefreq: &str, priority: &str) {
    out.push_str("  <url>\n");
    out.push_str(&format!("    <loc>{loc}</loc>\n"));
    out.push_str(&format!("    <changefreq>{changefreq}</changefreq>\n"));
    out.push_str(&format!("    <priority>{priority}</priority>\n"));
    out.push_str("  </url>\n");
}

// ---------------------------------------------------------------------------
// Meta resolution: map request path → PageMeta
// ---------------------------------------------------------------------------

struct PageMeta {
    title: String,
    description: String,
    og_image: String,
    canonical: String,
}

impl PageMeta {
    fn default_for(base: &str, path: &str) -> Self {
        Self {
            title: SITE_NAME.to_owned(),
            description: DEFAULT_DESCRIPTION.to_owned(),
            og_image: format!("{base}/og-default.png"),
            canonical: format!("{base}{path}"),
        }
    }
}

async fn resolve_meta(path: &str, db: &sea_orm::DatabaseConnection, base: &str) -> PageMeta {
    // /agora/thread/<uuid>
    if let Some(rest) = path.strip_prefix("/agora/thread/") {
        if let Ok(id) = rest.trim_end_matches('/').parse::<Uuid>() {
            match ThreadRepo::find_by_id(db, id).await {
                Ok(Some(thread)) => {
                    let full_title = format!("{} | {SITE_NAME}", thread.title);
                    let description = truncate(&strip_markdown(&thread.content), 160);
                    return PageMeta {
                        title: full_title,
                        description,
                        og_image: format!("{base}/og-default.png"),
                        canonical: format!("{base}{path}"),
                    };
                }
                Ok(None) => {}
                Err(e) => warn!(id = %id, error = %e, "seo: thread lookup failed"),
            }
        }
    }

    // /kunnat/<uuid>
    if let Some(rest) = path.strip_prefix("/kunnat/") {
        if let Ok(id) = rest.trim_end_matches('/').parse::<Uuid>() {
            match municipalities::Entity::find_by_id(id).one(db).await {
                Ok(Some(muni)) => {
                    let full_title = format!("{} | {SITE_NAME}", muni.name);
                    let description = format!(
                        "Seuraa {} päätöksiä ja osallistu paikalliseen \
                         demokratiaan Eulesiassa.",
                        muni.name
                    );
                    return PageMeta {
                        title: full_title,
                        description,
                        og_image: format!("{base}/og-default.png"),
                        canonical: format!("{base}{path}"),
                    };
                }
                Ok(None) => {}
                Err(e) => warn!(id = %id, error = %e, "seo: municipality lookup failed"),
            }
        }
    }

    PageMeta::default_for(base, path)
}

// ---------------------------------------------------------------------------
// HTML template transformation
// ---------------------------------------------------------------------------

fn apply_meta(template: &str, meta: &PageMeta) -> String {
    let head = format!(
        concat!(
            "<title>{title}</title>\n",
            "    <meta name=\"description\" content=\"{desc}\" />\n",
            "    <meta name=\"robots\" content=\"index,follow\" />\n",
            "    <link rel=\"canonical\" href=\"{url}\" />\n",
            "    <link rel=\"alternate\" hreflang=\"fi\" href=\"{url}\" />\n",
            "    <link rel=\"alternate\" hreflang=\"x-default\" href=\"{url}\" />\n",
            "    <meta property=\"og:title\" content=\"{title}\" />\n",
            "    <meta property=\"og:description\" content=\"{desc}\" />\n",
            "    <meta property=\"og:type\" content=\"website\" />\n",
            "    <meta property=\"og:site_name\" content=\"{site}\" />\n",
            "    <meta property=\"og:url\" content=\"{url}\" />\n",
            "    <meta property=\"og:image\" content=\"{img}\" />\n",
            "    <meta property=\"og:locale\" content=\"fi_FI\" />\n",
            "    <meta name=\"twitter:card\" content=\"summary_large_image\" />\n",
            "    <meta name=\"twitter:title\" content=\"{title}\" />\n",
            "    <meta name=\"twitter:description\" content=\"{desc}\" />\n",
            "    <meta name=\"twitter:image\" content=\"{img}\" />"
        ),
        title = escape_attr(&meta.title),
        desc = escape_attr(&meta.description),
        url = escape_attr(&meta.canonical),
        img = escape_attr(&meta.og_image),
        site = SITE_NAME,
    );

    let noscript = format!(
        "<noscript><p>{}</p></noscript>",
        escape_html(&meta.description),
    );

    let result = replace_between(
        template,
        "<!--SEO_HEAD_START-->",
        "<!--SEO_HEAD_END-->",
        &head,
    );
    replace_between(
        &result,
        "<!--SEO_NOSCRIPT_START-->",
        "<!--SEO_NOSCRIPT_END-->",
        &noscript,
    )
}

/// Replace the content between `start` and `end` markers (inclusive).
/// If either marker is missing the template is returned unchanged.
fn replace_between(html: &str, start: &str, end: &str, replacement: &str) -> String {
    let Some(start_pos) = html.find(start) else {
        return html.to_owned();
    };
    let search_from = start_pos + start.len();
    let Some(end_offset) = html[search_from..].find(end) else {
        return html.to_owned();
    };
    let end_pos = search_from + end_offset + end.len();

    format!(
        "{}{}{replacement}{}{}",
        &html[..start_pos],
        start,
        end,
        &html[end_pos..],
    )
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/// Strip the most common Markdown markers to get plain-text for meta descriptions.
fn strip_markdown(s: &str) -> String {
    s.lines()
        .map(|line| {
            line.trim_start_matches(|c: char| matches!(c, '#' | '*' | '-' | '>'))
                .trim()
        })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Truncate to at most `max_chars` characters, appending `…` if cut.
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_owned();
    }
    let cut: String = s.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{cut}…")
}

/// Escape characters special in HTML attributes.
fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Escape characters special in HTML text content.
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_template() -> &'static str {
        r#"<!doctype html><html><head>
<!--SEO_HEAD_START--><title>Eulesia</title><meta name="description" content="default" /><!--SEO_HEAD_END-->
</head><body><!--SEO_NOSCRIPT_START--><!--SEO_NOSCRIPT_END--><div id="root"></div></body></html>"#
    }

    #[test]
    fn replaces_title_in_head_block() {
        let meta = PageMeta {
            title: "Rautalampi | Eulesia".into(),
            description: "Seuraa Rautalampi päätöksiä".into(),
            og_image: "https://eulesia.org/og-default.png".into(),
            canonical: "https://eulesia.org/kunnat/some-uuid".into(),
        };
        let html = apply_meta(make_template(), &meta);
        assert!(html.contains("<title>Rautalampi | Eulesia</title>"));
        assert!(html.contains("og:title\" content=\"Rautalampi | Eulesia\""));
        assert!(html.contains("twitter:title\" content=\"Rautalampi | Eulesia\""));
        assert!(
            !html.contains("<title>Eulesia</title>"),
            "default title must be replaced"
        );
    }

    #[test]
    fn escapes_special_chars_in_attributes() {
        let meta = PageMeta {
            title: "Foo & \"Bar\" <test>".into(),
            description: "desc".into(),
            og_image: "https://eulesia.org/og-default.png".into(),
            canonical: "https://eulesia.org/".into(),
        };
        let html = apply_meta(make_template(), &meta);
        assert!(html.contains("Foo &amp; &quot;Bar&quot; &lt;test&gt;"));
    }

    #[test]
    fn noscript_block_replaced() {
        let meta = PageMeta {
            title: "Eulesia".into(),
            description: "Test description".into(),
            og_image: "https://eulesia.org/og-default.png".into(),
            canonical: "https://eulesia.org/".into(),
        };
        let html = apply_meta(make_template(), &meta);
        assert!(html.contains("<noscript><p>Test description</p></noscript>"));
    }

    #[test]
    fn missing_markers_returns_template_unchanged() {
        let html = "no markers here";
        let result = replace_between(html, "<!--START-->", "<!--END-->", "replacement");
        assert_eq!(result, html);
    }

    #[test]
    fn truncate_cuts_long_strings() {
        let long = "a".repeat(200);
        let result = truncate(&long, 160);
        assert!(result.chars().count() <= 160);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn truncate_leaves_short_strings() {
        let short = "hello";
        assert_eq!(truncate(short, 160), short);
    }
}
