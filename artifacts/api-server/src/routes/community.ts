import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, chatAdmissions, chatMemberships, chatReports, roomMessages } from "@workspace/db";
import {
  ConfirmChatAdultBody, ReportChatMessageBody, ReviewChatReportBody, ReviewChatReportParams,
  GetChatDirectoryResponse, GetChatAccessResponse, GetChatReportsResponse,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { communityDirectory, accessFor, requireAdult, requireModerator } from "../lib/community";
import { roomStore, RoomError } from "../lib/room-store";

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
  // Public platform labels contain no participants, chat, or activity statistics.
  res.json(GetChatDirectoryResponse.parse(await communityDirectory()));
});
router.post("/account/chat/reports", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireAdult(id);
  const input = ReportChatMessageBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a message and report reason");
  const roomId = input.data.roomId.toUpperCase();
  if (!roomStore.isCommunity(roomId)) throw new RoomError(404, "University not found");
  roomStore.requireAccountMember(roomId, req.get("X-Room-Session") ?? "", id);
  const historyId = roomStore.getHistoryId(roomId);
  const [message] = await db.select().from(roomMessages)
    .where(and(eq(roomMessages.id, input.data.messageId), eq(roomMessages.historyId, historyId)));
  if (!message) throw new RoomError(404, "Message not found in this university");
  const [duplicate] = await db.select().from(chatReports).where(and(
    eq(chatReports.messageId, message.id), eq(chatReports.reporterId, id), eq(chatReports.status, "pending")));
  if (duplicate) { res.status(201).json({ id: duplicate.id, status: duplicate.status }); return; }
  const recent = await db.select({ id: chatReports.id }).from(chatReports)
    .where(eq(chatReports.reporterId, id)).orderBy(desc(chatReports.createdAt)).limit(1);
  const [last] = recent.length ? await db.select().from(chatReports).where(eq(chatReports.id, recent[0]!.id)) : [];
  if (last && Date.now() - last.createdAt.getTime() < 5000) throw new RoomError(429, "Please wait before submitting another report");
  const [report] = await db.insert(chatReports).values({ historyId, roomId, messageId: message.id,
    reporterId: id, reason: input.data.reason, details: input.data.details ?? "" }).returning();
  res.status(201).json({ id: report!.id, status: report!.status });
});
router.get("/account/chat/reports", async (req, res) => {
  await requireModerator(accountId(req));
  const reports = await db.select({ id: chatReports.id, status: chatReports.status,
    roomId: chatReports.roomId, messageId: chatReports.messageId, reason: chatReports.reason,
    details: chatReports.details, createdAt: chatReports.createdAt,
    text: roomMessages.text, username: roomMessages.username })
    .from(chatReports).innerJoin(roomMessages, eq(chatReports.messageId, roomMessages.id))
    .where(eq(chatReports.status, "pending")).orderBy(desc(chatReports.createdAt)).limit(100);
  res.json(GetChatReportsResponse.parse(reports));
});
router.patch("/account/chat/reports/:reportId", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await requireModerator(id);
  const params = ReviewChatReportParams.safeParse(req.params);
  const body = ReviewChatReportBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Choose a report and review action");
  const report = await db.transaction(async tx => {
    const [row] = await tx.select().from(chatReports).where(eq(chatReports.id, params.data.reportId)).for("update");
    if (!row) throw new RoomError(404, "Report not found");
    if (row.status !== "pending") throw new RoomError(409, "Report already reviewed");
    const [message] = await tx.select().from(roomMessages).where(eq(roomMessages.id, row.messageId));
    if (body.data.action === "restrict") {
      if (!message?.authorAccountId) throw new RoomError(409, "This historical message has no authenticated account binding");
      await tx.update(chatAdmissions).set({ suspended: true }).where(eq(chatAdmissions.accountId, message.authorAccountId));
    }
    if (body.data.action === "mute" && message?.authorAccountId) await tx.update(chatMemberships)
      .set({ muted: true }).where(and(eq(chatMemberships.historyId, row.historyId), eq(chatMemberships.accountId, message.authorAccountId)));
    if (body.data.action !== "dismiss") await tx.update(roomMessages).set({ hidden: "true" }).where(eq(roomMessages.id, row.messageId));
    const [updated] = await tx.update(chatReports).set({ reviewedBy: id,
      status: body.data.action === "dismiss" ? "dismissed" : body.data.action === "mute" ? "muted"
        : body.data.action === "restrict" ? "restricted" : "hidden" })
      .where(eq(chatReports.id, row.id)).returning();
    return updated!;
  });
  roomStore.refreshChatVisibility();
  res.json({ id: report.id, status: report.status });
});
export default router;
