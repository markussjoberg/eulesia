import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

import { env } from "./utils/env.js";
import routes from "./routes/index.js";
import ogRoutes from "./routes/og.js";
import sitemapRoutes from "./routes/sitemap.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { initScheduler } from "./services/scheduler.js";
import { initWebPush } from "./services/pushNotifications.js";
import { initFCM } from "./services/fcmNotifications.js";
import { setNotifyIO } from "./services/notify.js";
import {
  fullSync,
  startPeriodicSync,
  healthCheck as meiliHealthCheck,
} from "./services/search/index.js";
import { hashToken } from "./utils/crypto.js";
import { getActiveBlockingSanction } from "./utils/sanctions.js";

// Upload directory (relative to project root)
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

// Build allowed origins list (web + Capacitor native apps)
const allowedOrigins = [env.APP_URL];
if (env.ALLOWED_ORIGINS) {
  allowedOrigins.push(...env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()));
}

const app = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", ...allowedOrigins],
      },
    },
  }),
);

// CORS
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Trust proxy (for rate limiting behind reverse proxy) — MUST be before rate limiter
app.set("trust proxy", 1);

// Rate limiting (relaxed in development)
const isDev = env.NODE_ENV === "development";

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 1000 : 100, // 1000 in dev, 100 in prod
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev, // Skip rate limiting entirely in development
});

