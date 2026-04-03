#!/usr/bin/env npx tsx
/**
 * Municipal Minutes Import CLI
 *
 * Usage:
 *   npm run import:minutes                    # Import all municipalities
 *   npm run import:minutes -- --dry-run       # Test without writing to DB
 *   npm run import:minutes -- --municipality=Rautalampi
 *   npm run import:minutes -- --limit=3
 *   npm run import:minutes -- --municipality=Rautalampi --purge  # Delete old + re-import
 *   npm run import:minutes -- --max-age=30   # Include older meetings (default: 7 days)
 */

import "dotenv/config";
import { importMinutes, getAvailableMunicipalities } from "./minutes.js";
import { db, threads } from "../../db/index.js";
import { eq, and, like } from "drizzle-orm";

/**
 * Hard-delete all minutes_import threads for a municipality.
 * Cascade removes tags, comments, and votes.
 */
async function purgeMinutesThreads(municipality: string): Promise<number> {
  const pattern = `${municipality.toLowerCase()}-%`;

  const deleted = await db
    .delete(threads)
    .where(
      and(
        eq(threads.source, "minutes_import"),
        like(threads.sourceId, pattern),
      ),
    )
    .returning({ id: threads.id });

  return deleted.length;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes("--dry-run");
  const listOnly = args.includes("--list");
  const purge = args.includes("--purge");

  const municipalityArg = args.find((a) => a.startsWith("--municipality="));
  const municipalities = municipalityArg
    ? [municipalityArg.split("=")[1]]
    : undefined;

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 5;

  const maxAgeArg = args.find((a) => a.startsWith("--max-age="));
  const maxAgeDays = maxAgeArg ? parseInt(maxAgeArg.split("=")[1], 10) : 7;

  if (listOnly) {
    console.log("Available municipalities:");
    for (const m of await getAvailableMunicipalities()) {
      console.log(`  - ${m}`);
    }
    return;
  }

  // --purge requires --municipality
  if (purge && !municipalities) {
    console.error("ERROR: --purge requires --municipality=<name>");
    process.exit(1);
  }

  console.log("=".repeat(50));
  console.log("MUNICIPAL MINUTES IMPORT");
  console.log("=".repeat(50));
  console.log();

  // Purge existing threads if requested
  if (purge && municipalities) {
    for (const m of municipalities) {
      if (dryRun) {
        console.log(`🔒 DRY RUN: Would purge all minutes threads for ${m}`);
      } else {
        console.log(`🗑️  Purging existing minutes threads for ${m}...`);
        const count = await purgeMinutesThreads(m);
        console.log(
          `   ✅ Deleted ${count} thread(s) (cascade: tags, comments, votes)`,
        );
      }
    }
    console.log();
  }

  const result = await importMinutes({
    municipalities,
    dryRun,
    limit,
    maxAgeDays,
  });

  console.log();
  console.log("=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Imported: ${result.imported}`);
  console.log(`Skipped:  ${result.skipped}`);
  console.log(`Errors:   ${result.errors.length}`);

  if (result.threads.length > 0) {
    console.log();
    console.log("Created threads:");
    for (const t of result.threads) {
      console.log(`  [${t.municipality}] ${t.title}`);
    }
  }

  if (result.errors.length > 0) {
    console.log();
    console.log("Errors:");
    for (const e of result.errors) {
      console.log(`  - ${e}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
