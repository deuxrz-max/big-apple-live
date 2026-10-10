import { createServer, type Socket } from "node:net";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, ilike, or } from "drizzle-orm";
import {
  accountProfiles, chatRooms, db, socialWallets,
} from "@workspace/db";
import { requireCompletedProfile } from "./account-profiles";
import { communityMembership, requireAdult } from "./community";
import { acceptMessage } from "./room-chat";
import { roomStore, RoomError } from "./room-store";
import { gift } from "./social/rewards";
import { sendMessage } from "./social/messages";
import {
  isTestGiftPair, mayReceiveTestDm, parseTestActorCommand,
  testActorControlEnabled, type TestActorCommand,
} from "./test-actor-policy";

const socketPath = join(tmpdir(), `streamtalk-test-actors-${process.env.PORT ?? "8080"}.sock`);
const activeSessions = new Map<string, Map<string, string>>();
const sessionKey = (accountId: string, roomId: string) => `${accountId}:${roomId}`;

type TestActorProfile = typeof accountProfiles.$inferSelect;

async function testAccount(rawUsername: string): Promise<TestActorProfile> {
  const normalized = rawUsername.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(normalized)) throw new RoomError(400, "Invalid test-account username");
  const [profile] = await db.select().from(accountProfiles)
    .where(eq(accountProfiles.nameKey, normalized.toLowerCase())).limit(1);
  if (!profile?.isTestAccount) throw new RoomError(403, "Only accounts explicitly marked as test accounts can be driven");
  return profile;
}

async function targetProfile(rawUsername: string): Promise<TestActorProfile> {
  const normalized = rawUsername.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(normalized)) throw new RoomError(400, "Invalid recipient username");
  const [profile] = await db.select().from(accountProfiles)
    .where(eq(accountProfiles.nameKey, normalized.toLowerCase())).limit(1);
  if (!profile) throw new RoomError(404, "Recipient not found");
  return profile;
}

async function targetRoom(rawRoom: string) {
  const value = rawRoom.trim().slice(0, 80);
  if (!value || /[%_]/.test(value)) throw new RoomError(400, "Invalid university name");
  const mainRoomAlias = /^(.+)\s+1$/i.exec(value)?.[1];
  const [saved] = await db.select().from(chatRooms).where(or(
    eq(chatRooms.roomId, value.toUpperCase()),
    ilike(chatRooms.label, value),
    mainRoomAlias ? ilike(chatRooms.label, mainRoomAlias) : undefined,
  )).limit(1);
  if (!saved || !roomStore.isCommunity(saved.roomId)) throw new RoomError(404, "University not found");
  return saved;
}

function sessionsFor(accountId: string) {
  let sessions = activeSessions.get(accountId);
  if (!sessions) {
    sessions = new Map();
    activeSessions.set(accountId, sessions);
  }
  return sessions;
}

function requireDrivenSession(accountId: string, roomId: string) {
  const sessionId = activeSessions.get(accountId)?.get(roomId);
  if (!sessionId) throw new RoomError(409, "Join this university with the test actor before using it");
  roomStore.requireAccountMember(roomId, sessionId, accountId);
  return sessionId;
}

