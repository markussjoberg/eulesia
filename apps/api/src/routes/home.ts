import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  rooms,
  roomMembers,
  roomMessages,
  roomInvitations,
  messageReactions,
  users,
  threads,
  clubMembers,
  clubs,
  editHistory,
} from "../db/index.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { renderMarkdown } from "../utils/markdown.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { io } from "../index.js";
import { notify } from "../services/notify.js";
import type { AuthenticatedRequest } from "../types/index.js";

const router = Router();

// Validation schemas
const createRoomSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).default("public"),
});

const updateRoomSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  isPinned: z.boolean().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

const inviteSchema = z.object({
  userId: z.string().uuid(),
});

// Helper to format user summary
function formatUserSummary(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    institutionType: user.institutionType,
  };
}

// ============================================================
// INVITATIONS — must be before /:userId catch-all
// ============================================================

// GET /home/invitations - Get user's pending invitations
router.get(
  "/invitations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;

    const invitations = await db
      .select({
        invitation: roomInvitations,
        room: rooms,
        inviter: users,
      })
      .from(roomInvitations)
      .innerJoin(rooms, eq(roomInvitations.roomId, rooms.id))
      .innerJoin(users, eq(roomInvitations.inviterId, users.id))
      .where(
        and(
          eq(roomInvitations.inviteeId, userId),
          eq(roomInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(roomInvitations.createdAt));

    res.json({
      success: true,
      data: invitations.map(({ invitation, room, inviter }) => ({
        ...invitation,
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
        },
        inviter: formatUserSummary(inviter),
      })),
    });
  }),
);

// POST /home/invitations/:invitationId/accept - Accept invitation
router.post(
  "/invitations/:invitationId/accept",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const [invitation] = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.id, invitationId))
      .limit(1);

    if (!invitation) {
      throw new AppError(404, "Invitation not found");
    }

    if (invitation.inviteeId !== userId) {
      throw new AppError(403, "This invitation is not for you");
    }

    if (invitation.status !== "pending") {
      throw new AppError(400, "Invitation already processed");
    }

    // Update invitation status
    await db
      .update(roomInvitations)
      .set({ status: "accepted" })
      .where(eq(roomInvitations.id, invitationId));

    // Add as member
    await db.insert(roomMembers).values({
      roomId: invitation.roomId,
      userId,
    });

    res.json({
      success: true,
      data: { accepted: true },
    });
  }),
);

// POST /home/invitations/:invitationId/decline - Decline invitation
router.post(
  "/invitations/:invitationId/decline",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { invitationId } = req.params;

    const [invitation] = await db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.id, invitationId))
      .limit(1);

    if (!invitation) {
      throw new AppError(404, "Invitation not found");
    }

    if (invitation.inviteeId !== userId) {
      throw new AppError(403, "This invitation is not for you");
    }

    if (invitation.status !== "pending") {
      throw new AppError(400, "Invitation already processed");
    }

    await db
      .update(roomInvitations)
      .set({ status: "declined" })
      .where(eq(roomInvitations.id, invitationId));

    res.json({
      success: true,
      data: { declined: true },
    });
  }),
);

// ============================================================
// ROOMS — /rooms/* routes before /:userId catch-all
// ============================================================

// POST /home/rooms - Create a new room
router.post(
  "/rooms",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const data = createRoomSchema.parse(req.body);

    const [room] = await db
      .insert(rooms)
      .values({
        ownerId: userId,
        name: data.name,
        description: data.description,
        visibility: data.visibility,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: room,
    });
  }),
);

