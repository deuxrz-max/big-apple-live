import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, accountProfiles, roomMessages } from "@workspace/db";
import { inArray, or } from "drizzle-orm";
import { saveProfile, getProfile } from "./account-profiles";
import { roomStore, RoomStore, EMPTY_ROOM_TIMEOUT_MS } from "./room-store";
import { acceptMessage, getMessages } from "./room-chat";
import chatRouter from "../routes/chat";
import identityRouter from "../routes/identity";
import roomsRouter from "../routes/rooms";
import type { Request, Response, NextFunction } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
/** Exercise real handlers with a trusted middleware auth fixture, not client claims.
 * Real Clerk middleware/sign-in was separately exercised by the browser run. */
async function requestHandler(
  router: unknown, method: string, path: string, roomId: string,
  accountId: string | null, sessionId?: string, body?: unknown,
) {
  const layer = (router as { stack: RouteLayer[] }).stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer?.route);
  const auth = () => ({ userId: accountId, tokenType: "session_token", sessionId: accountId ? "fixture-session" : null });
  // Current Clerk versions brand the server-installed auth accessor.
  Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
  const req = {
    params: { roomId }, body,
    get: (name: string) => name.toLowerCase() === "x-room-session" ? sessionId : undefined,
    auth,
  } as unknown as Request;
  let status = 200;
  let data: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    set() { return this; },
    json(value: unknown) { data = value; return this; },
  } as unknown as Response;
  try {
    await layer.route.stack[0]!.handle(req, res, (() => {}) as NextFunction);
  } catch (error) {
    status = (error as { status?: number }).status ?? 500;
  }
  return { status, data };
}