async function execute(command: TestActorCommand): Promise<unknown> {
  if (command.action === "list") {
    const rows = await db.select({
      username: accountProfiles.username,
      displayName: accountProfiles.displayName,
      balance: socialWallets.balance,
    }).from(accountProfiles).leftJoin(socialWallets, eq(socialWallets.accountId, accountProfiles.accountId))
      .where(eq(accountProfiles.isTestAccount, true)).orderBy(accountProfiles.nameKey);
    return { accounts: rows.map(row => ({
      username: row.username, displayName: row.displayName ?? row.username,
      testCredits: row.balance ?? 0,
    })) };
  }

  if (command.action === "join") {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    await requireAdult(actor.accountId);
    const profile = await requireCompletedProfile(actor.accountId);
    const alreadyDriven = activeSessions.get(actor.accountId)?.get(room.roomId);
    if (alreadyDriven) {
      roomStore.requireAccountMember(room.roomId, alreadyDriven, actor.accountId);
      return { joined: true, room: room.label, alreadyJoined: true };
    }
    if (roomStore.accountSession(room.roomId, actor.accountId))
      throw new RoomError(409, "This test account already has a separately managed session in that university");
    const membership = await communityMembership(room.roomId, actor.accountId);
    const session = roomStore.join(room.roomId, profile.displayName ?? profile.username, {
      accountId: actor.accountId, identity: profile.identity, capExempt: false,
    });
    roomStore.restoreParticipantId(room.roomId, actor.accountId, membership.participantId);
    sessionsFor(actor.accountId).set(room.roomId, session.participantSessionId);
    return { joined: true, room: room.label, peopleHere: roomStore.get(room.roomId).participants.length };
  }

  if (command.action === "leave") {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    const sessionId = activeSessions.get(actor.accountId)?.get(room.roomId);
    if (!sessionId) throw new RoomError(409, "This test actor does not currently control a session in that university");
    roomStore.requireAccountMember(room.roomId, sessionId, actor.accountId);
    roomStore.leave(room.roomId, sessionId);
    activeSessions.get(actor.accountId)?.delete(room.roomId);
    return { left: true, room: room.label };
  }

  if (command.action === "chat") {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    const sessionId = requireDrivenSession(actor.accountId, room.roomId);
    const accepted = await acceptMessage(room.roomId, sessionId, actor.accountId, { kind: "text", text: command.text });
    return { sent: true, room: room.label, messageId: accepted.message.id };
  }

  if (command.action === "dm") {
    const sender = await testAccount(command.as);
    const recipient = await targetProfile(command.to);
    if (!mayReceiveTestDm(recipient)) {
      throw new RoomError(403, "Test DMs can go only to another test account or the owner's account");
    }
    const result = await sendMessage(sender.accountId, recipient.username, command.text, crypto.randomUUID());
    return { sent: true, from: result.sender, to: result.recipient, messageId: result.id };
  }

  const [sender, recipient, room] = await Promise.all([
    testAccount(command.as), testAccount(command.to), targetRoom(command.room),
  ]);
  if (!isTestGiftPair(sender.isTestAccount, recipient.isTestAccount))
    throw new RoomError(403, "Test-credit gifts must stay between test accounts");
  const sessionId = requireDrivenSession(sender.accountId, room.roomId);
  requireDrivenSession(recipient.accountId, room.roomId);
  const result = await gift(sender.accountId, recipient.username, command.gift, crypto.randomUUID(), {
    roomId: room.roomId, sessionId,
  });
  return { sent: true, from: sender.username, to: recipient.username, gift: command.gift, testCreditsRemaining: result.balance };
}

function cleanupSocketPath() {
  try {
    if (lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
    else throw new Error("Test actor control path exists and is not a socket");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function send(socket: Socket, value: unknown) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

export async function startTestActorControl(): Promise<void> {
  if (!testActorControlEnabled(process.env.NODE_ENV)) return;
  cleanupSocketPath();
  const server = createServer(socket => {
    socket.setEncoding("utf8");
    let input = "";
    let answered = false;
    socket.on("data", (chunk: string) => {
      if (answered) return;
      input += chunk;
      if (input.length > 16_384) {
        answered = true;
        send(socket, { ok: false, status: 413, error: "Test command is too large" });
        return;
      }
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      answered = true;
      void (async () => {
        try {
          let raw: unknown;
          try { raw = JSON.parse(input.slice(0, newline)); }
          catch { throw new RoomError(400, "Invalid test actor command"); }
          const command = parseTestActorCommand(raw);
          if (!command) throw new RoomError(400, "Invalid test actor command");
          const result = await execute(command);
          send(socket, { ok: true, result });
        } catch (error) {
          send(socket, {
            ok: false,
            status: error instanceof RoomError ? error.status : 500,
            error: error instanceof RoomError ? error.message : "Test actor command failed",
          });
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(socketPath, () => {
      server.off("error", onError);
      chmodSync(socketPath, 0o600);
      resolve();
    });
  });
  server.on("error", () => {
    // This private control is local-only; never echo submitted command contents to logs.
  });
  const heartbeatTimer = setInterval(() => {
    for (const [accountId, sessions] of activeSessions) {
      for (const [roomId, sessionId] of sessions) {
        try { roomStore.heartbeat(roomId, sessionId); }
        catch {
          sessions.delete(roomId);
          if (sessions.size === 0) activeSessions.delete(accountId);
        }
      }
    }
  }, 15_000);
  heartbeatTimer.unref();
  const close = () => {
    clearInterval(heartbeatTimer);
    server.close(() => {
      try { unlinkSync(socketPath); } catch { /* process is already shutting down */ }
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.once("exit", () => {
    try { unlinkSync(socketPath); } catch { /* socket was already removed */ }
  });
}
