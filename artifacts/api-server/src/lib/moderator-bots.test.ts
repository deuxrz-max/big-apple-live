import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request, type ErrorRequestHandler } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, accountProfiles, chatRooms, chatAdmissions, chatMemberships, chatModerators,
  moderatorBotFlags, roomMessages, socialMessages, socialRelations, socialSettings, universityIgnores } from "@workspace/db";
import botRouter from "../routes/moderator-bots";
import chatRouter from "../routes/chat";
import communityRouter from "../routes/community";
import { roomStore } from "./room-store";
import { botRotation, botSettings } from "./moderator-bots";
import { acceptMessage, getMessages } from "./room-chat";
import { universitySession, sendWhisper } from "./university-chat";
import { targetAccount } from "./social/core";

test("development integration: public filtering, private-message exclusion and moderator-only review", async t => {
  if (process.env.NODE_ENV === "production") throw new Error("Preview fixtures must never run in production");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const ids = [0, 1, 2].map(n => `bot-check-${suffix}-${n}`);
  const names = [0, 1, 2].map(n => `BotCheck${suffix}${n}`);
  const code = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const historyId = randomUUID();
  const identity = { emojiId: "neutral", gender: "Male" as const, color: "#000000", hairColor: "#000000" };
  const sessions: string[] = [];
  const app = express();
  app.use((req, _res, next) => {
    const actor = Number(req.get("X-Fixture-User") ?? -1);
    const userId = ids[actor] ?? null;
    const auth = () => ({ userId, tokenType: "session_token", sessionId: userId ? "fixture-session" : null });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    (req as Request & { auth: typeof auth }).auth = auth; next();
  });
  app.use(express.json()); app.use(botRouter); app.use(chatRouter); app.use(communityRouter);
  const errors: ErrorRequestHandler = (err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message });
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (actor: number, path: string, body?: unknown, method = "GET") => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "X-Fixture-User": String(actor),
      "X-Room-Session": sessions[actor] ?? "" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  t.after(async () => {
    for (let n = 0; n < sessions.length; n++) roomStore.leave(code, sessions[n]!);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(socialMessages).where(or(inArray(socialMessages.senderId, ids), inArray(socialMessages.recipientId, ids)));
    await db.delete(roomMessages).where(eq(roomMessages.historyId, historyId));
    await db.delete(chatMemberships).where(eq(chatMemberships.historyId, historyId));
    await db.delete(chatRooms).where(eq(chatRooms.historyId, historyId));
    await db.delete(chatModerators).where(inArray(chatModerators.accountId, ids));
    await db.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, n) => ({
    accountId, username: names[n]!, nameKey: names[n]!.toLowerCase(),
    displayName: n === 1 ? "Ghost Bot" : `Bot test ${n}`, ...identity,
  })));
  await db.insert(chatAdmissions).values(ids.map(accountId => ({ accountId })));
  await db.insert(socialSettings).values(ids.map(accountId => ({ accountId, discoverable: true })));
  // Isolated temporary role only; never the owner or a persistent test account.
  await db.insert(chatModerators).values({ accountId: ids[0]! });
  await db.insert(chatRooms).values({ roomId: code, historyId, label: "Bot test university" });
  roomStore.registerCommunity({ roomId: code, historyId, label: "Bot test university", createdAt: new Date() });
  for (let n = 0; n < ids.length; n++) {
    sessions.push(roomStore.join(code, names[n]!, { accountId: ids[n]!, identity }).participantSessionId);
    await db.insert(chatMemberships).values({ historyId, accountId: ids[n]! });
  }
  const settings = await botSettings();
  const bad = settings.bannedWords[0] ?? "https://spam.test https://spam.test https://spam.test";
  let warningId = "";
  let flagId = "";
  await t.test("a visiting bot is in People but a real user copying its name never gets botId", async () => {
    botRotation.tick([code], Date.now() + 50_000);
    const people = (await universitySession(ids[2]!, code, sessions[2]!)).people;
    assert.equal(people.filter(p => p.botId).length, 1);
    const spoof = people.find(p => p.username === names[1])!;
    assert.equal(spoof.displayName, "Ghost Bot");
    assert.equal(spoof.botId, null);
    assert.equal(roomStore.get(code).participants.length, 3);
    for (const name of ["Ghost Bot", "Vampire Bot", "Wolf Bot", "Zombie Bot"])
      await assert.rejects(targetAccount(name));
  });
  await t.test("bad public text is atomically hidden, flagged and replaced with an immune warning", async () => {
    const events: { senderAccountId?: string }[] = [];
    const unsubscribe = roomStore.subscribe(code, event => { if (event.type === "chat.accepted") events.push(event); });
    const accepted = await acceptMessage(code, sessions[1]!, ids[1]!, { kind: "text", text: bad });
    unsubscribe();
    warningId = accepted.message.id;
    assert.ok(accepted.message.botId);
    assert.notEqual(accepted.message.text, bad);
    assert.ok(accepted.message.text.includes(names[1]!));
    assert.equal(events[0]!.senderAccountId, undefined);
    const [hidden] = await db.select().from(roomMessages).where(and(
      eq(roomMessages.historyId, historyId), eq(roomMessages.authorAccountId, ids[1]!)));
    assert.equal(hidden!.hidden, "true");
    const [flag] = await db.select().from(moderatorBotFlags).where(eq(moderatorBotFlags.messageId, hidden!.id));
    flagId = flag!.id;
    for (const viewer of ids) {
      const visible = await getMessages(code, roomStore, viewer);
      assert.ok(visible.some(m => m.id === warningId));
      assert.equal(visible.some(m => m.text === bad), false);
    }
    await db.insert(universityIgnores).values({ accountId: ids[2]!, targetId: ids[1]! });
    await db.insert(socialRelations).values({ ownerId: ids[2]!, targetId: ids[1]!, kind: "block" });
    assert.ok((await getMessages(code, roomStore, ids[2]!)).some(m => m.id === warningId));
    const repeated = await acceptMessage(code, sessions[1]!, ids[1]!, { kind: "text", text: bad });
    assert.equal(repeated.message.id, warningId, "warnings are throttled without exposing the next violation");
  });
  await t.test("private whispers with the same words are not scanned or flagged", async () => {
    const [before] = await db.select({ n: sql<number>`count(*)::int` }).from(moderatorBotFlags)
      .where(eq(moderatorBotFlags.roomId, code));
    await sendWhisper(ids[2]!, code, sessions[2]!, names[0]!, bad, randomUUID());
    const privateRows = await db.select().from(socialMessages).where(eq(socialMessages.senderId, ids[2]!));
    assert.equal(privateRows[0]!.body, bad);
    const [after] = await db.select({ n: sql<number>`count(*)::int` }).from(moderatorBotFlags)
      .where(eq(moderatorBotFlags.roomId, code));
    assert.equal(after!.n, before!.n);
  });
  await t.test("non-moderators cannot see flags/settings or review; bot impersonation and reporting fail", async () => {
    assert.equal((await request(2, "/account/chat/bots/flags")).status, 403);
    assert.equal((await request(2, "/account/chat/bots/settings")).status, 403);
    assert.equal((await request(2, "/account/chat/bots/chatter")).status, 403);
    assert.equal((await request(2, `/account/chat/bots/flags/${flagId}/review`, {}, "POST")).status, 403);
    assert.equal((await request(1, `/account/rooms/${code}/messages`,
      { text: "I am official", kind: "text", botId: "ghost" }, "POST")).status, 400);
    assert.equal((await request(2, "/account/chat/reports",
      { roomId: code, messageId: warningId, reason: "harassment" }, "POST")).status, 400);
  });
  await t.test("public flooding keeps the existing 429 while recording and warning about the hidden message", async () => {
    for (let n = 0; n < 5; n++) await acceptMessage(code, sessions[0]!, ids[0]!,
      { kind: "text", text: `Public bot test ${n}` });
    await assert.rejects(acceptMessage(code, sessions[0]!, ids[0]!,
      { kind: "text", text: "Flood test: this must not appear" }), /Slow down/);
    const [flag] = await db.select().from(moderatorBotFlags).where(and(
      eq(moderatorBotFlags.roomId, code), eq(moderatorBotFlags.accountId, ids[0]!)));
    assert.equal(flag!.reason, "Flooding");
    assert.ok((await getMessages(code, roomStore, ids[2]!)).some(m =>
      m.botId && m.botMessageType === "moderation" && m.text.includes(names[0]!)));
    assert.equal((await getMessages(code, roomStore, ids[2]!)).some(m =>
      m.text === "Flood test: this must not appear"), false);
  });
  await t.test("moderator reviews who/what/room/when; settings validation and acknowledgement preserve hidden text", async () => {
    const response = await request(0, "/account/chat/bots/flags");
    assert.equal(response.status, 200);
    const flags = await response.json() as { id: string; text: string; roomLabel: string; createdAt: string }[];
    const own = flags.find(f => f.id === flagId)!;
    assert.equal(own.text, bad);
    assert.equal(own.roomLabel, "Bot test university");
    assert.ok(own.createdAt);
    assert.equal((await request(0, "/account/chat/bots/settings")).status, 200);
    assert.equal((await request(0, "/account/chat/bots/settings",
      { bannedWords: ["bad"], breakSeconds: 1 }, "PUT")).status, 400);
    const chatter = await request(0, "/account/chat/bots/chatter");
    assert.equal(chatter.status, 200);
    const chatterConfig = await chatter.json() as { enabled: boolean; frequency: string; bots: { id: string; lines: string[] }[] };
    assert.equal(chatterConfig.bots.length, 4);
    assert.ok(chatterConfig.bots.every(bot => bot.lines.length >= 20 && bot.lines.length <= 30));
    assert.equal((await request(0, "/account/chat/bots/chatter",
      { enabled: true, frequency: "normal", bots: [] }, "PUT")).status, 400);
    const reviewed = await request(0, `/account/chat/bots/flags/${flagId}/review`, {}, "POST");
    assert.equal(reviewed.status, 200);
    assert.ok((await reviewed.json() as { reviewedAt: string }).reviewedAt);
    assert.equal((await getMessages(code, roomStore, ids[0]!)).some(m => m.text === bad), false);
  });
});
