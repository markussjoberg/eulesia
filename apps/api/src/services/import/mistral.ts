/**
 * Mistral AI Integration Service
 *
 * Uses Mistral Large for generating summaries of civic content.
 * Mistral is EU-based (Paris), GDPR-compliant.
 *
 * Minutes processing uses a 3-stage agentic pipeline:
 *  1. Editorial Gate — split minutes into items, decide newsworthiness
 *  2. Article Writing — write focused article from a single item excerpt
 *  3. Verification — cross-check article against original source text
 *
 * Supports multilingual content via language/prompts.ts.
 * The pipeline accepts an optional language parameter (default: 'fi').
 */

import {
  getPrompts,
  fillTemplate,
  getDefaultOrganLabel,
} from "./language/index.js";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

interface MistralMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MistralResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface SummaryResult {
  title: string;
  summary: string;
  tags: string[];
  keyPoints: string[];
}

/**
 * Rate limiting configuration.
 *
 * Configurable via MISTRAL_RATE_LIMIT_MS env var.
 * Default: 500ms (paid tier). Set to 2000 for free tier.
 */
const API_CALL_DELAY_MS = parseInt(
  process.env.MISTRAL_RATE_LIMIT_MS || "500",
  10,
);
const MAX_RETRIES = 5;
let lastCallTime = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until enough time has passed since the last API call.
 * Enforces a global rate limit across all Mistral calls.
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < API_CALL_DELAY_MS) {
    const waitMs = API_CALL_DELAY_MS - elapsed;
    console.log(`   ⏳ Rate limit: waiting ${Math.ceil(waitMs / 1000)}s...`);
    await sleep(waitMs);
  }
}

/**
 * Helper: call Mistral API with retry and rate limiting.
 * Handles 429 (rate limited) and 5xx errors with exponential backoff.
 */
