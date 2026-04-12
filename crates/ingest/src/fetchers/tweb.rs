//! Tweb (Triplan) minute fetcher.
//!
//! Tweb's public interface lives under two slightly different URL layouts:
//!
//! - Newer / direct: `<host>/ktwebscr/pk_tek_tweb.htm` (e.g. Ikaalinen)
//! - Older / ktwebbin: `<host>/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm`
//!   (e.g. Uurainen)
//!
//! On **both** variants the listing page itself is just a search form — it
//! does not contain any meeting links. Real meetings come from POSTing
//! empty search parameters to `pk_kokl_tweb.htm` in the same directory,
//! which returns a table of `<tr>` rows, each with an organ name, a date
//! and a link to `pk_asil_tweb.htm?(+)bid=<N>`.
//!
//! For each meeting we fetch the agenda page and pull out the item PDFs.
//! Item links point to a `doctype=3&docid=<N>` URL — either
//! `/ktwebbin/ktproxy2.dll?...` (Uurainen) or `/ktwebscr/fileshow?...`
//! (Ikaalinen). We follow whatever href the agenda page gives us, so the
//! fetcher is agnostic to the server variant.
//!
//! `MinuteSource.url` is expected to be the **full listing URL** of the
//! Pöytäkirjat search page. We derive both the POST endpoint and the
//! agenda base from that single URL via string substitution.

use std::collections::HashSet;
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use tracing::{debug, warn};
use url::Url;

use crate::error::IngestError;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;
use crate::pdf;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(2000);
const LISTING_LIMIT: usize = 20;

pub struct TwebFetcher {
    client: RateLimitedClient,
}

impl TwebFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for TwebFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::Tweb
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let listing_url = &source.url;

        // Strategy 1: try the RSS feed first — it's cleaner, structured, and
        // universal across Tweb instances. URL: pk_rssfeed.htm?toimielin=
        let rss_url = listing_url.replace("pk_tek_tweb.htm", "pk_rssfeed.htm?toimielin=");
        if let Ok(response) = self.client.get(&rss_url).await {
            if response.status().is_success() {
                if let Ok(xml) = response.text().await {
                    let meetings = parse_rss(&xml, listing_url);
                    if !meetings.is_empty() {
                        debug!(
                            source = %source.entity_name,
                            count = meetings.len(),
                            "parsed tweb RSS feed"
                        );
                        return Ok(meetings.into_iter().take(LISTING_LIMIT).collect());
                    }
                }
            }
        }

        // Strategy 2: fall back to POSTing the search form.
        let post_url = listing_url.replace("pk_tek_tweb.htm", "pk_kokl_tweb.htm");
        let response = self
            .client
            .post_form(&post_url, &[("kirjaamo", ""), ("pvm1", ""), ("pvm2", "")])
            .await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "tweb search POST",
                message: format!("{post_url} returned status {}", response.status()),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read tweb search response",
            source,
        })?;

        let meetings = parse_listing(&html, listing_url);
        debug!(
            source = %source.entity_name,
            count = meetings.len(),
            "parsed tweb listing (POST fallback)"
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
            warn!(url = %meeting.page_url, "tweb agenda fetch failed");
            return Ok(None);
        }
        let agenda_html = response.text().await.map_err(|source| IngestError::Http {
            context: "read tweb agenda",
            source,
        })?;

        let items = parse_agenda_items(&agenda_html);
        if items.is_empty() {
            return Ok(None);
        }

        let agenda_base = Url::parse(&meeting.page_url).ok();

        let mut parts = Vec::with_capacity(items.len());
        for item in items {
            let absolute = agenda_base
                .as_ref()
                .and_then(|base| base.join(&item.href).ok())
                .map(|u| u.to_string())
                .unwrap_or_else(|| item.href.clone());

            let Ok(resp) = self.client.get(&absolute).await else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(bytes) = resp.bytes().await else {
                continue;
            };

            // Item endpoints on Tweb serve PDFs. Try to extract the text; if
            // the bytes turn out not to be a PDF (some old Tweb installs may
            // still serve HTML for the same endpoint) just skip the item
            // rather than aborting the whole meeting.
            match pdf::extract_text(&bytes) {
                Ok(text) if text.chars().count() > 20 => {
                    parts.push(format!("§ {}\n\n{text}", item.title));
                }
                Ok(_) => {
                    debug!(url = %absolute, "tweb item produced empty text");
                }
                Err(err) => {
                    debug!(url = %absolute, error = %err, "tweb item pdf parse failed");
                }
            }
        }

        if parts.is_empty() {
            Ok(None)
        } else {
            Ok(Some(parts.join("\n\n---\n\n")))
        }
    }
}

