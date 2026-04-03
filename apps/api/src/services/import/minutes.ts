/**
 * Municipal Meeting Minutes Import Service
 *
 * Imports meeting minutes from European municipalities and creates
 * AI-summarized Agora threads for civic discussion.
 *
 * Supports multilingual content (FI, SE, NO, DK, EE, DE).
 *
 * Each system has its own fetcher in ./fetchers/ implementing the
 * MinuteFetcher interface. This module orchestrates the import pipeline.
 *
 * Uses round-robin scheduling so all municipalities get content
 * even with rate limits.
 *
 * Based on work from github.com/Explories/rautalampi-news
 */

import { db, threads, threadTags, municipalities } from "../../db/index.js";
import { eq, and, gte } from "drizzle-orm";
import { editorialGate, writeArticle, verifyArticle } from "./mistral.js";
import { renderMarkdown } from "../../utils/markdown.js";
import {
  fetchers,
  MINUTE_SOURCES,
  getMinuteSources,
} from "./fetchers/index.js";
import type { MinuteSource, Meeting } from "./fetchers/index.js";
import {
  getOrCreateBotUser,
  getOrCreateInstitution,
  resolveLocationForEntity,
} from "./institutions.js";
import { getEntityName, getAdminLevel } from "./fetchers/types.js";
import { recordSuccess, recordFailure } from "./adaptive/health-monitor.js";
import {
  parseDate as parseMultiDate,
  getPrompts,
  getLanguageForCountry,
} from "./language/index.js";

// Re-export for backwards compatibility
export { MINUTE_SOURCES };
export type { MinuteSource };

// ============================================
// IMPORT LOGIC
// ============================================

export interface ImportOptions {
  municipalities?: string[]; // Filter by municipality names
  dryRun?: boolean;
  limit?: number; // Max meetings per municipality
  maxAgeDays?: number; // Only import meetings newer than this (default: 7)
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  threads: { id: string; title: string; municipality: string }[];
}

/**
 * Filter meetings to only include recent ones.
 * Uses the multilingual date parser for all European formats.
 * Meetings without a parseable date are EXCLUDED to prevent
 * old (undated) meetings from slipping through.
 */
function filterRecentMeetings(
  meetings: Meeting[],
  maxAgeDays: number,
  language?: string,
): Meeting[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  return meetings.filter((m) => {
    if (!m.date) {
      console.log(`   ⏭️  Skipping undated meeting: ${m.title}`);
      return false;
    }
    const meetingDate = parseMultiDate(m.date, language);
    if (!meetingDate) {
      console.log(`   ⏭️  Skipping unparseable date "${m.date}": ${m.title}`);
      return false;
    }
    return meetingDate >= cutoff;
  });
}

/**
 * Get municipality ID by name, or create if not exists
 */
