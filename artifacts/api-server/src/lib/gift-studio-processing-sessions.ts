import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { GiftStudioProcessingSettings } from "@workspace/api-zod";

const SESSION_TTL_MS = 20 * 60 * 1000;

export type GiftStudioProcessingSessionInput = {
  ownerId: string;
  directory: string;
  sourcePath: string;
  sourceName: string;
  sourceBytes: number;
  processedPath: string;
  processedBytes: number;
  settings: GiftStudioProcessingSettings;
};

export type GiftStudioProcessingSession = GiftStudioProcessingSessionInput & {
  token: string;
  expiresAt: number;
  claimed: boolean;
  timer: NodeJS.Timeout;
};

const sessions = new Map<string, GiftStudioProcessingSession>();

export function retainGiftStudioProcessingSession(input: GiftStudioProcessingSessionInput): string {
  const token = randomUUID();
  const entry = {
    ...input,
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
    claimed: false,
    timer: setTimeout(() => {
      if (sessions.get(token) !== entry) return;
      sessions.delete(token);
      void rm(input.directory, { recursive: true, force: true });
    }, SESSION_TTL_MS),
  };
  entry.timer.unref?.();
  sessions.set(token, entry);
  return token;
}

export function claimGiftStudioProcessingSession(ownerId: string, token: string): GiftStudioProcessingSession | null {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    void discardGiftStudioProcessingSession(token);
    return null;
  }
  if (entry.ownerId !== ownerId || entry.claimed) return null;
  entry.claimed = true;
  return entry;
}

export function releaseGiftStudioProcessingSession(token: string): void {
  const entry = sessions.get(token);
  if (entry) entry.claimed = false;
}

export async function discardGiftStudioProcessingSession(token: string): Promise<void> {
  const entry = sessions.get(token);
  if (!entry) return;
  sessions.delete(token);
  clearTimeout(entry.timer);
  await rm(entry.directory, { recursive: true, force: true });
}