async function callMistral(
  messages: MistralMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    /** Override model for this call. Defaults to MISTRAL_MODEL env var. */
    model?: string;
  },
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY not configured");
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Respect global rate limit
    await waitForRateLimit();

    lastCallTime = Date.now();

    let response: Response;
    try {
      response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model:
            options?.model ||
            process.env.MISTRAL_MODEL ||
            "mistral-small-latest",
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 2000,
          response_format: { type: "json_object" },
        }),
      });
    } catch (networkErr) {
      // Network-level error (DNS, connection reset, timeout)
      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.min(5_000 * Math.pow(2, attempt), 60_000);
        console.log(
          `   ⏳ Network error — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.ceil(backoffMs / 1000)}s: ${networkErr instanceof Error ? networkErr.message : networkErr}`,
        );
        await sleep(backoffMs);
        continue;
      }
      throw new Error(
        `Mistral network error after ${MAX_RETRIES} retries: ${networkErr instanceof Error ? networkErr.message : networkErr}`,
      );
    }

    if (response.ok) {
      const data = (await response.json()) as MistralResponse;
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error("Empty response from Mistral");
      }

      return content;
    }

    // Retry on rate limit (429) or server errors (5xx)
    const status = response.status;
    if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = response.headers.get("retry-after");
      const backoffMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(10_000 * Math.pow(2, attempt), 120_000); // 10s, 20s, 40s, 80s, 120s
      console.log(
        `   ⏳ Mistral ${status} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.ceil(backoffMs / 1000)}s`,
      );
      await sleep(backoffMs);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Mistral API error: ${status} - ${errorText}`);
  }

  throw new Error(`Mistral API: max retries (${MAX_RETRIES}) exceeded`);
}

// ============================================
// STAGE 1: EDITORIAL GATE (uutiskynnys)
// ============================================

export interface EditorialItem {
  itemNumber: string; // e.g. "§ 5"
  title: string; // Original title from minutes
  excerpt: string; // Verbatim excerpt from the source
  newsworthy: boolean; // Does this pass the editorial gate?
  reason: string; // Why newsworthy or not
}

/**
 * Attempt to recover items from truncated JSON response.
 * Mistral may hit the token limit and output incomplete JSON like:
 * {"items": [{"itemNumber":"§ 1",...}, {"itemNumber":"§ 2",...}, {"item
 * We extract all complete objects from the array.
 */
function recoverTruncatedJson(content: string): EditorialItem[] | null {
  // Find the items array start
  const arrayStart = content.indexOf("[");
  if (arrayStart === -1) return null;

  const items: EditorialItem[] = [];
  // Match complete JSON objects within the array
  const objRegex =
    /\{[^{}]*"itemNumber"\s*:\s*"[^"]*"[^{}]*"newsworthy"\s*:\s*(true|false)[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      items.push({
        itemNumber: obj.itemNumber || "§ ?",
        title: obj.title || "Nimetön asia",
        excerpt: obj.excerpt || "",
        newsworthy: obj.newsworthy ?? false,
        reason: obj.reason || "",
      });
    } catch {
      // Skip malformed objects
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Stage 1: Editorial Gate
 *
 * Splits meeting minutes into individual agenda items and decides
 * which ones are newsworthy. Filters out procedural/technical items.
 *
 * Supports multilingual content via the language parameter.
 */
export async function editorialGate(
  fullText: string,
  municipalityName: string,
  organ?: string,
  language: string = "fi",
): Promise<EditorialItem[]> {
  const prompts = getPrompts(language);
  const organLabel = organ || getDefaultOrganLabel(language);

  const truncatedText =
    fullText.slice(0, 30000) + (fullText.length > 30000 ? "\n\n[...]" : "");

  const systemPrompt = prompts.editorialGateSystem;
  const userPrompt = fillTemplate(prompts.editorialGateUser, {
    municipality: municipalityName,
    organ: organLabel,
    text: truncatedText,
  });

  const content = await callMistral(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 16000 },
  );

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.items || [];
    return items.map((item: EditorialItem) => ({
      itemNumber: item.itemNumber || "§ ?",
      title: item.title || "Nimetön asia",
      excerpt: item.excerpt || "",
      newsworthy: item.newsworthy ?? false,
      reason: item.reason || "",
    }));
  } catch {
    // Try to recover truncated JSON (Mistral may hit token limit mid-response)
    const recovered = recoverTruncatedJson(content);
    if (recovered && recovered.length > 0) {
      console.log(
        `   [editorial] Recovered ${recovered.length} items from truncated JSON`,
      );
      return recovered;
    }
    console.error(
      "Failed to parse editorial gate response:",
      content.slice(0, 200),
    );
    return [];
  }
}

// ============================================
// STAGE 2: ARTICLE WRITING
// ============================================

/**
 * Stage 2: Write Article
 *
 * Creates a focused civic article from a single agenda item excerpt.
 * Uses ONLY the provided excerpt + metadata — no hallucination.
 */
export async function writeArticle(
  excerpt: string,
  municipalityName: string,
  itemNumber: string,
  organ?: string,
  language: string = "fi",
): Promise<SummaryResult> {
  const prompts = getPrompts(language);
  const organLabel = organ || getDefaultOrganLabel(language);

  const systemPrompt = prompts.writeArticleSystem;
  const userPrompt = fillTemplate(prompts.writeArticleUser, {
    municipality: municipalityName,
    organ: organLabel,
    itemNumber,
    excerpt: excerpt.slice(0, 15000),
  });

  // Use MISTRAL_WRITE_MODEL for the writing stage if set (e.g. mistral-large-latest)
  const writeModel = process.env.MISTRAL_WRITE_MODEL || undefined;

  const content = await callMistral(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 4000, model: writeModel },
  );

  try {
    const parsed = JSON.parse(content) as SummaryResult;
    return {
      title: parsed.title || "Kunnan päätös",
      summary: parsed.summary || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    console.error("Failed to parse article response:", content.slice(0, 200));
    throw new Error("Invalid JSON response from Mistral (article)");
  }
}

// ============================================
// STAGE 3: VERIFICATION
// ============================================

export interface VerificationResult {
  passed: boolean;
  issues: string[]; // List of factual issues found
  severity: "none" | "minor" | "major"; // Overall severity
}

/**
 * Stage 3: Verify Article
 *
 * Cross-checks the written article against the original source text.
 * Catches hallucinations, wrong numbers, misattributions, etc.
 */
export async function verifyArticle(
  article: SummaryResult,
  originalExcerpt: string,
  municipalityName: string,
  language: string = "fi",
): Promise<VerificationResult> {
  const prompts = getPrompts(language);

  const systemPrompt = prompts.verifyArticleSystem;
  const userPrompt = fillTemplate(prompts.verifyArticleUser, {
    title: article.title,
    summary: article.summary,
    keyPoints: article.keyPoints.map((p) => `- ${p}`).join("\n"),
    municipality: municipalityName,
    excerpt: originalExcerpt.slice(0, 15000),
  });

  const content = await callMistral(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1, maxTokens: 1000 },
  );

  try {
    const parsed = JSON.parse(content);
    return {
      passed: parsed.passed ?? true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      severity: parsed.severity || "none",
    };
  } catch {
    // If verification itself fails, pass with warning
    console.error(
      "Failed to parse verification response:",
      content.slice(0, 200),
    );
    return {
      passed: true,
      issues: ["Verification parsing failed"],
      severity: "minor",
    };
  }
}

// ============================================
// LEGACY: single-call summary (kept for compatibility)
// ============================================

/**
 * Generate a civic-friendly summary of meeting minutes content
 * @deprecated Use the 3-stage pipeline (editorialGate → writeArticle → verifyArticle) instead
 */
export async function generateMinutesSummary(
  originalText: string,
  municipalityName: string,
  meetingType?: string,
): Promise<SummaryResult> {
  const systemPrompt = `Olet kansalaisfoorumin avustaja. Tehtäväsi on muuttaa kunnan pöytäkirja ymmärrettävään muotoon keskustelun pohjaksi.

