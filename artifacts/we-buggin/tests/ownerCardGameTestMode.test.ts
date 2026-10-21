import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCardTestFaces } from "../src/chat/owner-card-game-test-card-policy";

const component = readFileSync("src/chat/OwnerCardGameTestMode.tsx", "utf8");
const styles = readFileSync("src/chat/owner-card-game-test.css", "utf8");
const roomStyles = readFileSync("src/chat/university-room.css", "utf8");
const liveScreen = readFileSync("src/chat/GoLiveScreens.tsx", "utf8");
const roomScreen = readFileSync("src/chat/UniversityRoom.tsx", "utf8");
const apiRoutes = readFileSync("../api-server/src/routes/room-card-games.ts", "utf8");

test("the visual card set covers all 52 faces and gives each wild two its own gold mark", () => {
  const faces = createCardTestFaces();
  assert.equal(faces.length, 52);
  assert.equal(new Set(faces.map(face => face.code)).size, 52);
  const wildTwos = faces.filter(face => face.isWild);
  assert.equal(wildTwos.length, 4);
  assert.equal(new Set(wildTwos.map(face => face.wildMark)).size, 4);
});

test("the owner test panel is marked test-only and uses the logo-backed deck", () => {
  assert.match(component, /TEST ONLY · NO GOLD AWARDED/);
  assert.match(component, /BRAND_LOGO_PATH/);
});

test("the private one-minute test only mounts in the owner's created room, never on a livestream", () => {
  assert.doesNotMatch(liveScreen, /OwnerCardGameTestMode|owner-card-game-test/);
  assert.match(roomScreen, /isOwnerCardTestUser && <OwnerCardGameTestMode/);
  assert.match(apiRoutes, /if \(!roomStore\.isSocialRoom\(roomId\)/);
  assert.match(apiRoutes, /type: z\.literal\("room"\)/);
});

test("created-room profile popups include the selected person's current cards or an empty-hand message", () => {
  assert.match(roomScreen, /Profile and cards for/);
  assert.match(roomScreen, /<CardHandFan cards=\{profileHandCards\}/);
  assert.match(roomScreen, /No cards in this round\./);
  assert.match(apiRoutes, /card-game\/participants\/:participantId/);
  assert.match(apiRoutes, /roomStore\.isSocialRoom\(roomId\)/);
});

test("mobile card sizing and reduced-motion styling are present", () => {
  assert.match(styles, /@media \(max-width: 380px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /#050505/);
  assert.match(styles, /#d6b45d/);
  assert.match(roomStyles, /ur-social-profile-popup\{[^}]*calc\(100vw - 24px\)/);
});
