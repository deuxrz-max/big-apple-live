import { Router } from "express";
import { and, eq, desc, gte, inArray, sql } from "drizzle-orm";
import { db, accountProfiles, chatAdmissions, chatMemberships, chatReports, roomMessages } from "@workspace/db";
import {
  ConfirmChatAdultBody, ReportChatMessageBody, ReviewChatReportBody, ReviewChatReportParams,
  GetChatDirectoryResponse, GetChatAccessResponse, GetChatReportsResponse,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { communityDirectory, accessFor, requireAdult, requireOwner } from "../lib/community";
import { roomStore, RoomError } from "../lib/room-store";
import { liveStreamIdForAccount, liveStreamRoomName } from "../lib/live-stream-policy";
import { liveStreamChatHub } from "../lib/live-stream-chat";
import { liveKitBeamService } from "../lib/livekit";
import { universityVideoBeamStore } from "../lib/university-video-beam";

const router = Router();
router.use("/account/chat", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get("/account/chat/access", async (req, res) => {
  res.json(GetChatAccessResponse.parse(await accessFor(accountId(req))));
});
router.post("/account/chat/access", async (req, res) => {
  sameOrigin(req);
  if (!ConfirmChatAdultBody.safeParse(req.body).success) throw new RoomError(400, "An explicit 18+ confirmation is required");
  const id = accountId(req);
  if ((await accessFor(id)).suspended) throw new RoomError(403, "Chat access is restricted pending moderator review");
  await db.insert(chatAdmissions).values({ accountId: id }).onConflictDoNothing();
  res.json(GetChatAccessResponse.parse(await accessFor(id)));
});
router.get("/account/chat/rooms", async (_req, res) => {
  // Public directory exposes labels and aggregate headcounts, never participant identities or chat.
  res.json(GetChatDirectoryResponse.parse(await communityDirectory()));
});
router.post("/account/chat/reports", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireAdult(id);
  const raw = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  // Keep older clients working while all preview surfaces move to the generic report form.
  const normalized = raw.targetType ? raw : {
    ...raw, targetType: raw.streamId ? "stream" : raw.targetUsername ? "user" : "message",
  };
  const input = ReportChatMessageBody.safeParse(normalized);
  if (!input.success) throw new RoomError(400, "Choose what to report and a reason");

  let targetAccountId: string | null = null;
  let reportedUsername = "";
  let roomId: string | null = input.data.roomId?.trim().toUpperCase() ?? null;
  let historyId: string | null = null;
  let messageId: string | null = null;
  let streamId: string | null = input.data.streamId ?? null;
  let messageText = input.data.messageText?.trim() ?? "";

  if (roomId) {
    if (!roomStore.isCommunity(roomId)) throw new RoomError(404, "Room not found");
    roomStore.requireAccountMember(roomId, req.get("X-Room-Session") ?? "", id);
    historyId = roomStore.getHistoryId(roomId);
  }
  if (input.data.targetType === "message") {
    if (input.data.messageId && streamId) {
      const liveMessage = liveStreamChatHub.find(streamId, input.data.messageId);
      if (!liveMessage || (input.data.targetUsername
        && liveMessage.username.toLowerCase() !== input.data.targetUsername.toLowerCase())) {
        throw new RoomError(404, "Live chat message not found");
      }
      targetAccountId = liveMessage.accountId;
      reportedUsername = liveMessage.username;
      messageId = liveMessage.id;
      messageText = liveMessage.text;
    } else if (input.data.messageId) {
      if (!roomId || !historyId) throw new RoomError(400, "Choose the room message you want to report");
      const [message] = await db.select().from(roomMessages).where(and(
        eq(roomMessages.id, input.data.messageId), eq(roomMessages.historyId, historyId)));
      if (!message) throw new RoomError(404, "Message not found in this room");
      if (message.botId || !message.authorAccountId) throw new RoomError(400, "This system message cannot be reported");
      targetAccountId = message.authorAccountId;
      reportedUsername = message.username;
      messageId = message.id;
      messageText = message.text;
    } else if (streamId && input.data.targetUsername) {
      const [target] = await db.select().from(accountProfiles)
        .where(sql`lower(${accountProfiles.username}) = lower(${input.data.targetUsername})`).limit(1);
      if (!target || liveStreamIdForAccount(target.accountId) !== streamId) {
        throw new RoomError(404, "That live message is no longer available");
      }
      targetAccountId = target.accountId;
      reportedUsername = target.username;
    } else {
      throw new RoomError(400, "Choose the message you want to report");
    }
  } else {
    if (input.data.targetType === "stream" && !streamId) throw new RoomError(400, "Choose the live stream");
    if (!input.data.targetUsername) throw new RoomError(400, "Choose the account you want to report");
    const [target] = await db.select().from(accountProfiles)
      .where(sql`lower(${accountProfiles.username}) = lower(${input.data.targetUsername})`).limit(1);
    if (!target) throw new RoomError(404, "Account not found");
    if (target.accountId === id) throw new RoomError(400, "You cannot report your own account");
    if (input.data.targetType === "stream"
      && (!streamId || liveStreamIdForAccount(target.accountId) !== streamId)) {
      throw new RoomError(404, "That livestream is no longer available");
    }
    if (streamId) {
      const targetIdentity = input.data.targetType === "stream" ? "host"
        : liveStreamIdForAccount(target.accountId) === streamId
          ? "host" : `viewer-${liveStreamIdForAccount(target.accountId)}`;
      const activeParticipants = await liveKitBeamService.listParticipants(liveStreamRoomName(streamId));
      if (!activeParticipants.some(participant => participant.identity === targetIdentity)) {
        throw new RoomError(404, "That user is not in this live stream");
      }
    }
    targetAccountId = target.accountId;
    reportedUsername = target.username;
  }
  if (targetAccountId === id) throw new RoomError(400, "You cannot report yourself");

  const [reporter] = await db.select({ username: accountProfiles.username }).from(accountProfiles)
    .where(eq(accountProfiles.accountId, id));
  const duplicateCondition = input.data.targetType === "message" && messageId
    ? and(eq(chatReports.reporterId, id), eq(chatReports.messageId, messageId), eq(chatReports.status, "pending"))
    : and(eq(chatReports.reporterId, id), eq(chatReports.reportedAccountId, targetAccountId!),
      eq(chatReports.targetType, input.data.targetType), eq(chatReports.status, "pending"));
  const [duplicate] = await db.select().from(chatReports).where(duplicateCondition!);
  if (duplicate) { res.status(201).json({ id: duplicate.id, status: duplicate.status }); return; }
  const [last] = await db.select().from(chatReports).where(eq(chatReports.reporterId, id))
    .orderBy(desc(chatReports.createdAt)).limit(1);
  if (last && Date.now() - last.createdAt.getTime() < 5000) {
    throw new RoomError(429, "Please wait before submitting another report");
  }

  const report = await db.transaction(async tx => {
    if (targetAccountId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${targetAccountId}))`);
    const [created] = await tx.insert(chatReports).values({
      historyId, roomId, messageId, reporterId: id, reporterUsername: reporter?.username ?? "Account",
      reportedAccountId: targetAccountId, reportedUsername, targetType: input.data.targetType,
      source: "user", streamId, messageText: messageText.slice(0, 1000),
      reason: input.data.reason, details: input.data.details?.trim() ?? "",
    }).returning();
    if (targetAccountId) {
      const [recentCount] = await tx.select({
        count: sql<number>`count(distinct ${chatReports.reporterId})::int`,
      }).from(chatReports).where(and(
        eq(chatReports.reportedAccountId, targetAccountId),
        eq(chatReports.source, "user"),
        eq(chatReports.status, "pending"),
        gte(chatReports.createdAt, new Date(Date.now() - 15 * 60_000)),
      ));
      if ((recentCount?.count ?? 0) >= 3) {
        await tx.insert(chatAdmissions).values({ accountId: targetAccountId, reportsMuted: true })
          .onConflictDoUpdate({ target: chatAdmissions.accountId, set: { reportsMuted: true } });
      }
    }
    return created!;
  });
  res.status(201).json({ id: report.id, status: report.status });
});
router.get("/account/chat/reports", async (req, res) => {
  await requireOwner(accountId(req));
  const rows = await db.select().from(chatReports)
    .where(eq(chatReports.status, "pending")).orderBy(desc(chatReports.createdAt)).limit(100);
  const messageIds = [...new Set(rows.map(row => row.messageId).filter((value): value is string => !!value))];
  const messages = messageIds.length
    ? await db.select().from(roomMessages).where(inArray(roomMessages.id, messageIds)) : [];
  const messageById = new Map(messages.map(message => [message.id, message]));
  const profileIds = [...new Set(rows.flatMap(row => [row.reporterId, row.reportedAccountId ?? ""].filter(Boolean)))];
  const profiles = profileIds.length
    ? await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
      .from(accountProfiles).where(inArray(accountProfiles.accountId, profileIds)) : [];
  const usernameById = new Map(profiles.map(profile => [profile.accountId, profile.username]));
  const reports = rows.map(row => {
    const message = row.messageId ? messageById.get(row.messageId) : undefined;
    const reportedAccountId = row.reportedAccountId ?? message?.authorAccountId ?? null;
    return {
      id: row.id, status: row.status, targetType: row.targetType, source: row.source,
      roomId: row.roomId, messageId: row.messageId, streamId: row.streamId,
      reason: row.reason, details: row.details, createdAt: row.createdAt,
      text: row.messageText || message?.text || "",
      reporterUsername: row.reporterUsername || usernameById.get(row.reporterId) || "Unknown",
      reportedUsername: row.reportedUsername || (reportedAccountId ? usernameById.get(reportedAccountId) : null)
        || message?.username || "Unknown",
    };
  });
  res.json(GetChatReportsResponse.parse(reports));
});
router.patch("/account/chat/reports/:reportId", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireOwner(id);
  const params = ReviewChatReportParams.safeParse(req.params);
  const body = ReviewChatReportBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Choose a report and review action");
  let targetToRevoke: string | null = null;
  const report = await db.transaction(async tx => {
    const [row] = await tx.select().from(chatReports).where(eq(chatReports.id, params.data.reportId)).for("update");
    if (!row) throw new RoomError(404, "Report not found");
    if (row.status !== "pending") throw new RoomError(409, "Report already reviewed");
    const [message] = row.messageId
      ? await tx.select().from(roomMessages).where(eq(roomMessages.id, row.messageId)) : [];
    const targetId = row.reportedAccountId ?? message?.authorAccountId ?? null;
    targetToRevoke = targetId;
    const action = body.data.action;
    if (["warn", "mute", "ban", "restrict"].includes(action) && !targetId) {
      throw new RoomError(409, "This report has no account that can be moderated");
    }
    if (targetId) {
      const admissionUpdate = action === "warn"
        ? { moderationWarning: "A moderator reviewed a report about your account. Please follow Big Apple Live's community rules.", warningAt: new Date() }
        : action === "mute" ? { chatMuted: true }
        : action === "ban" || action === "restrict" ? { suspended: true }
        : {};
      if (Object.keys(admissionUpdate).length) {
        await tx.insert(chatAdmissions).values({ accountId: targetId, ...admissionUpdate })
          .onConflictDoUpdate({ target: chatAdmissions.accountId, set: admissionUpdate });
      }
    }
    const status = action === "reviewed" ? "reviewed" : action === "warn" ? "warned"
      : action === "mute" ? "muted" : action === "ban" ? "banned"
      : action === "dismiss" ? "dismissed" : action === "restrict" ? "restricted" : "hidden";
    if (action === "hide" && row.messageId) {
      await tx.update(roomMessages).set({ hidden: "true" }).where(eq(roomMessages.id, row.messageId));
    }
    const [updated] = await tx.update(chatReports).set({ reviewedBy: id, status })
      .where(eq(chatReports.id, row.id)).returning();
    if (targetId) {
      const [open] = await tx.select({ count: sql<number>`count(*)::int` }).from(chatReports)
        .where(and(eq(chatReports.reportedAccountId, targetId), eq(chatReports.status, "pending")));
      if ((open?.count ?? 0) === 0) {
        await tx.update(chatAdmissions).set({ reportsMuted: false }).where(eq(chatAdmissions.accountId, targetId));
      }
    }
    return updated!;
  });
  roomStore.refreshChatVisibility();
  if (body.data.action === "ban" && targetToRevoke) {
    const streamId = liveStreamIdForAccount(targetToRevoke);
    try {
      const roomName = liveStreamRoomName(streamId);
      const rooms = await liveKitBeamService.listRooms([roomName]);
      if (rooms.length) await liveKitBeamService.deleteRoom(roomName);
      liveStreamChatHub.end(streamId);
    } catch (error) {
      req.log.warn({ error }, "Banned account livestream could not be terminated immediately");
    }
    for (const roomId of roomStore.activeRoomIdsForAccount(targetToRevoke)) {
      const membership = roomStore.accountSession(roomId, targetToRevoke);
      if (!membership) continue;
      try {
        const beamRoomName = universityVideoBeamStore.getRoomName(roomId);
        const active = await liveKitBeamService.listParticipants(beamRoomName);
        if (active.some(participant => participant.identity === membership.participantId)) {
          await liveKitBeamService.removeParticipant(beamRoomName, membership.participantId);
        }
      } catch (error) {
        req.log.warn({ error }, "Banned account beam audio could not be disconnected immediately");
      }
      try { universityVideoBeamStore.leaveSlot(roomId, membership.participantId); } catch { /* seat may already be empty */ }
      try { roomStore.leaveParticipant(roomId, membership.participantId); } catch { /* membership may already be gone */ }
    }
  }
  res.json({ id: report.id, status: report.status });
});
export default router;
