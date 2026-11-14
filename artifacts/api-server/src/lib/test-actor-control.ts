import { createServer, type Socket } from 'node:net';
import { chmodSync, lstatSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, ilike, or } from 'drizzle-orm';
import { accountProfiles, chatRooms, db } from '@workspace/db';
import { requireCompletedProfile } from './account-profiles';
import { communityMembership, requireAdult } from './community';
import { acceptMessage } from './room-chat';
import { roomStore, RoomError } from './room-store';
import { sendMessage } from './social/messages';
import { mayReceiveTestDm, parseTestActorCommand, testActorControlEnabled, type TestActorCommand } from './test-actor-policy';

const socketPath = join(tmpdir(), `streamtalk-test-actors-${process.env.PORT ?? '8080'}.sock`);
const activeSessions = new Map<string, Map<string, string>>();
const sessionsFor = (accountId: string) => {
  let sessions = activeSessions.get(accountId);
  if (!sessions) activeSessions.set(accountId, sessions = new Map());
  return sessions;
};
type TestProfile = typeof accountProfiles.$inferSelect;

async function testAccount(raw: string): Promise<TestProfile> {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) throw new RoomError(400, 'Invalid test-account username');
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.nameKey, name.toLowerCase())).limit(1);
  if (!profile?.isTestAccount) throw new RoomError(403, 'Only accounts explicitly marked as test accounts can be driven');
  return profile;
}
async function targetAccount(raw: string): Promise<TestProfile> {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) throw new RoomError(400, 'Invalid recipient username');
  const [profile] = await db.select().from(accountProfiles).where(eq(accountProfiles.nameKey, name.toLowerCase())).limit(1);
  if (!profile) throw new RoomError(404, 'Recipient not found');
  return profile;
}
async function targetRoom(raw: string) {
  const value = raw.trim().slice(0, 80);
  if (!value || /[%_]/.test(value)) throw new RoomError(400, 'Invalid room name');
  const alias = /^(.+)\s+1$/i.exec(value)?.[1];
  const [saved] = await db.select().from(chatRooms).where(or(
    eq(chatRooms.roomId, value.toUpperCase()), ilike(chatRooms.label, value),
    alias ? ilike(chatRooms.label, alias) : undefined,
  )).limit(1);
  if (!saved || !roomStore.isCommunity(saved.roomId)) throw new RoomError(404, 'Room not found');
  return saved;
}
function requireDrivenSession(accountId: string, roomId: string) {
  const sessionId = activeSessions.get(accountId)?.get(roomId);
  if (!sessionId) throw new RoomError(409, 'Join this room with the test actor before using it');
  roomStore.requireAccountMember(roomId, sessionId, accountId);
  return sessionId;
}

async function execute(command: TestActorCommand): Promise<unknown> {
  if (!testActorControlEnabled(process.env.NODE_ENV)) throw new RoomError(403, 'Test actor controls are available only in development');
  if (command.action === 'list') {
    const rows = await db.select({ username: accountProfiles.username, displayName: accountProfiles.displayName })
      .from(accountProfiles).where(eq(accountProfiles.isTestAccount, true)).orderBy(accountProfiles.nameKey);
    return { accounts: rows.map(row => ({ username: row.username, displayName: row.displayName ?? row.username })) };
  }
  if (command.action === 'join') {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    await requireAdult(actor.accountId);
    const profile = await requireCompletedProfile(actor.accountId);
    const current = activeSessions.get(actor.accountId)?.get(room.roomId);
    if (current) {
      roomStore.requireAccountMember(room.roomId, current, actor.accountId);
      return { joined: true, room: room.label, alreadyJoined: true };
    }
    if (roomStore.accountSession(room.roomId, actor.accountId))
      throw new RoomError(409, 'This test account already has a separately managed session in that room');
    const membership = await communityMembership(room.roomId, actor.accountId);
    const session = roomStore.join(room.roomId, profile.displayName ?? profile.username, {
      accountId: actor.accountId, identity: profile.identity, capExempt: false,
    });
    roomStore.restoreParticipantId(room.roomId, actor.accountId, membership.participantId);
    sessionsFor(actor.accountId).set(room.roomId, session.participantSessionId);
    return { joined: true, room: room.label, peopleHere: roomStore.get(room.roomId).participants.length };
  }
  if (command.action === 'leave') {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    const sessionId = activeSessions.get(actor.accountId)?.get(room.roomId);
    if (!sessionId) throw new RoomError(409, 'This test actor does not currently control a session in that room');
    roomStore.requireAccountMember(room.roomId, sessionId, actor.accountId);
    roomStore.leave(room.roomId, sessionId);
    activeSessions.get(actor.accountId)?.delete(room.roomId);
    return { left: true, room: room.label };
  }
  if (command.action === 'chat') {
    const [actor, room] = await Promise.all([testAccount(command.as), targetRoom(command.room)]);
    const accepted = await acceptMessage(room.roomId, requireDrivenSession(actor.accountId, room.roomId), actor.accountId, {
      kind: 'text', text: command.text,
    });
    return { sent: true, room: room.label, messageId: accepted.message.id };
  }
  const sender = await testAccount(command.as);
  const recipient = await targetAccount(command.to);
  if (!mayReceiveTestDm(recipient)) throw new RoomError(403, 'Test messages can go only to another test account or the owner');
  const result = await sendMessage(sender.accountId, recipient.username, command.text, crypto.randomUUID());
  return { sent: true, from: result.sender, to: result.recipient, messageId: result.id };
}

export async function executeTestActorCommand(value: unknown) {
  const command = parseTestActorCommand(value);
  if (!command) throw new RoomError(400, 'Invalid test actor command');
  return execute(command);
}
function cleanupSocketPath() {
  try {
    if (lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
    else throw new Error('Test actor control path exists and is not a socket');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
function send(socket: Socket, value: unknown) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
}

export async function startTestActorControl(): Promise<void> {
  if (!testActorControlEnabled(process.env.NODE_ENV)) return;
  cleanupSocketPath();
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    let input = '';
    let answered = false;
    socket.on('data', (chunk: string) => {
      if (answered) return;
      input += chunk;
      if (input.length > 16_384) { answered = true; send(socket, { ok: false, status: 413, error: 'Test command is too large' }); return; }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      answered = true;
      void (async () => {
        try {
          let raw: unknown;
          try { raw = JSON.parse(input.slice(0, newline)); } catch { throw new RoomError(400, 'Invalid test actor command'); }
          send(socket, { ok: true, result: await executeTestActorCommand(raw) });
        } catch (error) {
          send(socket, { ok: false, status: error instanceof RoomError ? error.status : 500,
            error: error instanceof RoomError ? error.message : 'Test actor command failed' });
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(socketPath, () => { server.off('error', onError); chmodSync(socketPath, 0o600); resolve(); });
  });
  server.on('error', () => { /* local-only control; never log command data */ });
  const heartbeat = setInterval(() => {
    for (const [accountId, sessions] of activeSessions) for (const [roomId, sessionId] of sessions) {
      try { roomStore.heartbeat(roomId, sessionId); }
      catch { sessions.delete(roomId); if (!sessions.size) activeSessions.delete(accountId); }
    }
  }, 15_000);
  heartbeat.unref();
  const close = () => { clearInterval(heartbeat); server.close(() => { try { unlinkSync(socketPath); } catch { /* already closed */ } }); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.once('exit', () => { try { unlinkSync(socketPath); } catch { /* already removed */ } });
}
