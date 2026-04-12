//! Generic PDF listing fetcher.
//!
//! Many Finnish municipalities publish pöytäkirjat as plain PDF links on a
//! simple HTML page — typically a Drupal or WordPress site. There is no
//! standard CGI interface like Dynasty or Tweb; just a page with `<a>` tags
//! whose `href` ends in `.pdf`.
//!
//! This fetcher:
//! 1. GETs the configured listing URL.
//! 2. Finds every `<a href="...pdf">` link.
//! 3. Infers the organ name and date from the link text, filename, or URL
//!    path.
//! 4. Returns each PDF as a standalone `Meeting` whose `extract_content`
//!    simply downloads and runs `pdf::extract_text`.
//!
//! The fetcher ignores "esityslista" links (agendas) and only keeps
//! "pöytäkirja" links.
//!
//! For multi-page sites (e.g. WordPress hub → organ subpages), configure
//! one `MinuteSource` per organ subpage, or pass the hub URL and set
//! `path_prefix` to signal "crawl children first" (future extension).

use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use scraper::{Html, Selector};
use tracing::debug;
use url::Url;

use crate::error::IngestError;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;
use crate::pdf;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(1500);
const LISTING_LIMIT: usize = 30;

pub struct GenericPdfFetcher {
    client: RateLimitedClient,
}

impl GenericPdfFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for GenericPdfFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::GenericPdf
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let response = self.client.get(&source.url).await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "generic_pdf listing",
                message: format!("{} returned status {}", source.url, response.status()),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read generic_pdf listing body",
            source,
        })?;

        let base = Url::parse(&source.url).ok();
        let meetings = parse_pdf_links(&html, base.as_ref());
        debug!(
            source = %source.entity_name,
            count = meetings.len(),
            "parsed generic pdf listing"
        );
        Ok(meetings.into_iter().take(LISTING_LIMIT).collect())
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        _source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        let response = self.client.get(&meeting.page_url).await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let bytes = response.bytes().await.map_err(|source| IngestError::Http {
            context: "download generic pdf",
            source,
        })?;
        let text = pdf::extract_text(&bytes)?;
        if text.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(text))
    }
}

/// Find all `<a href="...pdf">` links on the page, skip esityslistat,
/// and extract organ + date from the link text or filename.
fn parse_pdf_links(html: &str, base: Option<&Url>) -> Vec<Meeting> {
    let document = Html::parse_document(html);
    let anchor_sel = Selector::parse("a[href]").expect("valid selector");
    let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");

    let mut meetings = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    for el in document.select(&anchor_sel) {
        let Some(href) = el.value().attr("href") else {
            continue;
        };
        if !href.to_lowercase().ends_with(".pdf") {
            continue;
        }

        let link_text = el.text().collect::<String>().trim().to_string();
        let lower_text = link_text.to_lowercase();

        // Skip esityslistat (agendas).
        if lower_text.contains("esityslista") && !lower_text.contains("pöytäkirja") {
            continue;
        }

        let absolute_url = base
            .and_then(|b| b.join(href).ok())
            .map(|u| u.to_string())
            .unwrap_or_else(|| href.to_string());

        if !seen_urls.insert(absolute_url.clone()) {
            continue;
        }

        // Try to extract date from link text, then from filename.
        let decoded = urlencoding::decode(href).unwrap_or_default();
        let date = date_re
            .find(&link_text)
            .or_else(|| date_re.find(&decoded))
            .and_then(|m| parse_fi_date(m.as_str()));

        // Infer organ from URL path segments or surrounding HTML context.
        let organ = infer_organ_from_path(href).or_else(|| infer_organ_from_text(&link_text));

        // Build a stable ID from the PDF filename.
        let filename = href.rsplit('/').next().unwrap_or(href);
        let id = urlencoding::decode(filename)
            .unwrap_or_default()
            .to_string();

        let title = if link_text.is_empty() {
            id.clone()
        } else {
            link_text
        };

        meetings.push(Meeting {
            id,
            page_url: absolute_url,
            title,
            date,
            organ,
        });
    }

    meetings
}