// GET /home/rooms/:roomId - Get room with messages
router.get(
  "/rooms/:roomId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { roomId } = req.params;
    const { limit = "50" } = req.query;
    const currentUserId = req.user?.id;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    // Get room with owner
    const [roomData] = await db
      .select({
        room: rooms,
        owner: users,
      })
      .from(rooms)
      .innerJoin(users, eq(rooms.ownerId, users.id))
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!roomData) {
      throw new AppError(404, "Room not found");
    }

    const { room, owner } = roomData;
    const isOwner = currentUserId === owner.id;

    // Check access for private rooms
    if (room.visibility === "private" && !isOwner) {
      if (!currentUserId) {
        throw new AppError(401, "Authentication required");
      }

      const [membership] = await db
        .select()
        .from(roomMembers)
        .where(
          and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.userId, currentUserId),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new AppError(403, "Not a member of this room");
      }
    }

    // Get messages (include hidden as stubs for placeholder display)
    const messagesData = await db
      .select({
        message: roomMessages,
        author: users,
      })
      .from(roomMessages)
      .innerJoin(users, eq(roomMessages.authorId, users.id))
      .where(eq(roomMessages.roomId, roomId))
      .orderBy(desc(roomMessages.createdAt))
      .limit(limitNum);

    // Get members (for private rooms)
    let members: (typeof users.$inferSelect)[] = [];
    if (room.visibility === "private") {
      const membersData = await db
        .select({ user: users })
        .from(roomMembers)
        .innerJoin(users, eq(roomMembers.userId, users.id))
        .where(eq(roomMembers.roomId, roomId));

      members = membersData.map((m) => m.user);
    }

    // Get reactions for all messages in the room
    const messageIds = messagesData.map((m) => m.message.id);
    let reactionsMap: Record<
      string,
      { emoji: string; count: number; users: string[] }[]
    > = {};
    if (messageIds.length > 0) {
      const allReactions = await db
        .select()
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds));

      // Group by messageId then emoji
      const grouped: Record<string, Record<string, string[]>> = {};
      for (const r of allReactions) {
        if (!grouped[r.messageId]) grouped[r.messageId] = {};
        if (!grouped[r.messageId][r.emoji]) grouped[r.messageId][r.emoji] = [];
        grouped[r.messageId][r.emoji].push(r.userId);
      }
      for (const [msgId, emojis] of Object.entries(grouped)) {
        reactionsMap[msgId] = Object.entries(emojis).map(
          ([emoji, userIds]) => ({
            emoji,
            count: userIds.length,
            users: userIds,
          }),
        );
      }
    }

    res.json({
      success: true,
      data: {
        ...room,
        owner: formatUserSummary(owner),
        members: members.map(formatUserSummary),
        messages: messagesData
          .map(({ message, author }) => {
            if (message.isHidden) {
              return {
                id: message.id,
                roomId: message.roomId,
                authorId: message.authorId,
                content: "",
                contentHtml: null,
                createdAt: message.createdAt,
                isHidden: true,
                author: null,
                reactions: [],
              };
            }
            return {
              ...message,
              author: formatUserSummary(author),
              reactions: reactionsMap[message.id] || [],
            };
          })
          .reverse(), // Oldest first
        isOwner,
        canPost:
          room.visibility === "public" ||
          isOwner ||
          members.some((m) => m.id === currentUserId),
      },
    });
  }),
);

// PATCH /home/rooms/:roomId - Update room
router.patch(
  "/rooms/:roomId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = updateRoomSchema.parse(req.body);

    // Verify ownership
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can update this room");
    }

    const [updatedRoom] = await db
      .update(rooms)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId))
      .returning();

    res.json({
      success: true,
      data: updatedRoom,
    });
  }),
);

// DELETE /home/rooms/:roomId - Delete room
router.delete(
  "/rooms/:roomId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;

    // Verify ownership
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can delete this room");
    }

    await db.delete(rooms).where(eq(rooms.id, roomId));

    res.json({
      success: true,
      data: { deleted: true },
    });
  }),
);

// POST /home/rooms/:roomId/messages - Post message to room
router.post(
  "/rooms/:roomId/messages",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = sendMessageSchema.parse(req.body);

    // Get room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    // Check access
    const isOwner = room.ownerId === userId;

    if (room.visibility === "private" && !isOwner) {
      const [membership] = await db
        .select()
        .from(roomMembers)
        .where(
          and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)),
        )
        .limit(1);

      if (!membership) {
        throw new AppError(403, "Not a member of this room");
      }
    }

    // Parse markdown
    const contentHtml = renderMarkdown(data.content);

    // Create message
    const [message] = await db
      .insert(roomMessages)
      .values({
        roomId,
        authorId: userId,
        content: data.content,
        contentHtml,
      })
      .returning();

    // Update room timestamp and message count
    await db
      .update(rooms)
      .set({
        updatedAt: new Date(),
        messageCount: sql`${rooms.messageCount} + 1`,
      })
      .where(eq(rooms.id, roomId));

    // Get author info
    const [author] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const messageData = {
      ...message,
      author: formatUserSummary(author),
    };

    // Broadcast to room via Socket.IO
    io.to(`room:${roomId}`).emit("new_room_message", {
      roomId,
      message: messageData,
    });

    res.status(201).json({
      success: true,
      data: messageData,
    });
  }),
);