/// Parse the Tweb RSS feed (`pk_rssfeed.htm?toimielin=`) into meetings.
///
/// Each `<item>` contains:
/// - `<title>Kaupunginhallitus: 4/2026 30.3.2026 12:00</title>`
/// - `<link>pk_asil_tweb.htm?bid=4557</link>` (may be relative)
/// - `<category>Kaupunginhallitus</category>`
/// - `<pubDate>Mon, 30 Mar 2026 12:00:00 GMT</pubDate>`
fn parse_rss(xml: &str, listing_url: &str) -> Vec<Meeting> {
    let item_re = Regex::new(r"(?is)<item>(.*?)</item>").expect("valid regex");
    let link_re = Regex::new(r"(?is)<link>(.*?)</link>").expect("valid regex");
    let title_re = Regex::new(r"(?is)<title>(.*?)</title>").expect("valid regex");
    let category_re = Regex::new(r"(?is)<category>(.*?)</category>").expect("valid regex");
    let bid_re = Regex::new(r"(?i)bid=(\d+)").expect("valid regex");
    let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");

    let base = Url::parse(listing_url).ok();
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for item_cap in item_re.captures_iter(xml) {
        let block = &item_cap[1];

        let link_text = link_re
            .captures(block)
            .map(|c| c[1].trim().to_string())
            .unwrap_or_default();

        let Some(bid_cap) = bid_re.captures(&link_text) else {
            continue;
        };
        let bid = bid_cap[1].to_string();
        if !seen.insert(bid.clone()) {
            continue;
        }

        let title = title_re
            .captures(block)
            .map(|c| c[1].trim().to_string())
            .unwrap_or_default();

        let organ = category_re
            .captures(block)
            .map(|c| c[1].trim().to_string())
            .filter(|s| !s.is_empty());

        let date = date_re.find(&title).and_then(|m| parse_fi_date(m.as_str()));

        let page_url = base
            .as_ref()
            .and_then(|b| b.join(&link_text).ok())
            .map(|u| u.to_string())
            .unwrap_or_else(|| link_text.clone());

        out.push(Meeting {
            id: format!("tweb-{bid}"),
            page_url,
            title,
            date,
            organ,
        });
    }
    out
}

/// Parse the `pk_kokl_tweb.htm` POST response into flattened meeting rows.
///
/// The response is a plain HTML table; each `<tr>` contains something like
/// `Kaupunginhallitus: 4/2026` in one `<td class="data">` cell and a link
/// `<a href="/ktwebscr/pk_asil_tweb.htm?bid=4557">30.3.2026 12:00</a>` in
/// another. We walk the HTML on a per-row basis (split on `<tr`) so we can
/// attribute organ and date to the same meeting.
fn parse_listing(html: &str, listing_url: &str) -> Vec<Meeting> {
    let link_re = Regex::new(
        r#"(?i)<a\s+href=['"]([^'"]*pk_asil_tweb\.htm\?[^'"]*bid=(\d+)[^'"]*)['"][^>]*>([^<]*)</a>"#,
    )
    .expect("valid regex");
    let organ_re = Regex::new(
        r#"(?i)<td[^>]*class=['"][^'"]*\bdata\b[^'"]*['"][^>]*>([^<:]+?)\s*:\s*\d+\s*/\s*\d{2,4}"#,
    )
    .expect("valid regex");
    let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");

    let base = Url::parse(listing_url).ok();
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for row in html.split("<tr").skip(1) {
        let Some(link_cap) = link_re.captures(row) else {
            continue;
        };
        let href = link_cap[1].to_string();
        let bid = link_cap[2].to_string();
        let link_text = link_cap[3].trim().to_string();

        if !seen.insert(bid.clone()) {
            continue;
        }

        let organ = organ_re
            .captures(row)
            .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
            .filter(|s| !s.is_empty());

        let date = date_re
            .find(&link_text)
            .and_then(|m| parse_fi_date(m.as_str()))
            .or_else(|| date_re.find(row).and_then(|m| parse_fi_date(m.as_str())));

        let page_url = base
            .as_ref()
            .and_then(|b| b.join(&href).ok())
            .map(|u| u.to_string())
            .unwrap_or_else(|| href.clone());

        let title = match (&organ, &date) {
            (Some(o), Some(d)) => format!("{o} {}", d.format("%-d.%-m.%Y")),
            (Some(o), None) => o.clone(),
            _ => link_text.clone(),
        };

        out.push(Meeting {
            id: format!("tweb-{bid}"),
            page_url,
            title,
            date,
            organ,
        });
    }

    out
}

