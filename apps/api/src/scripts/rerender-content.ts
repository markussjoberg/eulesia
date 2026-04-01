/**
 * Re-render contentHtml for all content using the latest markdown pipeline.
 * Run this after updating the markdown renderer (e.g. adding YouTube/image embeds).
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/rerender-content.ts
 */

import {
  db,
  threads,
  comments,
  clubThreads,
  clubComments,
  roomThreads,
  roomComments,
  directMessages,
} from "../db/index.js";
import { renderMarkdown } from "../utils/markdown.js";
import { eq } from "drizzle-orm";

interface ContentRow {
  id: string;
  content: string;
}

async function rerenderTable(tableName: string, table: any) {
  console.log(`\n📝 Re-rendering ${tableName}...`);

  const rows: ContentRow[] = await db
    .select({ id: table.id, content: table.content })
    .from(table);

  let updated = 0;
  for (const row of rows) {
    const newHtml = renderMarkdown(row.content);
    await db
      .update(table)
      .set({ contentHtml: newHtml })
      .where(eq(table.id, row.id));
    updated++;
  }

  console.log(`   ✅ ${updated}/${rows.length} rows updated`);
}

async function main() {
  console.log("🔄 Re-rendering all contentHtml fields...\n");

  const tables = [
    ["threads", threads],
    ["comments", comments],
    ["clubThreads", clubThreads],
    ["clubComments", clubComments],
    ["roomThreads", roomThreads],
    ["roomComments", roomComments],
    ["directMessages", directMessages],
  ] as const;

  for (const [name, table] of tables) {
    await rerenderTable(name, table);
  }

  console.log("\n✅ All done!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