// PATCH /home/rooms/:roomId/messages/:messageId - Edit room message
router.patch(
  "/rooms/:roomId/messages/:messageId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, messageId } = req.params;
    const { content } = z
      .object({ content: z.string().min(1).max(5000) })
      .parse(req.body);

    const [message] = await db
      .select()
      .from(roomMessages)
      .where(
        and(eq(roomMessages.id, messageId), eq(roomMessages.roomId, roomId)),
      )
      .limit(1);

    if (!message) {
      throw new AppError(404, "Message not found");
    }

    if (message.authorId !== userId && req.user!.role !== "admin") {
      throw new AppError(403, "Not authorized to edit this message");
    }

    // Save previous content
    await db.insert(editHistory).values({
      contentType: "room_message",
      contentId: messageId,
      editedBy: userId,
      previousContent: message.content,
      previousContentHtml: message.contentHtml,
    });

    const contentHtml = renderMarkdown(content);

    const [updated] = await db
      .update(roomMessages)
      .set({
        content,
        contentHtml,
        editedBy: userId,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(roomMessages.id, messageId))
      .returning();

    const [author] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    io.to(`room:${roomId}`).emit("room_message_edited", {
      roomId,
      messageId,
      content: updated.content,
      contentHtml: updated.contentHtml,
      editedBy: userId,
      editedAt: updated.editedAt,
      author: formatUserSummary(author),
    });

    res.json({ success: true, data: updated });
  }),
);

// DELETE /home/rooms/:roomId/messages/:messageId - Soft-delete room message
router.delete(
  "/rooms/:roomId/messages/:messageId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, messageId } = req.params;

    const [message] = await db
      .select()
      .from(roomMessages)
      .where(
        and(eq(roomMessages.id, messageId), eq(roomMessages.roomId, roomId)),
      )
      .limit(1);

    if (!message) {
      throw new AppError(404, "Message not found");
    }

    // Check ownership: author, room owner, or admin
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);
    const isRoomOwner = room && room.ownerId === userId;
    const isAuthor = message.authorId === userId;
    const isAdmin = req.user!.role === "admin";

    if (!isAuthor && !isRoomOwner && !isAdmin) {
      throw new AppError(403, "Not authorized to delete this message");
    }

    await db
      .update(roomMessages)
      .set({ isHidden: true, updatedAt: new Date() })
      .where(eq(roomMessages.id, messageId));

    io.to(`room:${roomId}`).emit("room_message_deleted", { roomId, messageId });

    res.json({ success: true, data: { deleted: true } });
  }),
);

// POST /home/rooms/:roomId/messages/:messageId/reactions - Toggle reaction
router.post(
  "/rooms/:roomId/messages/:messageId/reactions",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, messageId } = req.params;
    const { emoji } = z
      .object({ emoji: z.string().min(1).max(20) })
      .parse(req.body);

    // Verify message exists in room
    const [message] = await db
      .select()
      .from(roomMessages)
      .where(
        and(eq(roomMessages.id, messageId), eq(roomMessages.roomId, roomId)),
      )
      .limit(1);

    if (!message) {
      throw new AppError(404, "Message not found");
    }

    // Check if reaction already exists (toggle)
    const [existing] = await db
      .select()
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
      .limit(1);

    if (existing) {
      // Remove reaction
      await db
        .delete(messageReactions)
        .where(eq(messageReactions.id, existing.id));
      io.to(`room:${roomId}`).emit("room_reaction_updated", {
        roomId,
        messageId,
      });
      res.json({ success: true, data: { action: "removed" } });
    } else {
      // Add reaction
      await db.insert(messageReactions).values({
        messageId,
        userId,
        emoji,
      });
      io.to(`room:${roomId}`).emit("room_reaction_updated", {
        roomId,
        messageId,
      });
      res.json({ success: true, data: { action: "added" } });
    }
  }),
);

// POST /home/rooms/:roomId/invite - Invite user to private room
router.post(
  "/rooms/:roomId/invite",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const data = inviteSchema.parse(req.body);

    // Get room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can invite members");
    }

    if (room.visibility !== "private") {
      throw new AppError(400, "Can only invite to private rooms");
    }

    // Find user by userId
    const [invitee] = await db
      .select()
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    if (!invitee) {
      throw new AppError(404, "User not found");
    }

    const inviteeId = invitee.id;

    // Check if already member
    const [existingMember] = await db
      .select()
      .from(roomMembers)
      .where(
        and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, inviteeId)),
      )
      .limit(1);

    if (existingMember) {
      throw new AppError(400, "User is already a member");
    }

    // Check for pending invitation
    const [existingInvite] = await db
      .select()
      .from(roomInvitations)
      .where(
        and(
          eq(roomInvitations.roomId, roomId),
          eq(roomInvitations.inviteeId, inviteeId),
          eq(roomInvitations.status, "pending"),
        ),
      )
      .limit(1);

    if (existingInvite) {
      throw new AppError(400, "Invitation already pending");
    }

    // Create invitation
    const [invitation] = await db
      .insert(roomInvitations)
      .values({
        roomId,
        inviterId: userId,
        inviteeId: inviteeId,
      })
      .returning();

    // Notify invitee
    const inviterName = req.user!.name || "Someone";
    await notify({
      userId: inviteeId,
      type: "room_invite",
      title: inviterName,
      body: room.name,
      link: "/home",
    });

    res.status(201).json({
      success: true,
      data: invitation,
    });
  }),
);