async function getOrCreateMunicipality(
  name: string,
  country: string = "FI",
): Promise<string> {
  const normalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

  const existing = await db
    .select({ id: municipalities.id })
    .from(municipalities)
    .where(
      and(
        eq(municipalities.name, normalized),
        eq(municipalities.country, country),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db
    .insert(municipalities)
    .values({
      name: normalized,
      nameFi: country === "FI" ? normalized : undefined,
      country,
    })
    .returning({ id: municipalities.id });

  return created.id;
}

/**
 * Check if meeting has already been imported
 */
async function isAlreadyImported(sourceId: string): Promise<boolean> {
  const existing = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(eq(threads.sourceId, sourceId), eq(threads.source, "minutes_import")),
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Check if a similar article already exists for this municipality.
 * Uses word-level Jaccard similarity on titles to detect near-duplicates.
 */
async function findSimilarExisting(
  title: string,
  municipalityId: string | undefined,
  thresholdDays: number = 30,
): Promise<{ id: string; title: string } | null> {
  if (!municipalityId) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);

  const recentThreads = await db
    .select({ id: threads.id, title: threads.title })
    .from(threads)
    .where(
      and(
        eq(threads.source, "minutes_import"),
        eq(threads.municipalityId, municipalityId),
        gte(threads.createdAt, cutoff),
      ),
    )
    .limit(200);

  const titleWords = new Set(
    title
      .toLowerCase()
      .replace(/[^a-zäöåüé\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (titleWords.size === 0) return null;

  for (const existing of recentThreads) {
    if (!existing.title) continue;
    const existingWords = new Set(
      existing.title
        .toLowerCase()
        .replace(/[^a-zäöåüé\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
    if (existingWords.size === 0) continue;

    // Jaccard similarity: |intersection| / |union|
    let intersection = 0;
    for (const w of titleWords) {
      if (existingWords.has(w)) intersection++;
    }
    const union = new Set([...titleWords, ...existingWords]).size;
    const similarity = intersection / union;

    if (similarity > 0.5) {
      return { id: existing.id, title: existing.title };
    }
  }

  return null;
}

/** Maximum newsworthy items to process per single meeting */
const MAX_ITEMS_PER_MEETING = 5;

/**
 * Extract the full text of a § section from meeting minutes.
 * Returns everything from the § heading to the next § or end of text.
 * Falls back to null if the section can't be found.
 */
function extractFullSection(
  fullText: string,
  itemNumber: string,
): string | null {
  // Normalize: "§ 119" → "119", "§119" → "119"
  const sectionNum = itemNumber.replace(/§\s*/, "").trim();
  if (!sectionNum) return null;

  // Match "§ 119" or "§119" with word boundary after the number
  const pattern = new RegExp(`§\\s*${sectionNum}\\b`);
  const match = pattern.exec(fullText);
  if (!match) return null;

  // Find end: next § marker or end of text
  const start = match.index;
  const nextSectionPattern = /§\s*\d+/g;
  nextSectionPattern.lastIndex = start + match[0].length;
  const next = nextSectionPattern.exec(fullText);
  const end = next ? next.index : fullText.length;

  const section = fullText.slice(start, end).trim();
  return section.length > 0 ? section.slice(0, 15000) : null;
}

/**
 * Process a single meeting through the 3-stage AI pipeline.
 */
async function processMeeting(
  meeting: Meeting,
  source: MinuteSource,
  botUserId: string,
  result: ImportResult,
): Promise<void> {
  const sourceId = `${source.municipality.toLowerCase()}-${meeting.id}`;
  const fetcher = fetchers[source.type];

  // Extract content via fetcher (handles PDF/HTML per system)
  const originalText = await fetcher.extractContent(meeting, source);
  if (!originalText) {
    result.errors.push(`No content found for ${sourceId}`);
    return;
  }

  // Get entity identity, institution placeholder, and geographic location
  const entityName = getEntityName(source);
  const adminLevel = getAdminLevel(source);
  const country = source.country || "FI";
  const municipalityId =
    adminLevel === "municipality"
      ? await getOrCreateMunicipality(entityName, country)
      : undefined; // Higher admin levels don't need a municipality record
  const normalizedName =
    entityName.charAt(0).toUpperCase() + entityName.slice(1).toLowerCase();
  const sourceInstitutionId = await getOrCreateInstitution(
    normalizedName,
    adminLevel, // Uses the actual admin level: 'municipality', 'county', 'region', or 'state'
    {
      municipalityName: adminLevel === "municipality" ? entityName : undefined,
      country,
    },
  );
  const locationId = await resolveLocationForEntity(normalizedName, country);

  // ============================================
  // 3-STAGE AGENTIC PIPELINE
  // ============================================

  // Determine content language for multilingual pipeline
  const language =
    source.language || getLanguageForCountry(source.country || "FI");
  const prompts = getPrompts(language);

  // STAGE 1: Editorial Gate — split & filter newsworthy items
  console.log(`   🔍 Stage 1: Editorial gate... (${language})`);
  const editorialItems = await editorialGate(
    originalText,
    source.municipality,
    meeting.organ,
    language,
  );

  const allNewsworthy = editorialItems.filter((item) => item.newsworthy);
  const skippedItems = editorialItems.filter((item) => !item.newsworthy);

  // Cap newsworthy items per meeting to prevent feed flooding
  const newsworthyItems = allNewsworthy.slice(0, MAX_ITEMS_PER_MEETING);
  const cappedCount = allNewsworthy.length - newsworthyItems.length;

  console.log(
    `   📊 ${allNewsworthy.length} newsworthy / ${skippedItems.length} filtered out${cappedCount > 0 ? ` (capped ${cappedCount})` : ""}`,
  );

  if (skippedItems.length > 0) {
    console.log(
      `   ⏭️  Filtered: ${skippedItems.map((i) => i.title).join(", ")}`,
    );
  }

  const sourceUrl = meeting.pageUrl;

  // Process each newsworthy item as a separate thread
  for (const item of newsworthyItems) {
    const itemSourceId = `${sourceId}-${item.itemNumber.replace(/\s+/g, "")}`;

    if (await isAlreadyImported(itemSourceId)) {
      console.log(`   ⏭️  Already imported: ${item.itemNumber} ${item.title}`);
      result.skipped++;
      continue;
    }

    try {
      // Extract full section from original text for better context
      const fullSection = extractFullSection(originalText, item.itemNumber);
      const articleExcerpt = fullSection || item.excerpt;

      if (fullSection) {
        console.log(
          `   📄 Full section: ${fullSection.length} chars (vs ${item.excerpt.length} char excerpt)`,
        );
      }

      // STAGE 2: Write article from full section text
      console.log(`   ✍️  Stage 2: Writing ${item.itemNumber}...`);
      const article = await writeArticle(
        articleExcerpt,
        source.municipality,
        item.itemNumber,
        meeting.organ,
        language,
      );

      // DEDUP CHECK: Is there a similar article already?
      const similar = await findSimilarExisting(article.title, municipalityId);
      if (similar) {
        console.log(
          `   ⏭️  Similar article exists: "${similar.title}" — skipping ${item.itemNumber}`,
        );
        result.skipped++;
        continue;
      }

      // STAGE 3: Verify against full section text
      console.log(`   ✓  Stage 3: Verifying ${item.itemNumber}...`);
      const verification = await verifyArticle(
        article,
        articleExcerpt,
        source.municipality,
        language,
      );

      if (!verification.passed && verification.severity === "major") {
        console.log(
          `   ⚠️  Verification FAILED for ${item.itemNumber}: ${verification.issues.join("; ")}`,
        );
        result.errors.push(
          `${itemSourceId}: verification failed — ${verification.issues.join("; ")}`,
        );
        continue;
      }

      if (verification.issues.length > 0) {
        console.log(`   ℹ️  Minor issues: ${verification.issues.join("; ")}`);
      }

      // Build thread content (language-aware)
      const footerText = prompts.footerTemplate.replace(
        "{sourceUrl}",
        sourceUrl,
      );
      const content = `${article.summary}

<div class="summary-keypoints">

${prompts.keyPointsHeader}
${article.keyPoints.map((p) => `- ${p}`).join("\n")}

</div>

<div class="summary-footer">

${footerText}

</div>`;

      const contentHtml = renderMarkdown(content);

      // Create thread
      const [thread] = await db
        .insert(threads)
        .values({
          title: article.title,
          content,
          contentHtml,
          authorId: botUserId,
          scope: "local",
          municipalityId,
          locationId,
          sourceInstitutionId,
          source: "minutes_import",
          sourceUrl,
          sourceId: itemSourceId,
          aiGenerated: true,
          aiModel: process.env.MISTRAL_MODEL || "mistral-small-latest",
          originalContent: articleExcerpt.slice(0, 50000),
          institutionalContext: {
            type: "minutes",
            meetingId: meeting.id,
            itemNumber: item.itemNumber,
            organ: meeting.organ,
            sourceSystem: source.type,
            verificationPassed: verification.passed,
            verificationSeverity: verification.severity,
            verificationIssues: verification.issues,
            importedAt: new Date().toISOString(),
          },
        })
        .returning({ id: threads.id });

      // Add tags (language-aware default tag)
      const allTags = [...article.tags, prompts.defaultTag];
      const uniqueTags = [...new Set(allTags)].slice(0, 10);

      for (const tag of uniqueTags) {
        await db
          .insert(threadTags)
          .values({
            threadId: thread.id,
            tag: tag.toLowerCase(),
          })
          .onConflictDoNothing();
      }

      result.imported++;
      result.threads.push({
        id: thread.id,
        title: article.title,
        municipality: source.municipality,
      });

      console.log(`   ✅ Created: ${article.title}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${itemSourceId}: ${msg}`);
      console.log(`   ❌ Item error: ${msg}`);
    }
  }
}

/**
 * Import meeting minutes from configured sources.
 *
 * Uses round-robin scheduling: processes one NEW meeting per municipality
 * per round, so all municipalities get content even with slow rate limits.
 * This prevents early municipalities from starving later ones.
 *
 * Phase 1: Fetch meeting lists from all municipalities (fast, no AI calls)
 * Phase 2: Round-robin — pick one new meeting per municipality, process it,
 *          then move to the next municipality. Repeat until done.
 */
export async function importMinutes(
  options: ImportOptions = {},
): Promise<ImportResult> {
  const {
    municipalities: filterMunicipalities,
    dryRun = false,
    limit = 5,
    maxAgeDays = 7,
  } = options;

  console.log("📋 Starting municipal minutes import...");
  console.log(`   Dry run: ${dryRun}`);
  console.log(`   Limit per municipality: ${limit}`);
  console.log(`   Max age: ${maxAgeDays} days`);

  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    threads: [],
  };

  // Load all sources: static (hand-coded) + adaptive (DB-configured)
  let sources = await getMinuteSources();
  if (filterMunicipalities?.length) {
    const filterLower = filterMunicipalities.map((m) => m.toLowerCase());
    sources = sources.filter((s) =>
      filterLower.includes(s.municipality.toLowerCase()),
    );
  }

  console.log(`   Processing ${sources.length} municipalities`);

  // Get bot user for authorship
  const botUserId = dryRun ? "dry-run-id" : await getOrCreateBotUser();

  // ============================================
  // PHASE 1: Fetch meeting lists for ALL municipalities (fast, no AI)
  // ============================================
  console.log("\n📡 Phase 1: Fetching meeting lists...");

  const sourcesWithMeetings: { source: MinuteSource; meetings: Meeting[] }[] =
    [];

  for (const source of sources) {
    const fetcher = fetchers[source.type];
    if (!fetcher) {
      console.log(`   ⚠️  ${source.type} not supported`);
      continue;
    }

    try {
      const allMeetings = await fetcher.fetchMeetings(source);
      const sourceLang =
        source.language || getLanguageForCountry(source.country || "FI");
      const meetings = filterRecentMeetings(
        allMeetings,
        maxAgeDays,
        sourceLang,
      );
      console.log(
        `   ${source.municipality}: ${meetings.length} recent / ${allMeetings.length} total`,
      );
      sourcesWithMeetings.push({ source, meetings: meetings.slice(0, limit) });

      // Record success for adaptive sources
      if (source.configId) {
        await recordSuccess(source.configId).catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${source.municipality}: ${msg}`);
      console.log(`   ❌ ${source.municipality}: ${msg}`);

      // Record failure for adaptive sources
      if (source.configId) {
        await recordFailure(source.configId, msg).catch(() => {});
      }
    }
  }

  // ============================================
  // PHASE 2: Round-robin — one new meeting per municipality per round
  // ============================================
  console.log(
    `\n🔄 Phase 2: Round-robin processing across ${sourcesWithMeetings.length} municipalities...`,
  );

  // Track which meeting index each municipality is at
  const meetingIndex: number[] = sourcesWithMeetings.map(() => 0);

  let roundNumber = 0;
  let anyProgress = true;

  while (anyProgress) {
    anyProgress = false;
    roundNumber++;
    console.log(`\n--- Round ${roundNumber} ---`);

    for (let i = 0; i < sourcesWithMeetings.length; i++) {
      const { source, meetings } = sourcesWithMeetings[i];

      // Find next un-imported meeting for this municipality
      let processed = false;
      while (!processed && meetingIndex[i] < meetings.length) {
        const meeting = meetings[meetingIndex[i]];
        meetingIndex[i]++;

        const sourceId = `${source.municipality.toLowerCase()}-${meeting.id}`;

        if (!dryRun && (await isAlreadyImported(sourceId))) {
          result.skipped++;
          continue;
        }

        // Found an un-imported meeting — process it
        console.log(`\n🏛️  ${source.municipality}: ${meeting.title}`);
        processed = true;
        anyProgress = true;

        if (dryRun) {
          result.imported++;
          break;
        }

        try {
          await processMeeting(meeting, source, botUserId, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`${sourceId}: ${msg}`);
          console.log(`   ❌ Error: ${msg}`);
        }

        // Only process one meeting per municipality per round
        break;
      }
    }
  }

  console.log("\n✅ Import complete:");
  console.log(`   Imported: ${result.imported}`);
  console.log(`   Skipped: ${result.skipped}`);
  console.log(`   Errors: ${result.errors.length}`);

  return result;
}

/**
 * List available municipalities for import
 */
export async function getAvailableMunicipalities(): Promise<string[]> {
  const sources = await getMinuteSources();
  return sources.map((s) => s.municipality);
}
