import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialSettings, socialRelations } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { GetSocialPeopleResponse } from "@workspace/api-zod";
import { getPerson, listPeople, relationship } from "./people";

test("People searches all accounts by partial display name and ID, preserving privacy and blocks", async t => {
  const token = randomUUID().replaceAll("-", "").slice(0, 10);
  const ids = ["self", "name", "id", "bare"].map(s => `people-search-${token}-${s}`);
  const usernames = ids.map((_, i) => `PS_${token}_${i}`);
  t.after(async () => {
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((accountId, i) => ({
    accountId, username: usernames[i]!, nameKey: usernames[i]!.toLowerCase(),
    displayName: i === 1 ? `preML${token}post` : `Person ${i}`,
    emojiId: "1F600", gender: "Female" as const, color: "#ffffff", hairColor: "#000000",
  })));
  // The last account has never created social settings.
  await db.insert(socialSettings).values(ids.slice(0, 3).map((accountId, i) => ({
    accountId, discoverable: false, country: i === 1 ? "CA" : "US",
    bio: `private search text ${token}`, interests: [],
  })));
  const actor = ids[0]!, target = ids[1]!;
  await t.test("partial display names are case-insensitive; no discovery opt-in required", async () => {
    const result = GetSocialPeopleResponse.parse(await listPeople(actor, { search: `ml${token}` }));
    assert.deepEqual(result.people.map(p => p.username), [usernames[1]]);
    assert.equal(result.total, 1);
    assert.equal("discoverable" in result.people[0]!, false);
    assert.equal((await getPerson(actor, usernames[1]!)).username, usernames[1]);
    await relationship(actor, usernames[1]!, "favorite", true);
    assert.equal((await getPerson(actor, usernames[1]!)).favorite, true);
    await relationship(actor, usernames[1]!, "favorite", false);
    for (const key of ["email", "phone", "phoneNumber", "accountId"]) {
      assert.equal(key in result.people[0]!, false);
    }
  });
  await t.test("@ID, missing settings, Anywhere, country and self exclusion", async () => {
    const all = await listPeople(actor, { search: `@PS_${token}` });
    assert.equal(all.total, 3);
    assert.ok(!all.people.some(p => p.username === usernames[0]));
    assert.ok(all.people.some(p => p.username === usernames[3]));
    assert.equal((await listPeople(actor, { search: token, country: "CA" })).total, 1);
    assert.equal((await listPeople(actor, { search: token, country: "US" })).total, 1);
    assert.equal((await listPeople(actor, { search: `private search text ${token}` })).total, 0);
    assert.equal((await listPeople(actor, { search: "no-such-person-" + token })).total, 0);
  });
  await t.test("blocks in either direction hide results and prevent profile viewing", async () => {
    for (const [ownerId, targetId] of [[actor, target], [target, actor]]) {
      await db.insert(socialRelations).values({ ownerId: ownerId!, targetId: targetId!, kind: "block" });
      assert.equal((await listPeople(actor, { search: `ml${token}` })).total, 0);
      await assert.rejects(getPerson(actor, usernames[1]!), /blocked/);
      await db.delete(socialRelations).where(eq(socialRelations.ownerId, ownerId!));
    }
    assert.equal((await listPeople(actor, { search: `ml${token}` })).total, 1);
  });
});
