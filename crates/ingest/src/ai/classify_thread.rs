//! Thread content understanding via Mistral.
//!
//! A single Mistral call analyses a thread's title + content and returns a
//! comprehensive [`ContentUnderstanding`] struct: topic tags, detected
//! language, location hints, content type, quality signal, sentiment, and
//! named entities.
//!
//! The prompt is written in English so Mistral can handle any European
//! language, but it returns tags and entities in the content's own language.

use serde::{Deserialize, Serialize};

use crate::ai::mistral::MistralClient;
use crate::error::IngestError;

/// Full AI analysis of a single piece of user-generated content.
///
/// Fields marked "MVP" are used immediately after classification. All
/// other fields are stored in `threads.ai_analysis` for future features
/// (feed ranking, moderation dashboard, entity linking, scope suggestions).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentUnderstanding {
    // --- MVP: used immediately ---
    /// 1–5 topic tags in the content's language, lowercase.
    #[serde(default)]
    pub tags: Vec<String>,

    /// ISO 639-1 language code detected from the content.
    #[serde(default = "default_language")]
    pub language: String,

    /// Place names, districts, streets mentioned in the content that are
    /// more specific than the thread's municipality-level location.
    #[serde(default)]
    pub location_hints: Vec<String>,

    // --- Stored now, acted on later ---
    /// Suggested geographic scope: "local", "national", or "european".
    #[serde(default)]
    pub scope_hint: Option<String>,

    /// What kind of post this is.
    #[serde(default)]
    pub content_type: Option<String>,

    /// Content quality signal: 0.0 (spam/gibberish) to 1.0 (high-quality
    /// civic discourse). Used for auto-flag moderation.
    #[serde(default)]
    pub quality_score: Option<f32>,

    /// Dominant sentiment of the post.
    #[serde(default)]
    pub sentiment: Option<String>,

    /// Named entities mentioned in the content. Person names are excluded
    /// to avoid unnecessary personal data processing (GDPR).
    #[serde(default)]
    pub entities: Vec<Entity>,
}

fn default_language() -> String {
    "fi".to_string()
}

/// A named entity extracted from the content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub name: String,
    /// One of: "organization", "law", "place", "event".
    /// Person names are intentionally excluded.
    pub entity_type: String,
}

const SYSTEM_PROMPT: &str = r#"You are a content analysis engine for a European civic democracy platform. Analyse the given post (title + body) and return a JSON object with these fields:

"tags" — 1 to 5 topic tags that describe the subject matter. Tags MUST be in the SAME LANGUAGE as the content, lowercase. Examples (Finnish): kaavoitus, liikenne, koulutus, terveys, ympäristö, asuminen, kulttuuri, talous, turvallisuus, infrastruktuuri, sosiaalipalvelut, urheilu, luonto, politiikka. You are NOT limited to these examples.

"language" — ISO 639-1 code of the content language (e.g. "fi", "sv", "en", "et", "de", "fr").

"locationHints" — specific places mentioned that are more precise than a municipality: districts, streets, named landmarks, schools, parks. Return an empty array if no sub-municipal locations are mentioned. Do NOT include the municipality name itself.

"scopeHint" — geographic scope: "local" (affects one municipality), "national" (affects the country), or "european" (affects the EU/Europe).

"contentType" — one of: "question", "opinion", "news", "announcement", "discussion".

"qualityScore" — a number from 0.0 to 1.0 rating the quality of the post as civic discourse. 0.0 = spam, gibberish, or empty. 0.3 = very low effort or off-topic. 0.7 = reasonable civic contribution. 1.0 = well-argued, sourced, constructive.

"sentiment" — one of: "neutral", "positive", "negative", "constructive", "critical", "hateful". Use "hateful" only for content containing hate speech, threats, or severe toxicity.

"entities" — named entities mentioned in the text. Each has "name" and "entityType". Valid types: "organization", "law", "place", "event". Do NOT extract person names — only organizations, laws/regulations, places, and events.

Respond with valid JSON only. No markdown fences."#;

/// Classify a thread's content using Mistral.
///
/// Returns the full [`ContentUnderstanding`]. Callers decide which fields
/// to act on and which to just store.
pub async fn classify_thread(
    client: &MistralClient,
    title: &str,
    content: &str,
) -> Result<ContentUnderstanding, IngestError> {
    let user_prompt = if title.is_empty() {
        content.to_string()
    } else {
        format!("Title: {title}\n\n{content}")
    };

    // Cap at ~8000 chars to stay within model context.
    let truncated = if user_prompt.chars().count() > 8000 {
        let mut s: String = user_prompt.chars().take(8000).collect();
        s.push_str("\n\n[...]");
        s
    } else {
        user_prompt
    };

    client
        .call_json("classify_thread", SYSTEM_PROMPT, &truncated, 0.1, 800)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_full_response() {
        let json = r#"{
            "tags": ["kaavoitus", "asuminen"],
            "language": "fi",
            "locationHints": ["Hervanta"],
            "scopeHint": "local",
            "contentType": "opinion",
            "qualityScore": 0.8,
            "sentiment": "constructive",
            "entities": [
                {"name": "Tampereen kaupunki", "entityType": "organization"}
            ]
        }"#;
        let cu: ContentUnderstanding = serde_json::from_str(json).unwrap();
        assert_eq!(cu.tags, vec!["kaavoitus", "asuminen"]);
        assert_eq!(cu.language, "fi");
        assert_eq!(cu.location_hints, vec!["Hervanta"]);
        assert_eq!(cu.scope_hint.as_deref(), Some("local"));
        assert_eq!(cu.content_type.as_deref(), Some("opinion"));
        assert!((cu.quality_score.unwrap() - 0.8).abs() < f32::EPSILON);
        assert_eq!(cu.sentiment.as_deref(), Some("constructive"));
        assert_eq!(cu.entities.len(), 1);
        assert_eq!(cu.entities[0].entity_type, "organization");
    }

    #[test]
    fn deserializes_minimal_response() {
        let json = r#"{"tags": ["test"], "language": "en"}"#;
        let cu: ContentUnderstanding = serde_json::from_str(json).unwrap();
        assert_eq!(cu.tags, vec!["test"]);
        assert_eq!(cu.language, "en");
        assert!(cu.location_hints.is_empty());
        assert!(cu.scope_hint.is_none());
        assert!(cu.quality_score.is_none());
        assert!(cu.entities.is_empty());
    }

    #[test]
    fn deserializes_empty_tags_gracefully() {
        let json = r#"{}"#;
        let cu: ContentUnderstanding = serde_json::from_str(json).unwrap();
        assert!(cu.tags.is_empty());
        assert_eq!(cu.language, "fi"); // default
    }
}
