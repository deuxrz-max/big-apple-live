import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { db, accountProfiles, socialMessages, socialRelations } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getMe, getPerson, listPeople, relationship, saveSocialProfile, blocks } from "./people";
import { sendMessage, thread, inbox, clearThread } from "./messages";
import { GetSocialMeResponse, GetSocialPeopleResponse, GetSocialConversationResponse, GetSocialInboxResponse } from "@workspace/api-zod";

test("profiles, public search, follows, blocking and private messages work without discovery opt-in", async t => {
  const token = randomUUID().replaceAll("-", "").slice(0, 8);
  const ids = ["a", "b", "c"].map(s => `social-fixture-${token}-${s}`);
  const names = ["a", "b", "c"].map(s => `Social_${token}_${s}`);
  t.after(async () => {
    await db.delete(socialMessages).where(inArray(socialMessages.senderId, ids));
    await db.delete(socialRelations).where(inArray(socialRelations.ownerId, ids));
    await db.delete(accountProfiles).where(inArray(accountProfiles.accountId, ids));
    await db.$client.end();
  });
  await db.insert(accountProfiles).values(ids.map((id, i) => ({
    accountId: id, username: names[i]!, nameKey: names[i]!.toLowerCase(),
    emojiId: "1F600", gender: i === 1 ? "Female" as const : "Male" as const,
    color: "#ffffff", hairColor: "#000000", isTestAccount: i === 2,
  })));
  const [a, b, c] = ids as [string, string, string];
  await t.test("profile Race and Job are editable, and search includes people without opting in", async () => {
    GetSocialMeResponse.parse(await getMe(a));
    await getMe(b); await getMe(c);
    assert.equal((await listPeople(a, { search: token })).total, 2);
    await saveSocialProfile(a, { race: "Human", job: "Apprentice" });
    await saveSocialProfile(b, { race: "Human", job: "Tinker" });
    assert.equal((await getMe(a)).profile.race, "Human");
    assert.equal((await getMe(a)).profile.job, "Apprentice");
    const people = GetSocialPeopleResponse.parse(await listPeople(a, { search: token, gender: "Female" }));
    assert.equal(people.people[0]!.username, names[1]);
    await assert.rejects(saveSocialProfile(a, { job: "Unavailable" } as never), /starter jobs/);
  });
  await t.test("following and private messages remain available", async () => {
    await relationship(a, names[1]!, "favorite", true);
    assert.equal((await listPeople(a, { search: token, favorites: true })).total, 1);
    assert.equal((await getPerson(a, names[1]!)).followerCount, 1);
    const key = randomUUID();
    await sendMessage(a, names[1]!, "Message still works", key);
    const incoming = GetSocialInboxResponse.parse(await inbox(b)).conversations[0]!;
    assert.equal(incoming.unreadCount, 1);
    assert.equal(incoming.lastMessage, "Message still works");
    const received = GetSocialConversationResponse.parse(await thread(b, names[0]!));
    assert.equal(received.messages[0]!.body, "Message still works");
    await sendMessage(a, names[1]!, "Message still works", key);
    await assert.rejects(sendMessage(a, names[1]!, "different retry", key), /retry key/);
    await clearThread(a, names[1]!);
    assert.equal((await thread(a, names[1]!)).messages.length, 0);
    assert.equal((await thread(b, names[0]!)).messages.length, 1);
  });
  await t.test("blocking is bilateral and removes people from search", async () => {
    await relationship(b, names[0]!, "block", true);
    assert.equal((await blocks(b)).people[0]!.username, names[0]);
    assert.equal((await listPeople(a, { search: token })).total, 1);
    await assert.rejects(getPerson(a, names[1]!), /blocked/);
    await assert.rejects(sendMessage(a, names[1]!, "not allowed", randomUUID()), /blocked/);
    assert.equal((await thread(b, names[0]!)).blocked, true);
    await relationship(b, names[0]!, "block", false);
    assert.equal((await listPeople(a, { search: token })).total, 2);
  });
});