/// A single agenda item reference — both the href (possibly relative) and
/// the link text used as the title.
struct AgendaItem {
    href: String,
    title: String,
}

fn parse_agenda_items(html: &str) -> Vec<AgendaItem> {
    // Match any href with doctype=3 and docid=NNN, capturing the full href
    // so the caller can resolve it against the agenda page URL. This covers
    // both `ktproxy2.dll?doctype=3&docid=X` (Uurainen) and
    // `fileshow?doctype=3&docid=X` (Ikaalinen) variants.
    let re = Regex::new(
        r#"(?i)<a\s+href=['"]([^'"]*doctype=3(?:&|&amp;)docid=\d+[^'"]*)['"][^>]*>([^<]*)</a>"#,
    )
    .expect("valid regex");

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cap in re.captures_iter(html) {
        let href = cap[1].to_string();
        // Dedup: the same docid often appears multiple times in a row
        // (icon link + text link).
        if !seen.insert(href.clone()) {
            continue;
        }
        let title = cap[2].trim().to_string();
        if title.is_empty() {
            continue;
        }
        out.push(AgendaItem { href, title });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> MinuteSource {
        MinuteSource {
            entity_name: "Ikaalinen".into(),
            slug: "ikaalinen".into(),
            fetcher_type: FetcherType::Tweb,
            url: "https://ikaalinen.tweb.fi/ktwebscr/pk_tek_tweb.htm".into(),
            country: "FI".into(),
            language: "fi".into(),
            region: None,
            path_prefix: None,
        }
    }

    const POST_RESPONSE: &str = r#"
<table>
<tr>
  <td class="data">Kaupunginhallitus: 4/2026</td>
  <td class="data"><a href="/ktwebscr/pk_asil_tweb.htm?bid=4557">30.3.2026 12:00</a></td>
</tr>
<tr>
  <td class="data">Sivistyslautakunta: 3/2026</td>
  <td class="data"><a href="/ktwebscr/pk_asil_tweb.htm?bid=4552">25.3.2026 17:40</a></td>
</tr>
<tr>
  <td class="data">Sivistyslautakunta: 3/2026</td>
  <td class="data"><a href="/ktwebscr/pk_asil_tweb.htm?bid=4552">25.3.2026 17:40</a></td>
</tr>
</table>"#;

    #[test]
    fn parses_meeting_rows_with_organ_and_date() {
        let meetings = parse_listing(POST_RESPONSE, &src().url);
        assert_eq!(meetings.len(), 2, "duplicate bid should be dropped");
        assert_eq!(meetings[0].organ.as_deref(), Some("Kaupunginhallitus"));
        assert_eq!(meetings[0].id, "tweb-4557");
        assert!(
            meetings[0]
                .page_url
                .starts_with("https://ikaalinen.tweb.fi/ktwebscr/pk_asil_tweb.htm?bid=4557")
        );
        assert!(meetings[0].date.is_some());
    }

    #[test]
    fn parses_listing_with_plus_prefix_bid() {
        let html = r#"
<tr>
  <td class="data">Kunnanhallitus: 1/2026</td>
  <td class="data"><a href="pk_asil_tweb.htm?+bid=4064">28.3.2026 17:00</a></td>
</tr>"#;
        let meetings = parse_listing(
            html,
            "https://uurainen.tweb.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm",
        );
        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0].id, "tweb-4064");
        assert!(meetings[0].organ.as_deref() == Some("Kunnanhallitus"));
    }

    #[test]
    fn parses_agenda_items_ktproxy() {
        let html = r#"
<a href="/ktwebbin/ktproxy2.dll?doctype=3&docid=110020">Kokouksen avaus</a>
<a href="/ktwebbin/ktproxy2.dll?doctype=3&amp;docid=110022">Kaavoituspäätös</a>"#;
        let items = parse_agenda_items(html);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].title, "Kaavoituspäätös");
        assert!(items[0].href.contains("ktproxy2.dll"));
    }

    #[test]
    fn parses_agenda_items_fileshow() {
        let html = r#"
<a href="/ktwebscr/fileshow?doctype=3&docid=136989">Kaupunginhallituksen puheenjohtajan valinta</a>
<a href="/ktwebscr/fileshow?doctype=3&docid=136991">Hallintosäännön muutos</a>"#;
        let items = parse_agenda_items(html);
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].title,
            "Kaupunginhallituksen puheenjohtajan valinta"
        );
        assert!(items[0].href.contains("fileshow"));
    }

    #[test]
    fn agenda_items_dedup_identical_hrefs() {
        let html = r#"
<a href="/ktwebscr/fileshow?doctype=3&docid=1">X</a>
<a href="/ktwebscr/fileshow?doctype=3&docid=1">X</a>"#;
        assert_eq!(parse_agenda_items(html).len(), 1);
    }

    #[test]
    fn listing_url_substitution_to_post() {
        let ikaalinen = "https://ikaalinen.tweb.fi/ktwebscr/pk_tek_tweb.htm";
        assert_eq!(
            ikaalinen.replace("pk_tek_tweb.htm", "pk_kokl_tweb.htm"),
            "https://ikaalinen.tweb.fi/ktwebscr/pk_kokl_tweb.htm"
        );

        let uurainen = "https://uurainen.tweb.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm";
        assert_eq!(
            uurainen.replace("pk_tek_tweb.htm", "pk_kokl_tweb.htm"),
            "https://uurainen.tweb.fi/ktwebbin/dbisa.dll/ktwebscr/pk_kokl_tweb.htm"
        );
    }

    #[test]
    fn rss_url_substitution() {
        let url = "https://akaa.tweb.fi/ktwebscr/pk_tek_tweb.htm";
        assert_eq!(
            url.replace("pk_tek_tweb.htm", "pk_rssfeed.htm?toimielin="),
            "https://akaa.tweb.fi/ktwebscr/pk_rssfeed.htm?toimielin="
        );
    }

    const RSS_FEED: &str = r#"<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0">
