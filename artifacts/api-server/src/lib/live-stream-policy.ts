import { createHash } from "node:crypto";
import { liveKitBeamService } from "./livekit";
import { RoomError } from "./room-store";

const STARTING_TTL_MS = 60_000;
const startingAccounts = new Map<string, number>();

export function liveStreamIdForAccount(accountId: string): string {
  return createHashHex(accountId).slice(0, 32);
}

export function liveStreamRoomName(streamId: string): string {
  return `st-live-${streamId}`;
}

function createHashHex(value: string): string {
  // Node crypto is kept on the server; account IDs are never exposed as room names.
  return createHash("sha256").update(value).digest("hex");
}

export function reserveLiveStreamStart(accountId: string): void {
  const until = startingAccounts.get(accountId) ?? 0;
  if (until > Date.now()) throw new RoomError(409, "A livestream is already starting for this account.");
  startingAccounts.set(accountId, Date.now() + STARTING_TTL_MS);
}

export function clearLiveStreamStart(accountId: string): void {
  startingAccounts.delete(accountId);
}

export function isLiveStreamStarting(accountId: string): boolean {
  const until = startingAccounts.get(accountId) ?? 0;
  if (until > Date.now()) return true;
  if (until) startingAccounts.delete(accountId);
  return false;
}

export async function isLiveStreamActiveOrStarting(accountId: string): Promise<boolean> {
  if (isLiveStreamStarting(accountId)) return true;
  const roomName = liveStreamRoomName(liveStreamIdForAccount(accountId));
  const participants = await liveKitBeamService.listParticipants(roomName);
  return participants.some(participant => participant.identity === "host");
}

