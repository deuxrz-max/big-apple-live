import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialSettings } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { getProfile, saveProfile, requireCompletedProfile } from "./account-profiles";
import identityRouter from "../routes/identity";
import { COMMUNITY_ROOMS } from "./community";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
// Trusted auth middleware fixture, NOT a real Clerk login test.
async function putProfile(id: string | null, body: unknown, origin?: string) {
  const layer = (identityRouter as unknown as { stack: Layer[] }).stack.find(l => l.route?.path === "/me" && l.route.methods.put);
  const auth = () => ({ userId: id, tokenType: "session_token", sessionId: id ? "fixture-session" : null });
  Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
  const req = { auth, body, headers: { host: "fixture.local" }, get: (key: string) => key.toLowerCase() === "origin" ? origin : key.toLowerCase() === "host" ? "fixture.local" : undefined } as unknown as Request;
  let status = 200;
  let data: unknown;
  const res = { set() { return this; }, json(value: unknown) { data = value; return this; } } as unknown as Response;
  try { await layer!.route!.stack[0]!.handle(req, res, (() => {}) as NextFunction); }
  catch (e) { status = (e as { status?: number }).status ?? 500; }
  return { status, data };
}

test("real PostgreSQL profile setup, interruption, edit persistence and request ownership", async t => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const ids = ["a", "b", "c"].map(x => `profile-fixture-${suffix}-${x}`);
  const names = ["a", "b", "c"].map(x => `Setup_${suffix}_${x}`);
  const identity = { emojiId: "1F600", gender: "Male" as const, color: "#F7C531", hairColor: "#111111",
    portraitId: "spiked-tears-of-joy", currentMood: "tears_of_joy" as const };
  t.after(async () => {
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await t.test("all ordered communities have room-specific default video searches", () => {
    assert.deepEqual(COMMUNITY_ROOMS.map(r => r.label), [
      "Music",
      "Gaming",
      "Pro Wrestling",
      "Comedy",
      "Vlogs",
      "Sports",
      "News",
      "Movies",
      "Podcasts",
      "Reactions",
      "Pranks",
      "Food",
      "Beauty",
      "History",
      "Tech",
      "Education",
      "Fitness",
      "Pets",
      "Travel",
      "ASMR",
    ]);
    assert.equal(new Set(COMMUNITY_ROOMS.map(r => r.roomId)).size, 20);
    assert.ok(COMMUNITY_ROOMS.every(r => /^[A-Z0-9]{6}$/.test(r.roomId)),
      "every fixed room code remains joinable through the existing six-character route");
    assert.equal(new Set(COMMUNITY_ROOMS.map(r => r.defaultVideoSearch)).size, 20);
    assert.ok(COMMUNITY_ROOMS.every(r => r.defaultVideoSearch.length > 8));
    assert.ok(COMMUNITY_ROOMS.every(r => r.label.trim().split(/\s+/).length <= 2));
  });
  await t.test("unsaved and invalid setup never becomes complete", async () => {
    assert.equal(await getProfile(ids[0]!), null);
    await assert.rejects(requireCompletedProfile(ids[0]!), /Complete your profile/);
    assert.equal((await putProfile(ids[0]!, { username: names[0], displayName: "   ", bio: "Not saved" })).status, 400);
    assert.equal(await getProfile(ids[0]!), null);
    assert.equal((await putProfile(ids[0]!, { username: "bad-name" })).status, 400);
    assert.equal((await putProfile(ids[0]!, { username: names[0], bio: "x".repeat(281) })).status, 400);
    assert.equal(await getProfile(ids[0]!), null);
  });
  await t.test("new setup persists to existing records; repeated saves do not duplicate", async () => {
    const result = await putProfile(ids[0]!, { username: names[0], displayName: "  Test display  ", bio: "  My bio  " });
    assert.equal(result.status, 200);
    const saved = await requireCompletedProfile(ids[0]!);
    assert.equal(saved.displayName, "Test display");
    assert.equal(saved.bio, "My bio");
    assert.equal(saved.photoUrl, null);
    assert.equal(saved.identity.portraitId, undefined);
    await Promise.all([saveProfile(ids[0]!, { username: names[0]!, identity }), saveProfile(ids[0]!, { username: names[0]!, identity })]);
    assert.equal((await db.select().from(accountProfiles).where(eq(accountProfiles.accountId, ids[0]!))).length, 1);
    assert.equal((await getProfile(ids[0]!))!.displayName, "Test display");
    assert.equal((await getProfile(ids[0]!))!.bio, "My bio");
  });
  await t.test("legacy valid profile is complete without a reset or backfill", async () => {
    await db.insert(accountProfiles).values({ accountId: ids[1]!, username: names[1]!, nameKey: names[1]!.toLowerCase(),
      ...identity });
    await db.insert(socialSettings).values({ accountId: ids[1]!, bio: "Preserved existing bio", externalPlatform: "LiveMe",
      externalHandle: "ExistingHandle", discoverable: true, interests: ["music"] });
    const old = await requireCompletedProfile(ids[1]!);
    assert.equal(old.displayName, names[1]);
    assert.equal(old.bio, "Preserved existing bio");
    await saveProfile(ids[1]!, { username: names[1]!, identity, displayName: "Edited display", bio: "Edited bio" });
    const reread = await getProfile(ids[1]!);
    assert.equal(reread!.username, names[1]);
    assert.equal(reread!.displayName, "Edited display");
    assert.equal(reread!.bio, "Edited bio");
    assert.equal(reread!.identity.currentMood, identity.currentMood);
    const [prefs] = await db.select().from(socialSettings).where(eq(socialSettings.accountId, ids[1]!));
    assert.equal(prefs!.externalHandle, "ExistingHandle");
    assert.equal(prefs!.discoverable, true);
    assert.deepEqual(prefs!.interests, ["music"]);
  });
  await t.test("ownership comes from server auth; cross-account and cross-origin edits fail", async () => {
    const before = await getProfile(ids[1]!);
    assert.equal((await putProfile(null, { username: names[1] })).status, 401);
    assert.equal((await putProfile(ids[0]!, { username: names[0], accountId: ids[1], bio: "attack" })).status, 400);
    assert.equal((await putProfile(ids[0]!, { username: names[1], bio: "attack" })).status, 409);
    assert.equal((await putProfile(ids[2]!, { username: names[1] })).status, 409);
    assert.equal(await getProfile(ids[2]!), null);
    assert.equal((await putProfile(ids[0]!, { username: names[0] }, "https://attacker.invalid")).status, 403);
    assert.equal((await putProfile(ids[0]!, { username: names[0], photoUrls: ["one", "two", "three", "four", "five"] })).status, 400);
    assert.deepEqual(await getProfile(ids[1]!), before);
  });
});