<channel>
<title>Pöytäkirjat</title>
<link></link>
<description>Pöytäkirjat</description>
<language>fi</language>
    <item>
      <title>Kaupunginhallitus: 5/2026 31.3.2026 18:00</title>
      <link>https://akaa.tweb.fi/ktwebscr/pk_asil_tweb.htm?bid=10515</link>
      <category>Kaupunginhallitus</category>
      <guid>https://akaa.tweb.fi/ktwebscr/pk_asil_tweb.htm?bid=10515</guid>
      <pubDate>Tue, 31 Mar 2026 18:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Sivistyslautakunta: 3/2026 25.3.2026 17:00</title>
      <link>/ktwebscr/pk_asil_tweb.htm?bid=10537</link>
      <category>Sivistyslautakunta</category>
      <guid>/ktwebscr/pk_asil_tweb.htm?bid=10537</guid>
      <pubDate>Wed, 25 Mar 2026 17:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Kaupunginhallitus: 5/2026 31.3.2026 18:00</title>
      <link>https://akaa.tweb.fi/ktwebscr/pk_asil_tweb.htm?bid=10515</link>
      <category>Kaupunginhallitus</category>
      <guid>https://akaa.tweb.fi/ktwebscr/pk_asil_tweb.htm?bid=10515</guid>
      <pubDate>Tue, 31 Mar 2026 18:00:00 GMT</pubDate>
    </item>
</channel>
</rss>"#;

    #[test]
    fn rss_parses_meetings_from_feed() {
        let meetings = parse_rss(RSS_FEED, "https://akaa.tweb.fi/ktwebscr/pk_tek_tweb.htm");
        assert_eq!(meetings.len(), 2, "duplicate bid should be deduped");
        assert_eq!(meetings[0].organ.as_deref(), Some("Kaupunginhallitus"));
        assert_eq!(meetings[0].id, "tweb-10515");
        assert!(meetings[0].date.is_some());
        assert_eq!(meetings[0].date.unwrap().to_string(), "2026-03-31");
    }

    #[test]
    fn rss_resolves_relative_links() {
        let meetings = parse_rss(RSS_FEED, "https://akaa.tweb.fi/ktwebscr/pk_tek_tweb.htm");
        // Second item has a relative link — should be resolved to absolute.
        assert!(
            meetings[1].page_url.starts_with("https://akaa.tweb.fi/"),
            "relative link should be resolved: {}",
            meetings[1].page_url
        );
    }
}
