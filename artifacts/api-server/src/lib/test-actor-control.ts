import { createServer, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import {
  accountProfiles, chatAdmissions, chatMemberships, chatModerators, chatReports, chatRooms, db,
  moderatorBotFlags, profilePhotos, roomMessages, socialGiftBag, socialGiftEvents,
  socialInventory, socialLedger, socialLoginStreaks, socialMessages, socialRelations,
  socialSettings, socialWallets, universityIgnores, universityPreferences,
} from "@workspace/db";
import { requireCompletedProfile } from "./account-profiles";
import { communityMembership, requireAdult } from "./community";
import { removeRetiredPhotoObject } from "./profile-photo-storage";
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
  if (!value || /[%_]/.test(value)) throw new RoomError(400, "Invalid room name");
  const mainRoomAlias = /^(.+)\s+1$/i.exec(value)?.[1];
  const [saved] = await db.select().from(chatRooms).where(or(
    eq(chatRooms.roomId, value.toUpperCase()),
    ilike(chatRooms.label, value),
    mainRoomAlias ? ilike(chatRooms.label, mainRoomAlias) : undefined,
  )).limit(1);
  if (!saved || !roomStore.isCommunity(saved.roomId)) throw new RoomError(404, "Room not found");
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
  if (!sessionId) throw new RoomError(409, "Join this room with the test actor before using it");
  roomStore.requireAccountMember(roomId, sessionId, accountId);
  return sessionId;
}

async function execute(command: TestActorCommand): Promise<unknown> {
  if (!testActorControlEnabled(process.env.NODE_ENV))
    throw new RoomError(403, "Test actor controls are available only in development");

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

  if (command.action === "cleanup-preview") return previewTestAccountCleanup();
  if (command.action === "cleanup-delete") return deleteTestAccounts(command.confirmation);

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
      throw new RoomError(409, "This test account already has a separately managed session in that room");
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
    if (!sessionId) throw new RoomError(409, "This test actor does not currently control a session in that room");
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
    throw new RoomError(403, "Test-coin gifts must stay between test accounts");
  const sessionId = requireDrivenSession(sender.accountId, room.roomId);
  requireDrivenSession(recipient.accountId, room.roomId);
  const result = await gift(sender.accountId, recipient.username, command.gift, crypto.randomUUID(), {
    roomId: room.roomId, sessionId,
  });
  return { sent: true, from: sender.username, to: recipient.username, gift: command.gift, testCreditsRemaining: result.balance };
}

export async function executeTestActorCommand(value: unknown): Promise<unknown> {
  const command = parseTestActorCommand(value);
  if (!command) throw new RoomError(400, "Invalid test actor command");
  return execute(command);
}

const count = async (query: Promise<{ count: number }[]>) => (await query)[0]?.count ?? 0;
function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  return value;
}
const cleanupFingerprint = (snapshot: unknown) =>
  createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");