Ohjeet:
- Kirjoita selkeästi, vältä kapulakieltä ja byrokratiakieltä
- Kerro mitä päätettiin ja miksi se vaikuttaa kunnan asukkaisiin
- Nosta esiin jos päätös ei ollut yksimielinen tai jos asiasta äänestettiin
- Ole neutraali - älä ota kantaa päätöksiin
- Älä keksi faktoja, käytä vain alkuperäistekstin tietoja

Vastaa JSON-muodossa:
{
  "title": "Selkeä otsikko päätökselle (max 100 merkkiä)",
  "summary": "2-4 kappaleen yhteenveto selkokielellä.",
  "tags": ["aihetunniste1", "aihetunniste2"],
  "keyPoints": ["Keskeisin päätös", "Toinen tärkeä asia"]
}`;

  const content = await callMistral([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Tee yhteenveto ${municipalityName}n kunnan ${meetingType || "kokouksen"} pöytäkirjasta:\n\n---\n${originalText.slice(0, 12000)}\n---\n\nVastaa vain JSON-muodossa.`,
    },
  ]);

  try {
    const parsed = JSON.parse(content) as SummaryResult;
    return {
      title: parsed.title || "Kunnan päätös",
      summary: parsed.summary || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    console.error("Failed to parse Mistral response:", content.slice(0, 200));
    throw new Error("Invalid JSON response from Mistral");
  }
}

/**
 * Extended result for ministry summaries — includes scope classification.
 */
export interface MinistrySummaryResult extends SummaryResult {
  scope: "national" | "local";
  /** Region/municipality name if scope is 'local' (e.g. "Kanta-Häme") */
  region?: string;
}

/**
 * Generate a civic-friendly summary of ministry/government content.
 * Also classifies scope: 'national' vs 'local' (regional decisions).
 */
