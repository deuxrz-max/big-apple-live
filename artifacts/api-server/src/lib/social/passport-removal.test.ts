import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("retired passport endpoints cannot be reached or changed through the social router", () => {
  const routes = read("src/routes/social.ts");
  assert.doesNotMatch(routes, /passport|Passport/);
  assert.equal(existsSync(resolve(process.cwd(), "src/lib/social/passport.ts")), false);
});

test("the public API contract no longer exposes passport operations", () => {
  const rootSpec = read("../../lib/api-spec/openapi.yaml");
  assert.doesNotMatch(rootSpec, /^\s+\/social\/.*passport/m);
  const client = read("../../lib/api-client-react/src/generated/api.ts");
  assert.doesNotMatch(client, /useGetMyStreamerPassport|useSaveMyStreamerPassport|useReviewStreamerPassport|useGetSocialPersonStreamerPassport/);
});

test("room chat, whispers and participants no longer fetch or expose passport data", () => {
  for (const path of [
    "src/lib/room-chat.ts",
    "src/lib/university-chat.ts",
  ]) {
    assert.doesNotMatch(read(path), /passport|Passport/, path);
  }
});