// Auth rate limiter: 20 attempts per 15 min window per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 10,
  message: {
    success: false,
    error: "Too many authentication attempts, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});

const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 1000 : 5,
  message: {
    success: false,
    error: "Too many waitlist submissions, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});

app.use(limiter);
app.post("/api/v1/auth/login", authLimiter);
app.post("/api/v1/auth/register", authLimiter);
app.post("/api/v1/auth/magic-link", authLimiter);
app.get("/api/v1/auth/ftn/start", authLimiter);
app.use("/api/v1/waitlist/join", waitlistLimiter);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files with CORS headers
app.use(
  "/uploads",
  (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.resolve(UPLOAD_DIR)),
);

// Deep linking: Apple Universal Links
app.get("/.well-known/apple-app-site-association", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${process.env.APPLE_TEAM_ID || "TEAM_ID"}.eu.eulesia.app`],
          components: [{ "/": "/api/v1/auth/verify/*" }],
        },
      ],
    },
  });
});

// Deep linking: Android App Links
app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "eu.eulesia.app",
        sha256_cert_fingerprints: [process.env.ANDROID_CERT_FINGERPRINT || ""],
      },
    },
  ]);
});

// Health check endpoint
app.get("/health", async (_req, res) => {
  const meiliOk = await meiliHealthCheck();
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      meilisearch: meiliOk ? "ok" : "unavailable",
    },
  });
});

// OG meta tag routes (bot detection via Traefik)
app.use(ogRoutes);

// Dynamic sitemap (routed via Traefik for /sitemap.xml)
app.use(sitemapRoutes);

// API routes
app.use("/api/v1", routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Socket.io authentication middleware
io.use(async (socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie;
    if (!rawCookies) {
      return next(new Error("Authentication required"));
    }

    // Parse cookies manually (simple key=value pairs separated by '; ')
    const cookieMap = Object.fromEntries(
      rawCookies.split("; ").map((c) => {
        const [k, ...v] = c.split("=");
        return [k, v.join("=")];
      }),
    );
    const sessionToken = cookieMap.session;
    if (!sessionToken) {
      return next(new Error("Authentication required"));
    }

    const tokenHash = hashToken(sessionToken);
    const { eq, and, gt } = await import("drizzle-orm");
    const { db, sessions, users } = await import("./db/index.js");

    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      return next(new Error("Invalid session"));
    }

    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return next(new Error("User not found"));
    }

    const activeSanction = await getActiveBlockingSanction(user.id);
    if (activeSanction) {
      return next(
        new Error(
          activeSanction.sanctionType === "ban"
            ? "Account banned"
            : "Account suspended",
        ),
      );
    }

    // Attach userId to socket for later use
    (socket as any).userId = user.id;
    (socket as any).userRole = user.role;
    next();
  } catch (err) {
    console.error("Socket auth error:", err);
    next(new Error("Authentication failed"));
  }
});

// Socket.io events (authenticated connections only)
io.on("connection", (socket) => {
  const userId = (socket as any).userId as string;
  console.log("Socket connected:", socket.id, "user:", userId);

  // Agora threads — public, allow all authenticated users
  socket.on("join:thread", (threadId: string) => {
    socket.join(`thread:${threadId}`);
  });

  socket.on("leave:thread", (threadId: string) => {
    socket.leave(`thread:${threadId}`);
  });

  // User-specific room (notifications) — only own room
  socket.on("join:user", (requestedUserId: string) => {
    if (requestedUserId === userId) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on("leave:user", (requestedUserId: string) => {
    if (requestedUserId === userId) {
      socket.leave(`user:${userId}`);
    }
  });

  // Direct messages — verify participation
  socket.on("join:dm", async (conversationId: string) => {
    try {
      const { eq, and } = await import("drizzle-orm");
      const { db, conversationParticipants } = await import("./db/index.js");
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
          ),
        )
        .limit(1);
      if (participant || (socket as any).userRole === "admin") {
        socket.join(`dm:${conversationId}`);
      }
    } catch (err) {
      console.error("Error joining DM:", err);
    }
  });

  socket.on("leave:dm", (conversationId: string) => {
    socket.leave(`dm:${conversationId}`);
  });

  // Typing indicators — broadcast to others in the same dm
  socket.on("typing:dm", (conversationId: string) => {
    socket
      .to(`dm:${conversationId}`)
      .emit("user_typing_dm", { conversationId, userId });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Export io for use in routes
export { io };

// Initialize services
initWebPush();
initFCM();
setNotifyIO(io);

// Run pending migrations before starting
async function runMigrations() {
  const { db } = await import("./db/index.js");
  const { sql } = await import("drizzle-orm");
  try {
    // 0009: language field (idempotent)
    await db.execute(
      sql`ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
    );
    await db.execute(
      sql`ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
    );
    await db.execute(
      sql`ALTER TABLE "club_threads" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
    );
    await db.execute(
      sql`ALTER TABLE "club_comments" ADD COLUMN IF NOT EXISTS "language" varchar(10)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "threads_language_idx" ON "threads" ("language")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "club_threads_language_idx" ON "club_threads" ("language")`,
    );
    // 0010: clubs cover image
    await db.execute(
      sql`ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "cover_image_url" varchar(500)`,
    );
    // 0011: remove seed mock clubs (Tampere History, Cycling, Hervanta)
    await db.execute(
      sql`DELETE FROM "club_comments" WHERE "thread_id" IN (SELECT "id" FROM "club_threads" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors')))`,
    );
    await db.execute(
      sql`DELETE FROM "club_threads" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors'))`,
    );
    await db.execute(
      sql`DELETE FROM "club_members" WHERE "club_id" IN (SELECT "id" FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors'))`,
    );
    await db.execute(
      sql`DELETE FROM "clubs" WHERE "slug" IN ('tampere-history', 'cycling-tampere', 'hervanta-neighbors')`,
    );
    // 0012: is_hidden columns
    await db.execute(
      sql`ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
    );
    await db.execute(
      sql`ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
    );
    await db.execute(
      sql`ALTER TABLE "club_threads" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
    );
    await db.execute(
      sql`ALTER TABLE "club_comments" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
    );
    await db.execute(
      sql`ALTER TABLE "room_messages" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false`,
    );
    // 0013: DSA moderation tables
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE report_reason AS ENUM ('illegal', 'harassment', 'spam', 'misinformation', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE report_status AS ENUM ('pending', 'reviewing', 'resolved', 'dismissed'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE content_type AS ENUM ('thread', 'comment', 'club_thread', 'club_comment', 'club', 'user', 'room_message', 'dm'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE action_type AS ENUM ('content_removed', 'content_restored', 'user_warned', 'user_suspended', 'user_banned', 'user_unbanned', 'report_dismissed', 'report_resolved', 'role_changed'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE sanction_type AS ENUM ('warning', 'suspension', 'ban'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE appeal_status AS ENUM ('pending', 'accepted', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    // 0014: Sync enum values — add missing values from schema
    await db.execute(
      sql`DO $$ BEGIN ALTER TYPE content_type ADD VALUE IF NOT EXISTS 'system'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'user_verified'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'user_unverified'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'settings_changed'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`DO $$ BEGIN ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'invite_count_changed'; EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS "content_reports" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "reporter_user_id" UUID NOT NULL REFERENCES "users"("id"), "content_type" content_type NOT NULL, "content_id" UUID NOT NULL, "reason" report_reason NOT NULL, "description" TEXT, "status" report_status DEFAULT 'pending', "assigned_to" UUID REFERENCES "users"("id"), "resolved_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
    );
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS "moderation_actions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "admin_user_id" UUID NOT NULL REFERENCES "users"("id"), "action_type" action_type NOT NULL, "target_type" content_type NOT NULL, "target_id" UUID NOT NULL, "report_id" UUID REFERENCES "content_reports"("id"), "reason" TEXT, "metadata" JSONB, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
    );
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS "user_sanctions" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL REFERENCES "users"("id"), "sanction_type" sanction_type NOT NULL, "reason" TEXT, "issued_by" UUID NOT NULL REFERENCES "users"("id"), "issued_at" TIMESTAMPTZ DEFAULT NOW(), "expires_at" TIMESTAMPTZ, "revoked_at" TIMESTAMPTZ, "revoked_by" UUID REFERENCES "users"("id"))`,
    );
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS "moderation_appeals" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "sanction_id" UUID REFERENCES "user_sanctions"("id"), "report_id" UUID REFERENCES "content_reports"("id"), "action_id" UUID REFERENCES "moderation_actions"("id"), "user_id" UUID NOT NULL REFERENCES "users"("id"), "reason" TEXT NOT NULL, "status" appeal_status DEFAULT 'pending', "admin_response" TEXT, "responded_by" UUID REFERENCES "users"("id"), "responded_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ DEFAULT NOW())`,
    );
    // 0015: Push subscriptions table
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "push_subscriptions" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "endpoint" TEXT NOT NULL,
      "p256dh" TEXT NOT NULL,
      "auth" TEXT NOT NULL,
      "user_agent" TEXT,
      "created_at" TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" ("endpoint")`,
    );

    // Native push device tokens (FCM)
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "device_tokens" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token" TEXT NOT NULL,
      "platform" VARCHAR(10) NOT NULL,
      "device_id" VARCHAR(255),
      "created_at" TIMESTAMPTZ DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "device_tokens_user_idx" ON "device_tokens" ("user_id")`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_idx" ON "device_tokens" ("token")`,
    );

    // 0016: Waitlist table
    await db.execute(
      sql`DO $$ BEGIN CREATE TYPE waitlist_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "waitlist" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" VARCHAR(255) NOT NULL,
      "name" VARCHAR(255),
      "status" waitlist_status DEFAULT 'pending',
      "locale" VARCHAR(10) DEFAULT 'en',
      "ip_address" INET,
      "invite_code_id" UUID REFERENCES "invite_codes"("id"),
      "approved_by" UUID REFERENCES "users"("id"),
      "rejected_by" UUID REFERENCES "users"("id"),
      "approved_at" TIMESTAMPTZ,
      "rejected_at" TIMESTAMPTZ,
      "email_sent_at" TIMESTAMPTZ,
      "note" TEXT,
      "created_at" TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_idx" ON "waitlist" ("email")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "waitlist_status_idx" ON "waitlist" ("status")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "waitlist_created_idx" ON "waitlist" ("created_at")`,
    );
    // 0016: bootstrap-managed admin identity metadata
    await db.execute(
      sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managed_by" varchar(50)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "users_managed_by_idx" ON "users" ("managed_by")`,
    );
    await db.execute(
      sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managed_key" varchar(100)`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_managed_key_unique_idx" ON "users" ("managed_by", "managed_key")`,
    );
    // 0018: enforce FTN subject uniqueness
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_rp_subject_idx" ON "users" ("rp_subject")`,
    );

    // 0017: Convert rooms from flat chat to threaded (club-like)
    await db.execute(
      sql`DROP TABLE IF EXISTS "message_reactions"`,
    );
    await db.execute(
      sql`DROP TABLE IF EXISTS "room_messages"`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_threads" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "room_id" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
      "author_id" UUID NOT NULL REFERENCES "users"("id"),
      "title" VARCHAR(500) NOT NULL,
      "content" TEXT NOT NULL,
      "content_html" TEXT,
      "is_pinned" BOOLEAN DEFAULT false,
      "is_locked" BOOLEAN DEFAULT false,
      "reply_count" INTEGER DEFAULT 0,
      "score" INTEGER DEFAULT 0,
      "is_hidden" BOOLEAN DEFAULT false,
      "created_at" TIMESTAMPTZ DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "room_threads_room_idx" ON "room_threads" ("room_id")`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_comments" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "thread_id" UUID NOT NULL REFERENCES "room_threads"("id") ON DELETE CASCADE,
      "parent_id" UUID,
      "author_id" UUID NOT NULL REFERENCES "users"("id"),
      "content" TEXT NOT NULL,
      "content_html" TEXT,
      "score" INTEGER DEFAULT 0,
      "is_hidden" BOOLEAN DEFAULT false,
      "created_at" TIMESTAMPTZ DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_thread_votes" (
      "thread_id" UUID NOT NULL REFERENCES "room_threads"("id") ON DELETE CASCADE,
      "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "value" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY ("thread_id", "user_id")
    )`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "room_thread_votes_thread_idx" ON "room_thread_votes" ("thread_id")`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "room_comment_votes" (
      "comment_id" UUID NOT NULL REFERENCES "room_comments"("id") ON DELETE CASCADE,
      "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "value" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY ("comment_id", "user_id")
    )`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "room_comment_votes_comment_idx" ON "room_comment_votes" ("comment_id")`,
    );
    // Rename message_count -> thread_count
    await db.execute(
      sql`ALTER TABLE "rooms" RENAME COLUMN "message_count" TO "thread_count"`,
    );

    console.log("Migrations OK");
  } catch (error) {
    console.error("Migration error:", error);
  }
}

runMigrations();

// Start server
const PORT = parseInt(env.PORT);
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏛️  EULESIA API SERVER                                  ║
║                                                           ║
║   European Civic Digital Infrastructure                   ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Environment: ${env.NODE_ENV.padEnd(40)}║
║   Port:        ${PORT.toString().padEnd(40)}║
║   API URL:     ${env.API_URL.padEnd(40)}║
║   App URL:     ${env.APP_URL.padEnd(40)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Initialize background scheduler
  initScheduler();

  // Initialize search index (async, don't block startup)
  setTimeout(async () => {
    try {
      console.log("Initializing search indexes...");
      await fullSync();
      startPeriodicSync(5); // Sync every 5 minutes
      console.log("Search indexes ready");
    } catch (error) {
      console.error("Failed to initialize search:", error);
      // Continue running - search is optional
    }
  }, 2000); // Wait 2s for Meilisearch to be ready
});