// POST /home/rooms/:roomId/members - Add member directly (owner only, private rooms)
router.post(
  "/rooms/:roomId/members",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const { userId: targetUserId } = z
      .object({ userId: z.string().uuid() })
      .parse(req.body);

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    if (room.ownerId !== userId) {
      throw new AppError(403, "Only the owner can add members");
    }

    if (room.visibility !== "private") {
      throw new AppError(400, "Can only add members to private rooms");
    }

    // Verify target user exists
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      throw new AppError(404, "User not found");
    }

    // Check if already member
    const [existingMember] = await db
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (existingMember) {
      throw new AppError(400, "User is already a member");
    }

    // Add member directly
    await db.insert(roomMembers).values({
      roomId,
      userId: targetUserId,
    });

    // Notify the added user
    const adderName = req.user!.name || "Someone";
    await notify({
      userId: targetUserId,
      type: "room_invite",
      title: adderName,
      body: room.name,
      link: `/home/rooms/${roomId}`,
    });

    res.status(201).json({
      success: true,
      data: { userId: targetUserId, name: targetUser.name },
    });
  }),
);

// DELETE /home/rooms/:roomId/members/:userId - Remove member (owner only) or leave room
router.delete(
  "/rooms/:roomId/members/:memberId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const { roomId, memberId } = req.params;

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      throw new AppError(404, "Room not found");
    }

    const isOwner = room.ownerId === userId;
    const isSelf = memberId === userId;

    if (!isOwner && !isSelf) {
      throw new AppError(403, "Can only remove yourself or be the owner");
    }

    await db
      .delete(roomMembers)
      .where(
        and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, memberId)),
      );

    res.json({
      success: true,
      data: { removed: true },
    });
  }),
);

// ============================================================
// CATCH-ALL: /:userId — must be LAST to avoid matching
// /invitations, /rooms, etc.
// ============================================================

// GET /home/:userId - Get user's home (public view)
router.get(
  "/:userId",
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;
    const currentUserId = req.user?.id;

    // Get user
    const [homeOwner] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!homeOwner) {
      throw new AppError(404, "User not found");
    }

    // Get rooms (public ones, or all if viewing own home)
    const isOwnHome = currentUserId === userId;

    let roomsQuery = db
      .select({
        room: rooms,
        messageCount: sql<number>`(SELECT count(*)::int FROM room_messages WHERE room_id = ${rooms.id})`,
      })
      .from(rooms)
      .where(eq(rooms.ownerId, userId))
      .orderBy(desc(rooms.isPinned), rooms.sortOrder, desc(rooms.updatedAt));

    const userRooms = await roomsQuery;

    // Filter rooms based on visibility and membership
    const accessibleRooms = await Promise.all(
      userRooms.map(async ({ room, messageCount }) => {
        // Public rooms are always visible
        if (room.visibility === "public") {
          return { ...room, messageCount, canAccess: true };
        }

        // Private rooms: check if current user is owner or member
        if (isOwnHome) {
          return { ...room, messageCount, canAccess: true };
        }

        if (currentUserId) {
          const [membership] = await db
            .select()
            .from(roomMembers)
            .where(
              and(
                eq(roomMembers.roomId, room.id),
                eq(roomMembers.userId, currentUserId),
              ),
            )
            .limit(1);

          if (membership) {
            return { ...room, messageCount, canAccess: true };
          }
        }

        // Show that room exists but can't access
        return {
          id: room.id,
          name: room.name,
          visibility: room.visibility,
          isPinned: room.isPinned,
          canAccess: false,
        };
      }),
    );

    // Get recent activity (user's threads and comments)
    const recentThreads = await db
      .select({
        id: threads.id,
        title: threads.title,
        scope: threads.scope,
        createdAt: threads.createdAt,
      })
      .from(threads)
      .where(and(eq(threads.authorId, userId), eq(threads.isHidden, false)))
      .orderBy(desc(threads.createdAt))
      .limit(5);

    // Get user's club memberships
    const userClubs = await db
      .select({
        club: {
          id: clubs.id,
          name: clubs.name,
          slug: clubs.slug,
        },
      })
      .from(clubMembers)
      .innerJoin(clubs, eq(clubMembers.clubId, clubs.id))
      .where(eq(clubMembers.userId, userId))
      .limit(5);

    res.json({
      success: true,
      data: {
        owner: formatUserSummary(homeOwner),
        rooms: accessibleRooms,
        recentActivity: {
          threads: recentThreads,
          clubs: userClubs.map((c) => c.club),
        },
        isOwnHome,
      },
    });
  }),
);

export default router;