async function previewTestAccountCleanup() {
  const accounts = await db.select({
    accountId: accountProfiles.accountId,
    username: accountProfiles.username,
    displayName: accountProfiles.displayName,
  }).from(accountProfiles).where(eq(accountProfiles.isTestAccount, true)).orderBy(accountProfiles.nameKey);
  const accountIds = accounts.map(account => account.accountId);

  if (accountIds.length === 0) {
    const snapshot = { accountIds, counts: {}, affectedRecords: {}, blockers: {}, retainedGiftEvents: 0 };
    return {
      accounts: [],
      counts: {},
      affectedRecords: {},
      blockers: { realAccountMessages: 0, crossAccountRelationships: 0 },
      retainedGiftEvents: 0,
      confirmation: cleanupFingerprint(snapshot),
      deletable: true,
    };
  }

  const ids = inArray;
  const inside = (column: any) => ids(column, accountIds);
  const outside = (column: any) => notInArray(column, accountIds);
  const crossMessage = or(
    and(inside(socialMessages.senderId), outside(socialMessages.recipientId)),
    and(inside(socialMessages.recipientId), outside(socialMessages.senderId)),
  );
  const crossRelations = or(
    and(inside(socialRelations.ownerId), outside(socialRelations.targetId)),
    and(inside(socialRelations.targetId), outside(socialRelations.ownerId)),
  );
  const crossIgnores = or(
    and(inside(universityIgnores.accountId), outside(universityIgnores.targetId)),
    and(inside(universityIgnores.targetId), outside(universityIgnores.accountId)),
  );
  const [counts, blockers, retainedGiftEvents] = await Promise.all([
    Promise.all([
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialWallets).where(inside(socialWallets.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialSettings).where(inside(socialSettings.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialInventory).where(inside(socialInventory.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialGiftBag).where(inside(socialGiftBag.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialLedger).where(inside(socialLedger.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialLoginStreaks).where(inside(socialLoginStreaks.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialMessages).where(and(
        inside(socialMessages.senderId), inside(socialMessages.recipientId),
      ))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialRelations).where(and(
        inside(socialRelations.ownerId), inside(socialRelations.targetId),
      ))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(universityIgnores).where(and(
        inside(universityIgnores.accountId), inside(universityIgnores.targetId),
      ))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(universityPreferences).where(inside(universityPreferences.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(chatMemberships).where(inside(chatMemberships.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(roomMessages).where(inside(roomMessages.authorAccountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(chatReports).where(inside(chatReports.reporterId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(moderatorBotFlags).where(inside(moderatorBotFlags.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(profilePhotos).where(inside(profilePhotos.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(chatAdmissions).where(inside(chatAdmissions.accountId))),
      count(db.select({ count: sql<number>`count(*)::int` }).from(chatModerators).where(inside(chatModerators.accountId))),
    ]),
    Promise.all([
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialMessages).where(crossMessage!)),
      count(db.select({ count: sql<number>`count(*)::int` }).from(socialRelations).where(crossRelations!)),
      count(db.select({ count: sql<number>`count(*)::int` }).from(universityIgnores).where(crossIgnores!)),
    ]),
    count(db.select({ count: sql<number>`count(*)::int` }).from(socialGiftEvents).where(or(
      inside(socialGiftEvents.senderId), inside(socialGiftEvents.recipientId),
    )!)),
  ]);
  const [
    wallets, settings, inventory, giftBag, ledger, loginStreaks, directMessages,
    socialRelationsCount, universityIgnoresCount, preferences, memberships,
    roomMessagesCount, reports, moderatorFlags, photos, admissions, moderators,
  ] = counts;
  const [realAccountMessages, realAccountRelations, realAccountIgnores] = blockers;
  const crossAccountRelationships = realAccountRelations + realAccountIgnores;
  const affectedRecords = {
    walletAccounts: (await db.select({ accountId: socialWallets.accountId }).from(socialWallets).where(inside(socialWallets.accountId))).map(row => row.accountId),
    settingsAccounts: (await db.select({ accountId: socialSettings.accountId }).from(socialSettings).where(inside(socialSettings.accountId))).map(row => row.accountId),
    inventory: await db.select({ accountId: socialInventory.accountId, itemId: socialInventory.itemId }).from(socialInventory).where(inside(socialInventory.accountId)),
    giftBag: await db.select({ accountId: socialGiftBag.accountId, giftId: socialGiftBag.giftId }).from(socialGiftBag).where(inside(socialGiftBag.accountId)),
    ledgerIds: (await db.select({ id: socialLedger.id }).from(socialLedger).where(inside(socialLedger.accountId))).map(row => row.id),
    loginStreakAccounts: (await db.select({ accountId: socialLoginStreaks.accountId }).from(socialLoginStreaks).where(inside(socialLoginStreaks.accountId))).map(row => row.accountId),
    directMessageIds: (await db.select({ id: socialMessages.id }).from(socialMessages).where(and(
      inside(socialMessages.senderId), inside(socialMessages.recipientId),
    ))).map(row => row.id),
    socialRelations: await db.select({ ownerId: socialRelations.ownerId, targetId: socialRelations.targetId, kind: socialRelations.kind }).from(socialRelations).where(and(
      inside(socialRelations.ownerId), inside(socialRelations.targetId),
    )),
    universityIgnores: await db.select({ accountId: universityIgnores.accountId, targetId: universityIgnores.targetId }).from(universityIgnores).where(and(
      inside(universityIgnores.accountId), inside(universityIgnores.targetId),
    )),
    preferenceAccounts: (await db.select({ accountId: universityPreferences.accountId }).from(universityPreferences).where(inside(universityPreferences.accountId))).map(row => row.accountId),
    memberships: await db.select({ accountId: chatMemberships.accountId, historyId: chatMemberships.historyId }).from(chatMemberships).where(inside(chatMemberships.accountId)),
    roomMessageIds: (await db.select({ id: roomMessages.id }).from(roomMessages).where(inside(roomMessages.authorAccountId))).map(row => row.id),
    reportIds: (await db.select({ id: chatReports.id }).from(chatReports).where(inside(chatReports.reporterId))).map(row => row.id),
    moderatorFlagIds: (await db.select({ id: moderatorBotFlags.id }).from(moderatorBotFlags).where(inside(moderatorBotFlags.accountId))).map(row => row.id),
    profilePhotoIds: (await db.select({ id: profilePhotos.id }).from(profilePhotos).where(inside(profilePhotos.accountId))).map(row => row.id),
    admissions: (await db.select({ accountId: chatAdmissions.accountId }).from(chatAdmissions).where(inside(chatAdmissions.accountId))).map(row => row.accountId),
    moderators: (await db.select({ accountId: chatModerators.accountId }).from(chatModerators).where(inside(chatModerators.accountId))).map(row => row.accountId),
  };

  const accountList = accounts.map(({ accountId, username, displayName }) => ({
      accountId, username, displayName: displayName ?? username,
    }));
  const cleanupCounts = {
      accounts: accounts.length,
      wallets, settings, inventory, giftBag, ledger, loginStreaks, directMessages,
      socialRelations: socialRelationsCount, universityIgnores: universityIgnoresCount,
      preferences, memberships, roomMessages: roomMessagesCount, reports, moderatorFlags,
      profilePhotos: photos, admissions, moderators,
  };
  const cleanupBlockers = { realAccountMessages, crossAccountRelationships };
  const confirmation = cleanupFingerprint({
    accountIds: accountIds.sort(),
    counts: cleanupCounts,
    affectedRecords,
    blockers: cleanupBlockers,
    retainedGiftEvents,
  });

  return {
    accounts: accountList,
    counts: cleanupCounts,
    affectedRecords,
    blockers: cleanupBlockers,
    retainedGiftEvents,
    retainedDataNote: "Historical gift receipts remain; deleting marked profiles will clear only their sender/recipient account IDs.",
    confirmation,
    deletable: realAccountMessages === 0 && crossAccountRelationships === 0,
  };
}

async function deleteTestAccounts(confirmation: string) {
  if (!testActorControlEnabled(process.env.NODE_ENV))
    throw new RoomError(403, "Test-account cleanup is available only in development");

  const preview = await previewTestAccountCleanup();
  if (confirmation !== preview.confirmation)
    throw new RoomError(409, "The marked-account set changed. Run cleanup preview again and confirm its new token");
  if (!preview.deletable)
    throw new RoomError(409, "Cleanup would remove messages or relationships involving real accounts; resolve the blockers first");
  const accountIds = preview.accounts.map(account => account.accountId);
  if (accountIds.length === 0) return { deleted: 0, accounts: [] };

  await db.transaction(async tx => {
    const locked = await tx.select({ accountId: accountProfiles.accountId })
      .from(accountProfiles)
      .where(eq(accountProfiles.isTestAccount, true))
      .orderBy(accountProfiles.accountId)
      .for("update");
    const lockedIds = locked.map(row => row.accountId).sort();
    if (JSON.stringify(lockedIds) !== JSON.stringify([...accountIds].sort()))
      throw new RoomError(409, "The marked-account set changed during cleanup; no accounts were removed");

    const currentPreview = await previewTestAccountCleanup();
    if (currentPreview.confirmation !== confirmation)
      throw new RoomError(409, "Marked accounts or related records changed after preview; no accounts were removed");

    const crossMessage = or(
      and(
        inArray(socialMessages.senderId, accountIds),
        notInArray(socialMessages.recipientId, accountIds),
      ),
      and(
        inArray(socialMessages.recipientId, accountIds),
        notInArray(socialMessages.senderId, accountIds),
      ),
    );
    const crossRelation = or(
      and(
        inArray(socialRelations.ownerId, accountIds),
        notInArray(socialRelations.targetId, accountIds),
      ),
      and(
        inArray(socialRelations.targetId, accountIds),
        notInArray(socialRelations.ownerId, accountIds),
      ),
    );
    const crossIgnore = or(
      and(
        inArray(universityIgnores.accountId, accountIds),
        notInArray(universityIgnores.targetId, accountIds),
      ),
      and(
        inArray(universityIgnores.targetId, accountIds),
        notInArray(universityIgnores.accountId, accountIds),
      ),
    );
    const [messageBlockers, relationBlockers, ignoreBlockers] = await Promise.all([
      count(tx.select({ count: sql<number>`count(*)::int` }).from(socialMessages).where(crossMessage!)),
      count(tx.select({ count: sql<number>`count(*)::int` }).from(socialRelations).where(crossRelation!)),
      count(tx.select({ count: sql<number>`count(*)::int` }).from(universityIgnores).where(crossIgnore!)),
    ]);
    if (messageBlockers || relationBlockers || ignoreBlockers)
      throw new RoomError(409, "Cleanup blockers appeared during deletion; no accounts were removed");

    const photos = await tx.select({
      id: profilePhotos.id,
      objectKey: profilePhotos.objectKey,
    }).from(profilePhotos).where(inArray(profilePhotos.accountId, accountIds));
    for (const photo of photos) await removeRetiredPhotoObject(photo.id, photo.objectKey);

    const selected = inArray(accountProfiles.accountId, accountIds);
    await tx.delete(socialMessages).where(and(
      inArray(socialMessages.senderId, accountIds),
      inArray(socialMessages.recipientId, accountIds),
    ));
    await tx.delete(socialRelations).where(and(
      inArray(socialRelations.ownerId, accountIds),
      inArray(socialRelations.targetId, accountIds),
    ));
    await tx.delete(universityIgnores).where(and(
      inArray(universityIgnores.accountId, accountIds),
      inArray(universityIgnores.targetId, accountIds),
    ));
    await tx.delete(chatMemberships).where(inArray(chatMemberships.accountId, accountIds));
    await tx.delete(roomMessages).where(inArray(roomMessages.authorAccountId, accountIds));
    await tx.delete(chatReports).where(inArray(chatReports.reporterId, accountIds));
    await tx.delete(moderatorBotFlags).where(inArray(moderatorBotFlags.accountId, accountIds));
    await tx.delete(profilePhotos).where(inArray(profilePhotos.accountId, accountIds));
    await tx.delete(chatAdmissions).where(inArray(chatAdmissions.accountId, accountIds));
    await tx.delete(chatModerators).where(inArray(chatModerators.accountId, accountIds));
    await tx.delete(accountProfiles).where(and(selected, eq(accountProfiles.isTestAccount, true)));
  });

  return {
    deleted: accountIds.length,
    accounts: preview.accounts.map(({ username, displayName }) => ({ username, displayName })),
    note: "Only marked application profiles and their test-only records were removed. External sign-in identities were not changed.",
  };
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
          const result = await executeTestActorCommand(raw);
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
