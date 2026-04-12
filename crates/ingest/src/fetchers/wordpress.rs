//! WordPress REST API fetcher.
//!
//! Many Finnish municipalities run WordPress and upload pöytäkirjat as PDF
//! media attachments. The standard WP REST API at
//! `/wp-json/wp/v2/media?mime_type=application/pdf&search=pöytäkirja`
//! returns structured JSON with `date`, `title.rendered`, and `source_url`
//! — no HTML scraping needed.
//!
//! `MinuteSource.url` should be the site root (e.g. `https://juupajoki.fi`).
//! The fetcher appends the API path automatically.

use std::time::Duration;

use async_trait::async_trait;
use chrono::NaiveDate;
use regex::Regex;
use serde::Deserialize;
use tracing::debug;

use crate::error::IngestError;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::pdf;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(1500);
const PER_PAGE: u32 = 20;

pub struct WordPressFetcher {
    client: RateLimitedClient,
}

impl WordPressFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[derive(Debug, Deserialize)]
struct WpMediaItem {
    id: u64,
    date: String,
    title: WpRendered,
    source_url: String,
}

#[derive(Debug, Deserialize)]
struct WpRendered {
    rendered: String,
}

#[async_trait]
impl MinuteFetcher for WordPressFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::WordPress
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let base = source.url.trim_end_matches('/');
        let api_url = format!(
            "{base}/wp-json/wp/v2/media\
             ?per_page={PER_PAGE}\
             &mime_type=application/pdf\
             &search=p%C3%B6yt%C3%A4kirja\
             &orderby=date\
             &order=desc"
        );

        let response = self.client.get(&api_url).await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "wordpress media API",
                message: format!("{api_url} returned status {}", response.status()),
            });
        }

        let items: Vec<WpMediaItem> =
            response.json().await.map_err(|source| IngestError::Http {
                context: "parse wordpress media JSON",
                source,
            })?;

        let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");

        let meetings: Vec<Meeting> = items
            .into_iter()
            .map(|item| {
                let title = item.title.rendered.trim().to_string();

                // Date from JSON ISO string (2026-03-31T15:36:55), fall back
                // to Finnish date in the title.
                let date = parse_iso_date(&item.date).or_else(|| {
                    date_re
                        .find(&title)
                        .and_then(|m| crate::minutes::dates::parse_fi_date(m.as_str()))
                });

                let organ = infer_organ_from_wp_title(&title);

                Meeting {
                    id: format!("wp-{}", item.id),
                    page_url: item.source_url,
                    title,
                    date,
                    organ,
                }
            })
            .collect();

        debug!(
            source = %source.entity_name,
            count = meetings.len(),
            "parsed wordpress media API"
        );
        Ok(meetings)
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        _source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        // page_url IS the direct PDF download URL from WP's source_url field.
        let response = self.client.get(&meeting.page_url).await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let bytes = response.bytes().await.map_err(|source| IngestError::Http {
            context: "download wordpress pdf",
            source,
        })?;
        let text = pdf::extract_text(&bytes)?;
        if text.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(text))
    }
}

/// Parse the ISO 8601 date prefix that WP returns (e.g. "2026-03-31T15:36:55").
fn parse_iso_date(s: &str) -> Option<NaiveDate> {
    // Take just the date portion before 'T'.
    let date_part = s.split('T').next()?;
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()
}

/// Try to extract an organ name from a WP media title like
/// "Pöytäkirja_kunnanhallitus_ 2026_03_30" or
/// "Juupajoen nuorisovaltuuston kokouspöytäkirja 11.2.2026".
fn infer_organ_from_wp_title(title: &str) -> Option<String> {
    let lower = title.to_lowercase();

    // Stems + display names. We match on a shortened stem so that Finnish
    // inflected forms (genitive "kunnanhallituksen", partitive "sivistyslautakuntaa",
    // genitive "sivistyslautakunnan") still hit.
    let organ_stems: &[(&str, &str)] = &[
        ("kunnanhallitu", "Kunnanhallitus"),
        ("kunnanvaltuust", "Kunnanvaltuusto"),
        ("kaupunginhallitu", "Kaupunginhallitus"),
        ("kaupunginvaltuust", "Kaupunginvaltuusto"),
        ("sivistyslautakun", "Sivistyslautakunta"),
        ("tekninen lautakun", "Tekninen lautakunta"),
        ("tarkastuslautakun", "Tarkastuslautakunta"),
        ("ympäristölautakun", "Ympäristölautakunta"),
        ("perusturvalautakun", "Perusturvalautakunta"),
        ("hyvinvointilautakun", "Hyvinvointilautakunta"),
        ("elinvoimalautakun", "Elinvoimalautakunta"),
        ("keskusvaalilautakun", "Keskusvaalilautakunta"),
        ("nuorisovaltuust", "Nuorisovaltuusto"),
        ("vanhusneuv", "Vanhusneuvosto"),
        ("vammaisneuv", "Vammaisneuvosto"),
    ];

    for (stem, display) in organ_stems {
        if lower.contains(stem) {
            return Some((*display).to_string());
        }
    }

    // Fallback: try to extract from underscore-separated patterns.
    // "Pöytäkirja_kunnanhallitus_ 2026_03_30" → "kunnanhallitus"
    let parts: Vec<&str> = title.split('_').collect();
    if parts.len() >= 2 {
        let candidate = parts[1].trim().to_lowercase();
        if candidate.len() >= 4 && !candidate.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            let mut chars = candidate.chars();
            let capitalized: String = chars
                .next()
                .map(|c| c.to_uppercase().collect::<String>())
                .unwrap_or_default()
                + chars.as_str();
            return Some(capitalized);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_date() {
        assert_eq!(
            parse_iso_date("2026-03-31T15:36:55"),
            NaiveDate::from_ymd_opt(2026, 3, 31)
        );
        assert_eq!(
            parse_iso_date("2026-01-20T12:00:00"),
            NaiveDate::from_ymd_opt(2026, 1, 20)
        );
        assert_eq!(parse_iso_date("garbage"), None);
    }

    #[test]
    fn infers_organ_from_underscore_title() {
        assert_eq!(
            infer_organ_from_wp_title("Pöytäkirja_kunnanhallitus_ 2026_03_30"),
            Some("Kunnanhallitus".to_string())
        );
    }

    #[test]
    fn infers_organ_from_natural_title() {
        assert_eq!(
            infer_organ_from_wp_title("Juupajoen nuorisovaltuuston kokouspöytäkirja 11.2.2026"),
            Some("Nuorisovaltuusto".to_string())
        );
    }

    #[test]
    fn infers_organ_sivistyslautakunta() {
        assert_eq!(
            infer_organ_from_wp_title("Sivistyslautakunnan pöytäkirja 14.3.2026"),
            Some("Sivistyslautakunta".to_string())
        );
    }

    #[test]
    fn returns_none_for_generic_title() {
        assert_eq!(infer_organ_from_wp_title("Pöytäkirja 2026 03 09"), None);
    }
}