/// Try to extract an organ name from common Finnish municipal PDF path
/// patterns like `/poytakirjat/Kunnanhallitus/2026/file.pdf`.
fn infer_organ_from_path(href: &str) -> Option<String> {
    let decoded = urlencoding::decode(href).unwrap_or_default();
    let segments: Vec<&str> = decoded.split('/').filter(|s| !s.is_empty()).collect();

    // Look for a segment that looks like an organ name (capitalized Finnish
    // word, at least 4 chars, not a year, not "sites", "default", "files",
    // "tiedostot", "poytakirjat").
    let ignore = [
        "sites",
        "default",
        "files",
        "tiedostot",
        "poytakirjat",
        "poytakirjat_ja_esityslistat",
        "poytakirjat_ya_esityslistat",
        "esityslistat",
        "wp-content",
        "uploads",
        "documents",
    ];
    let year_re = Regex::new(r"^\d{4}$").expect("valid regex");

    for seg in segments.iter().rev() {
        let lower = seg.to_lowercase();
        if seg.len() < 4 || ignore.contains(&lower.as_str()) || year_re.is_match(seg) {
            continue;
        }
        if lower.ends_with(".pdf") {
            continue;
        }
        // Must start with uppercase or be a known Finnish organ pattern.
        if seg.chars().next().is_some_and(|c| c.is_uppercase()) {
            return Some(seg.replace('_', " ").replace("%20", " "));
        }
    }
    None
}

/// Try to extract an organ name from the link text itself, by removing
/// known noise words and the date portion.
fn infer_organ_from_text(text: &str) -> Option<String> {
    let cleaned = text
        .replace("Pöytäkirja", "")
        .replace("pöytäkirja", "")
        .replace("Poytakirja", "")
        .replace("poytakirja", "");
    let date_re = Regex::new(r"\d{1,2}\.\d{1,2}\.\d{4}").expect("valid regex");
    let without_date = date_re.replace_all(&cleaned, "");
    let trimmed = without_date
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric());
    if trimmed.len() >= 3 {
        Some(trimmed.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pdf_links_from_drupal_page() {
        let html = r#"
<table>
<tr><td><a href="/sites/default/files/tiedostot/poytakirjat_ja_esityslistat/Kunnanhallitus/2026/Kunnanhallituksen%20p%C3%B6yt%C3%A4kirja%2013.4.2026.pdf">Pöytäkirja 13.4.2026</a></td></tr>
<tr><td><a href="/sites/default/files/tiedostot/poytakirjat_ja_esityslistat/Kunnanhallitus/2026/Kunnanhallituksen%20esityslista%2013.4.2026.pdf">Esityslista 13.4.2026</a></td></tr>
<tr><td><a href="/sites/default/files/tiedostot/poytakirjat_ja_esityslistat/Kunnanvaltuusto/2026/Kunnanvaltuuston%20p%C3%B6yt%C3%A4kirja%2030.3.2026.pdf">Pöytäkirja 30.3.2026</a></td></tr>
</table>"#;
        let base = Url::parse("https://kannonkoski.fi/esityslistat-ja-poytakirjat").unwrap();
        let meetings = parse_pdf_links(html, Some(&base));

        // Esityslista should be filtered out.
        assert_eq!(meetings.len(), 2);
        assert!(meetings[0].page_url.contains("Kunnanhallitus"));
        assert!(meetings[1].page_url.contains("Kunnanvaltuusto"));
    }

    #[test]
    fn extracts_date_from_link_text() {
        let html = r#"<a href="/file.pdf">Pöytäkirja 28.3.2026</a>"#;
        let meetings = parse_pdf_links(html, None);
        assert_eq!(meetings.len(), 1);
        let d = meetings[0].date.expect("should have date");
        assert_eq!(d.to_string(), "2026-03-28");
    }

    #[test]
    fn infers_organ_from_url_path() {
        assert_eq!(
            infer_organ_from_path(
                "/sites/default/files/tiedostot/poytakirjat_ja_esityslistat/Kunnanhallitus/2026/file.pdf"
            ),
            Some("Kunnanhallitus".to_string())
        );
    }

    #[test]
    fn infers_organ_from_text() {
        assert_eq!(
            infer_organ_from_text("Kunnanvaltuuston pöytäkirja 30.3.2026"),
            Some("Kunnanvaltuuston".to_string())
        );
    }

    #[test]
    fn skips_esityslista_links() {
        let html = r#"
<a href="/esityslista.pdf">Esityslista 1.4.2026</a>
<a href="/poytakirja.pdf">Pöytäkirja 1.4.2026</a>"#;
        let meetings = parse_pdf_links(html, None);
        assert_eq!(meetings.len(), 1);
        assert!(meetings[0].title.contains("Pöytäkirja"));
    }

    #[test]
    fn deduplicates_identical_urls() {
        let html = r#"
<a href="/file.pdf">Link 1</a>
<a href="/file.pdf">Link 2</a>"#;
        assert_eq!(parse_pdf_links(html, None).len(), 1);
    }
}
