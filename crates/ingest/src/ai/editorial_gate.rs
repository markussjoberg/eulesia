//! Stage 1: editorial gate.
//!
//! Splits raw minutes text into individual agenda items (`§ N`) and decides
//! which ones are newsworthy enough for publication. Procedural boilerplate
//! (opening, legality, minute-taker selection, adjournment) is filtered out
//! by the model.
//!
//! Long minutes are split into chunks at `§` boundaries before sending to
//! Mistral. Each chunk is classified independently, then results are merged.
//! This avoids the output token limit — Mistral needs to echo back the
//! full excerpt for each item, so a 15-pykälä meeting with 2000-char
//! excerpts easily exceeds 8000 output tokens.

use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::ai::mistral::MistralClient;
use crate::ai::prompts_fi::{EDITORIAL_GATE_SYSTEM, EDITORIAL_GATE_USER, fill_template};
use crate::error::IngestError;

/// A single agenda item produced by the editorial gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorialItem {
    #[serde(rename = "itemNumber")]
    pub item_number: String,
    pub title: String,
    pub excerpt: String,
    pub newsworthy: bool,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
struct EditorialGateResponse {
    items: Vec<EditorialItem>,
}

/// Maximum characters per chunk sent to the model. Each chunk should contain
/// 3–5 §-items so the model has enough context to judge newsworthiness but
/// the output stays well within token limits.
const MAX_CHUNK_CHARS: usize = 12_000;

/// Run the editorial gate on the full minutes text.
///
/// If the text is short enough it goes in a single call. Long texts are
/// split at `§` boundaries into chunks of ~12k chars, each classified
/// independently, then results merged.
pub async fn editorial_gate(
    client: &MistralClient,
    full_text: &str,
    municipality: &str,
    organ: Option<&str>,
) -> Result<Vec<EditorialItem>, IngestError> {
    let chunks = split_into_chunks(full_text);
    debug!(
        chunks = chunks.len(),
        total_chars = full_text.len(),
        "editorial gate chunking"
    );

    let mut all_items = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        debug!(chunk = i + 1, chars = chunk.len(), "processing chunk");
        match classify_chunk(client, chunk, municipality, organ).await {
            Ok(items) => all_items.extend(items),
            Err(e) => {
                // Log and continue — partial results are better than none.
                tracing::warn!(
                    chunk = i + 1,
                    error = %e,
                    "editorial gate chunk failed, skipping"
                );
            }
        }
    }

    Ok(all_items)
}

async fn classify_chunk(
    client: &MistralClient,
    chunk: &str,
    municipality: &str,
    organ: Option<&str>,
) -> Result<Vec<EditorialItem>, IngestError> {
    let organ_label = organ.unwrap_or("toimielin");
    let user_prompt = fill_template(
        EDITORIAL_GATE_USER,
        &[
            ("municipality", municipality),
            ("organ", organ_label),
            ("text", chunk),
        ],
    );

    let response: EditorialGateResponse = client
        .call_json(
            "editorial_gate",
            EDITORIAL_GATE_SYSTEM,
            &user_prompt,
            0.1,
            8_000,
        )
        .await?;

    Ok(response.items)
}

/// Split minutes text into chunks at `§` boundaries.
///
/// Each chunk contains one or more complete §-sections and stays under
/// [`MAX_CHUNK_CHARS`]. If a single §-section exceeds the limit it goes
/// into its own chunk (truncated if necessary).
fn split_into_chunks(text: &str) -> Vec<String> {
    // Split on § markers, keeping the § as part of each section.
    let sections = split_on_paragraph_markers(text);

    if sections.len() <= 1 || text.chars().count() <= MAX_CHUNK_CHARS {
        // Short enough for a single call.
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for section in sections {
        if current.chars().count() + section.chars().count() > MAX_CHUNK_CHARS {
            if !current.is_empty() {
                chunks.push(current);
                current = String::new();
            }
            // If a single section is too large, truncate it.
            if section.chars().count() > MAX_CHUNK_CHARS {
                let truncated: String = section.chars().take(MAX_CHUNK_CHARS).collect();
                chunks.push(truncated);
                continue;
            }
        }
        current.push_str(&section);
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

/// Split text into sections at `§` markers.
///
/// Returns a vec where each element starts with `§` (except possibly the
/// first element which is the preamble before the first §).
fn split_on_paragraph_markers(text: &str) -> Vec<String> {
    let mut sections = Vec::new();
    let mut current = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        // New section starts when line begins with § (possibly preceded by whitespace).
        if trimmed.starts_with('§') && !current.is_empty() {
            sections.push(current);
            current = String::new();
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.is_empty() {
        sections.push(current);
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_single_chunk() {
        let chunks = split_into_chunks("hello");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "hello");
    }

    #[test]
    fn splits_on_paragraph_markers() {
        let text =
            "Preamble\n§ 1 Opening\nContent 1\n§ 2 Budget\nContent 2\n§ 3 Close\nContent 3\n";
        let sections = split_on_paragraph_markers(text);
        assert_eq!(sections.len(), 4); // preamble + 3 sections
        assert!(sections[1].starts_with("§ 1"));
        assert!(sections[2].starts_with("§ 2"));
        assert!(sections[3].starts_with("§ 3"));
    }

    #[test]
    fn chunks_respect_size_limit() {
        // Build a text with 10 sections of ~3000 chars each = ~30k total.
        let mut text = String::new();
        for i in 1..=10 {
            text.push_str(&format!("§ {i} Title {i}\n"));
            text.push_str(&"x".repeat(2900));
            text.push('\n');
        }
        let chunks = split_into_chunks(&text);
        assert!(chunks.len() >= 3, "should split into multiple chunks");
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= MAX_CHUNK_CHARS + 100,
                "chunk too large: {} chars",
                chunk.chars().count()
            );
        }
    }

    #[test]
    fn single_huge_section_gets_own_chunk() {
        let mut text = String::from("§ 1 Short\nhi\n");
        text.push_str("§ 2 Huge\n");
        text.push_str(&"x".repeat(15_000));
        text.push_str("\n§ 3 After\nbye\n");
        let chunks = split_into_chunks(&text);
        assert!(chunks.len() >= 2);
    }
}