export async function generateMinistrySummary(
  originalText: string,
  institutionName: string,
  contentType: string,
): Promise<MinistrySummaryResult> {
  const contentTypeLabel =
    contentType === "press"
      ? "tiedotteen"
      : contentType === "law"
        ? "lakiuutisen"
        : "päätöksen";

  const content = await callMistral([
    {
      role: "system",
      content: `Olet kansalaisfoorumin avustaja. Tehtäväsi on tiivistää ${institutionName}n ${contentTypeLabel} ymmärrettävään muotoon keskustelun pohjaksi.

Ohjeet:
- Kerro mitä päätettiin/tiedotetaan ja miksi se vaikuttaa kansalaisiin
- Kirjoita selkeästi, vältä kapulakieltä ja byrokratiakieltä
- Ole neutraali - älä ota kantaa
- Nosta esiin tärkeimmät kohdat
- Älä keksi faktoja, käytä vain alkuperäistekstin tietoja

Luokittele scope:
- "national": koskee koko Suomea (esim. verotus, lait, yleinen talouspolitiikka)
- "local": koskee yhtä tiettyä aluetta, kuntaa tai hyvinvointialuetta (esim. lainanottovaltuus Kanta-Hämeelle, Pohjois-Savon sairaalahanke)

Vastaa JSON-muodossa:
{
  "title": "Selkeä otsikko (max 100 merkkiä)",
  "summary": "2-4 kappaleen yhteenveto selkokielellä.",
  "tags": ["aihetunniste1", "aihetunniste2"],
  "keyPoints": ["Keskeisin asia", "Toinen tärkeä asia"],
  "scope": "national tai local",
  "region": "Alueen nimi jos local, muuten null"
}`,
    },
    {
      role: "user",
      content: `Tee yhteenveto seuraavasta ${institutionName}n ${contentTypeLabel}sta:\n\n---\n${originalText.slice(0, 12000)}\n---\n\nVastaa vain JSON-muodossa.`,
    },
  ]);

  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || `${institutionName}: päätös`,
      summary: parsed.summary || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      scope: parsed.scope === "local" ? "local" : "national",
      region: parsed.region || undefined,
    };
  } catch {
    console.error("Failed to parse Mistral response:", content.slice(0, 200));
    throw new Error("Invalid JSON response from Mistral");
  }
}

/**
 * Generate a civic-friendly summary of EU content (English → Finnish)
 */
export async function generateEuSummary(
  originalText: string,
  institutionName: string,
  contentType: string,
): Promise<SummaryResult> {
  const content = await callMistral([
    {
      role: "system",
      content: `You are a civic forum assistant. Your task is to summarize content from ${institutionName} for Finnish citizens.

Instructions:
- Explain what was decided or announced and how it affects EU citizens, particularly in Finland
- Write ALL output in Finnish (the source text may be in English)
- Be neutral and factual
- Avoid bureaucratic language, write in plain Finnish
- Highlight the most important points and concrete details (amounts, dates, countries, etc.)
- Do NOT fabricate facts — use ONLY information from the source text
- If the source text is short or lacks detail, write a concise summary based on what IS available
- NEVER write generic statements like "EU publishes press releases" — always be specific about THIS particular topic
- The title MUST be specific to the actual topic (e.g. "Komissio tukee EU:n itärajaseutuja 81 miljoonalla eurolla"), NOT generic

Respond in JSON format:
{
  "title": "Clear, specific title in Finnish (max 100 characters)",
  "summary": "2-4 paragraph summary in plain Finnish. Be specific about this topic.",
  "tags": ["tag1", "tag2"],
  "keyPoints": ["Specific key point 1 in Finnish", "Specific key point 2 in Finnish"]
}`,
    },
    {
      role: "user",
      content: `Summarize this ${institutionName} ${contentType} for Finnish citizens:\n\n---\n${originalText.slice(0, 12000)}\n---\n\nIMPORTANT: Be specific about this particular topic. Do NOT write generic EU descriptions. Respond ONLY in JSON format. All fields must be in Finnish.`,
    },
  ]);

  try {
    const parsed = JSON.parse(content) as SummaryResult;
    return {
      title: parsed.title || `${institutionName}: päätös`,
      summary: parsed.summary || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch {
    console.error("Failed to parse Mistral response:", content.slice(0, 200));
    throw new Error("Invalid JSON response from Mistral");
  }
}
