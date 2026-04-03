import { Router, type Request, type Response } from "express";
import { db, threads, municipalities, clubs, users } from "../db/index.js";
import { eq, desc } from "drizzle-orm";

const router = Router();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(date: Date | string | null): string {
  if (!date) return new Date().toISOString().split("T")[0];
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

router.get("/sitemap.xml", async (_req: Request, res: Response) => {
  try {
    const appUrl = process.env.APP_URL || "https://eulesia.org";

    // Static pages
    const staticPages = [
      { loc: "/", changefreq: "weekly", priority: "1.0" },
      { loc: "/about", changefreq: "monthly", priority: "0.8" },
      { loc: "/terms", changefreq: "monthly", priority: "0.5" },
      { loc: "/privacy", changefreq: "monthly", priority: "0.5" },
      { loc: "/agora", changefreq: "hourly", priority: "0.9" },
      { loc: "/aiheet", changefreq: "daily", priority: "0.7" },
      { loc: "/kunnat", changefreq: "weekly", priority: "0.7" },
    ];

    // Dynamic: threads (most recent 5000)
    const threadRows = await db
      .select({
        id: threads.id,
        updatedAt: threads.updatedAt,
      })
      .from(threads)
      .where(eq(threads.isHidden, false))
      .orderBy(desc(threads.updatedAt))
      .limit(5000);

    // Dynamic: municipalities
    const municipalityRows = await db
      .select({
        id: municipalities.id,
      })
      .from(municipalities);

    // Dynamic: public clubs
    const clubRows = await db
      .select({
        id: clubs.id,
        updatedAt: clubs.updatedAt,
      })
      .from(clubs)
      .where(eq(clubs.isPublic, true))
      .orderBy(desc(clubs.updatedAt))
      .limit(5000);

    // Dynamic: user profiles (most recent 5000)
    const userRows = await db
      .select({
        id: users.id,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.updatedAt))
      .limit(5000);

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    for (const page of staticPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(appUrl)}${escapeXml(page.loc)}</loc>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    // Threads
    for (const row of threadRows) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(appUrl)}/agora/thread/${escapeXml(row.id)}</loc>\n`;
      xml += `    <lastmod>${formatDate(row.updatedAt)}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
    }

    // Municipalities
    for (const row of municipalityRows) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(appUrl)}/kunnat/${escapeXml(row.id)}</loc>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
    }

    // Public clubs
    for (const row of clubRows) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(appUrl)}/clubs/${escapeXml(row.id)}</loc>\n`;
      xml += `    <lastmod>${formatDate(row.updatedAt)}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>0.5</priority>\n`;
      xml += `  </url>\n`;
    }

    // User profiles
    for (const row of userRows) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(appUrl)}/user/${escapeXml(row.id)}</loc>\n`;
      xml += `    <lastmod>${formatDate(row.updatedAt)}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.4</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += "</urlset>";

    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=3600"); // Cache 1 hour
    res.send(xml);
  } catch (err) {
    console.error("Sitemap generation error:", err);
    res
      .status(500)
      .set("Content-Type", "application/xml")
      .send(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
      );
  }
});

export default router;