// Development DB integration: creates synthetic profiles, deletes only its own rows.
test("accepted chat persists sender-only mood atomically; rejects impersonation, leaves and bad text", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const aId = `chat-test-a-${suffix}`;
  const bId = `chat-test-b-${suffix}`;
  let roomId: string | undefined;
  const histories: string[] = [];
  const extraMessageIds: string[] = [];
  try {
    const aProfile = await saveProfile(aId, {
      username: `chatA_${suffix}`,
      identity: {
        emojiId: "1F642", gender: "Male", color: "#F7C531", hairColor: "#111111",
        portraitId: "spiked-smile", currentMood: "smiling",
      },
    });
    const bProfile = await saveProfile(bId, {
      username: `chatB_${suffix}`,
      identity: {
        emojiId: "1F642", gender: "Female", color: "#F7C531", hairColor: "#111111",
        portraitId: "ponytail-smile", currentMood: "smiling",
      },
    });
    const a = roomStore.create(aProfile.username, { accountId: aId, identity: aProfile.identity }, { name: "Integration Beam", capacity: 2 });
    roomId = a.room.roomId;
    histories.push(roomStore.getHistoryId(roomId));
    const b = roomStore.join(roomId, bProfile.username, { accountId: bId, identity: bProfile.identity });
    const publicFrames: string[] = [];
    const closeHandlers: (() => void)[] = [];
    const publicStream = (roomsRouter as unknown as { stack: RouteLayer[] }).stack
      .find(l => l.route?.path === "/rooms/:roomId/events" && l.route.methods.get)!;
    const publicResponse = {
      set() { return this; }, flushHeaders() {},
      write(frame: string) { publicFrames.push(frame); return true; },
      on(_event: string, handler: () => void) { closeHandlers.push(handler); },
    } as unknown as Response;
    await publicStream.route!.stack[0]!.handle(
      { params: { roomId } } as unknown as Request, publicResponse, (() => {}) as NextFunction,
    );
    let acceptedEvents = 0;
    const unsubscribe = roomStore.subscribe(roomId, event => {
      if (event.type !== "chat.accepted") return;
      acceptedEvents++;
      assert.equal(event.data.message.authorId, a.participantId);
    });
    const result = await acceptMessage(roomId, a.participantSessionId, aId, { kind: "text", text: "hello 😂" });
    assert.equal(result.profile.identity.currentMood, "tears_of_joy");
    assert.equal(result.profile.identity.portraitId, "spiked-tears-of-joy");
    assert.equal(result.message.identity.portraitId, "spiked-tears-of-joy");
    assert.equal(result.message.authorId, a.participantId);
    assert.equal((await getProfile(aId))!.identity.portraitId, "spiked-tears-of-joy");
    assert.equal((await getProfile(bId))!.identity.portraitId, "ponytail-smile");
    assert.equal((await getMessages(roomId))[0]!.id, result.message.id);
    assert.equal(acceptedEvents, 1);
    await acceptMessage(roomId, a.participantSessionId, aId, { kind: "text", text: "🥹🔥" });
    assert.equal((await getProfile(aId))!.identity.portraitId, "spiked-tears-of-joy");
    const saved = (await getProfile(aId))!;
    // Older clients may omit mood/artwork without resetting them.
    const { portraitId: _portrait, currentMood: _mood, ...legacy } = saved.identity;
    await saveProfile(aId, { username: saved.username, identity: legacy });
    assert.equal((await getProfile(aId))!.identity.currentMood, "tears_of_joy");
    const count = (await getMessages(roomId)).length;
    for (const forged of ["authorId", "accountId", "identity", "currentMood", "portraitId"]) {
      const response = await requestHandler(chatRouter, "post", "/account/rooms/:roomId/messages", roomId, aId,
        a.participantSessionId, { kind: "text", text: "😭", [forged]: b.participantId });
      assert.equal(response.status, 400, `forged ${forged} must be rejected`);
    }
    const stolen = await requestHandler(chatRouter, "post", "/account/rooms/:roomId/messages", roomId, aId,
      b.participantSessionId, { kind: "text", text: "😭" });
    assert.equal(stolen.status, 401);
    const noCredential = await requestHandler(chatRouter, "get", "/account/rooms/:roomId/messages", roomId, aId);
    assert.equal(noCredential.status, 401);
    const signedOut = await requestHandler(chatRouter, "get", "/account/rooms/:roomId/messages", roomId, null,
      a.participantSessionId);
    assert.equal(signedOut.status, 401);
    for (const id of [aId, bId]) {
      const me = await requestHandler(identityRouter, "get", "/me", roomId, id);
      assert.equal(me.status, 200);
      assert.equal((me.data as { profile: { username: string } }).profile.username,
        id === aId ? aProfile.username : bProfile.username);
    }
    await assert.rejects(saveProfile(aId, { username: `renamed_${suffix}`, identity: saved.identity }));
    await assert.rejects(acceptMessage(roomId, b.participantSessionId, aId, { kind: "text", text: "😭" }));
    await assert.rejects(acceptMessage(roomId, a.participantSessionId, aId, { kind: "text", text: " " }));
    await assert.rejects(acceptMessage(roomId, a.participantSessionId, aId, { kind: "text", text: "😭".repeat(141) }));
    assert.equal((await getMessages(roomId)).length, count);
    assert.equal((await getProfile(aId))!.identity.portraitId, "spiked-tears-of-joy");
    assert.equal((await getProfile(bId))!.identity.portraitId, "ponytail-smile");
    roomStore.leave(roomId, a.participantSessionId);
    await assert.rejects(acceptMessage(roomId, a.participantSessionId, aId, { kind: "reaction", text: "😭" }));
    assert.equal((await getMessages(roomId)).length, count);
    assert.equal(acceptedEvents, 2);
    assert.ok(publicFrames.some(frame => frame.startsWith("event: room.snapshot")));
    assert.equal(publicFrames.some(frame => frame.includes("chat.accepted") || frame.includes("hello 😂")), false);
    closeHandlers.forEach(close => close());
    unsubscribe();
    roomStore.leave(roomId, b.participantSessionId);

    // Force code reuse to verify history isolation independent of randomness.
    let now = Date.now();
    const code = suffix.slice(0, 6).toUpperCase();
    const store = new RoomStore(() => now, () => code);
    const old = store.create(aProfile.username, { accountId: aId, identity: aProfile.identity }, { name: "Old Beam", capacity: 2 });
    const oldKey = store.getHistoryId(code);
    histories.push(oldKey);
    const oldMessage = await acceptMessage(code, old.participantSessionId, aId,
      { kind: "text", text: "old private conversation" }, store);
    assert.equal((await getMessages(code, store))[0]!.id, oldMessage.message.id);
    store.leave(code, old.participantSessionId);
    now += EMPTY_ROOM_TIMEOUT_MS + 1;
    store.sweep();
    const replacement = store.create(bProfile.username, { accountId: bId, identity: bProfile.identity }, { name: "New Beam", capacity: 2 });
    histories.push(store.getHistoryId(code));
    assert.equal(replacement.room.roomId, old.room.roomId);
    assert.notEqual(store.getHistoryId(code), oldKey);
    assert.deepEqual(await getMessages(code, store), []);
    await assert.rejects(acceptMessage(code, old.participantSessionId, aId,
      { kind: "text", text: "stale credential" }, store));
    let leakedEvents = 0;
    store.subscribe(code, event => { if (event.type === "chat.accepted") leakedEvents++; });
    store.publishChat(code, oldKey, oldMessage);
    assert.equal(leakedEvents, 0);
    await acceptMessage(code, replacement.participantSessionId, bId,
      { kind: "text", text: "new conversation only" }, store);
    assert.deepEqual((await getMessages(code, store)).map(m => m.text), ["new conversation only"]);
    const restarted = new RoomStore(() => now, () => code);
    restarted.create(aProfile.username, { accountId: aId, identity: aProfile.identity }, { name: "Restarted Beam", capacity: 2 });
    histories.push(restarted.getHistoryId(code));
    assert.deepEqual(await getMessages(code, restarted), []);
    const [legacyRow] = await db.insert(roomMessages).values({
      roomId: code, authorId: old.participantId, username: aProfile.username,
      identity: aProfile.identity, kind: "text", text: "unbound legacy history",
    }).returning({ id: roomMessages.id });
    extraMessageIds.push(legacyRow!.id);
    assert.deepEqual(await getMessages(code, restarted), []);
  } finally {
    await db.delete(roomMessages).where(or(
      inArray(roomMessages.historyId, histories), inArray(roomMessages.id, extraMessageIds),
    ));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, [aId, bId]));
    await pool.end();
  }
});