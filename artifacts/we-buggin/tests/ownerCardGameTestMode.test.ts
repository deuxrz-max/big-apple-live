import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCardTestFaces, getCardTestFace } from "../src/chat/owner-card-game-test-card-policy";
import { createDeck } from "../../api-server/src/lib/room-card-game-policy";
import { CARD_DECK_FILENAMES } from "../../api-server/src/lib/card-deck-manifest";

const component = readFileSync("src/chat/OwnerCardGameTestMode.tsx", "utf8");
const styles = readFileSync("src/chat/owner-card-game-test.css", "utf8");
const roomStyles = readFileSync("src/chat/university-room.css", "utf8");
const liveScreen = readFileSync("src/chat/GoLiveScreens.tsx", "utf8");
const roomScreen = readFileSync("src/chat/UniversityRoom.tsx", "utf8");
const apiRoutes = readFileSync("../api-server/src/routes/room-card-games.ts", "utf8");

test("all 52 uploaded faces match the server deck and four distinct Jokers get the shimmer", () => {
  const faces = createCardTestFaces();
  assert.equal(faces.length, 52);
  assert.equal(new Set(faces.map(face => face.code)).size, 52);
  const jokers = faces.filter(face => face.isWild);
  assert.equal(jokers.length, 4);
  assert.equal(new Set(jokers.map(face => face.wildMark)).size, 4);
  assert.deepEqual(faces.map(face => face.code).sort(), createDeck().sort());
  assert.deepEqual(faces.map(face => face.imagePath.split("/").at(-1)).sort(), [...CARD_DECK_FILENAMES].sort());
  assert.equal(new Set(faces.map(face => face.imagePath)).size, 52);
  for (const suit of ["C", "D", "H", "S"]) assert.equal(getCardTestFace(`2${suit}`), null);
});

test("dealing, hand, profile fan and guide use uploaded art rather than generated old faces", () => {
  const fan = readFileSync("src/chat/CardHandFan.tsx", "utf8");
  assert.match(component, /<CardFaceImage code=\{dealFlight\.code\}/);
  assert.match(component, /<CardFaceImage code=\{code\}/);
  assert.match(fan, /<CardFaceImage code=\{code\}/);
  assert.doesNotMatch(component + fan, /className="dw-test-card-corner/);
  assert.match(component, /Jokers are wild/);
  assert.doesNotMatch(component, /Twos are wild/);
  assert.match(roomScreen, /joker-wild-\$\{item\.card\.jokerId\}/);
});

test("the owner test panel is marked test-only and uses the logo-backed deck", () => {
  assert.match(component, /TEST ONLY · NO GOLD AWARDED/);
  assert.match(component, /BRAND_LOGO_PATH/);
});

test("the private one-minute test only mounts in the owner's created room, never on a livestream", () => {
  assert.doesNotMatch(liveScreen, /OwnerCardGameTestMode|owner-card-game-test/);
  assert.match(roomScreen, /import\.meta\.env\.DEV && isOwnerCardTestUser && <OwnerCardGameTestMode/);
  assert.match(apiRoutes, /if \(!roomStore\.isSocialRoom\(roomId\)/);
  assert.match(apiRoutes, /type: z\.literal\("room"\)/);
});

test("owner toggle and logo deck sit at the room gift box, open rules, and animate cards to the seat", () => {
  assert.match(component, /Start 1-minute card test/);
  assert.match(component, /data-testid="owner-test-deck"/);
  assert.match(component, /aria-label="Open private card-test rules"/);
  assert.match(component, /onClick=\{\(\) => setRulesOpen\(true\)\}/);
  assert.match(component, /button-open-gift-bag/);
  assert.match(component, /dw-card-flight/);
  assert.match(component, /beam-seat-\$\{data\.seatNumber\}/);
  assert.match(styles, /bottom: calc\(var\(--app-bottom-nav-height, 68px\) \+ 5px\)/);
  assert.match(styles, /@keyframes dw-card-flight/);
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
