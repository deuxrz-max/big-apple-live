import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARD_FINISH_MAX_TILT_DEG, CARD_FINISH_REST, canUsePremiumCardFinish, computeCardFinishPose, stepCardFinishPose } from "../src/chat/card-surface-finish";

const css = readFileSync("src/chat/owner-card-game-test.css", "utf8");
const finishCss = readFileSync("src/chat/card-surface-finish.css", "utf8");
const wrapper = readFileSync("src/chat/CardSurfaceFinish.tsx", "utf8");
const page = readFileSync("src/profile/CardFinishPreview.tsx", "utf8");
const room = readFileSync("src/chat/UniversityRoom.tsx", "utf8");
const me = readFileSync("src/profile/OwnProfile.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const rect = { left: 0, top: 0, width: 100, height: 140 };

test("gating fails closed unless DEV and server owner === true", () => {
  assert.equal(canUsePremiumCardFinish(true, { owner: true }), true);
  for (const a of [undefined, null, {}, { owner: false }, { owner: null }]) assert.equal(canUsePremiumCardFinish(true, a), false);
  assert.equal(canUsePremiumCardFinish(false, { owner: true }), false);
  assert.match(page, /canUsePremiumCardFinish\(import\.meta\.env\.DEV, access\.data\)/);
  assert.match(page, /status-card-finish-loading/);
  assert.doesNotMatch(page, /localStorage|username/);
  assert.match(room, /premium=\{isSocialRoom && canUsePremiumCardFinish\(import\.meta\.env\.DEV, chatAccess\.data\)\}/);
  assert.match(me, /import\.meta\.env\.DEV && access\.data\?\.owner === true && <Link href="\/user-portal\/card-finish"/);
  assert.match(app, /DevCardFinishPreview && <Route path="\/user-portal\/card-finish"/);
});

test("tilt is clamped to the max and light stays in 0-100%", () => {
  for (const [x, y] of [[-500, -500], [900, 900], [0, 0], [100, 140], [NaN, 20]]) {
    const p = computeCardFinishPose(x, y, rect);
    assert.ok(Math.abs(p.rx) <= CARD_FINISH_MAX_TILT_DEG && Math.abs(p.ry) <= CARD_FINISH_MAX_TILT_DEG);
    assert.ok(p.lx >= 0 && p.lx <= 100 && p.ly >= 0 && p.ly <= 100);
    assert.equal(p.scale, 1);
  }
  assert.equal(CARD_FINISH_MAX_TILT_DEG, 3);
  const c = computeCardFinishPose(50, 70, rect);
  assert.equal(c.rx, 0); assert.equal(c.ry, 0);
  assert.deepEqual(computeCardFinishPose(1, 1, { left: 0, top: 0, width: 0, height: 0 }), CARD_FINISH_REST);
  let pose = computeCardFinishPose(100, 0, rect), settled = false;
  for (let i = 0; i < 200 && !settled; i++) ({ pose, settled } = stepCardFinishPose(pose, CARD_FINISH_REST));
  assert.ok(settled); assert.deepEqual(pose, CARD_FINISH_REST);
});

test("reduced motion removes tilt", () => {
  const p = computeCardFinishPose(100, 0, rect, true);
  assert.equal(p.rx, 0); assert.equal(p.ry, 0);
  assert.match(finishCss, /prefers-reduced-motion: reduce[\s\S]*scale\(1\) !important/);
  assert.match(wrapper, /prefers-reduced-motion: reduce/);
});

test("pointer updates use RAF style writes, not React state; textures stay light", () => {
  assert.match(wrapper, /requestAnimationFrame/);
  assert.match(wrapper, /style\.setProperty|s\.setProperty/);
  assert.doesNotMatch(wrapper, /useState/);
  assert.doesNotMatch(finishCss, /filter:|backdrop-filter|@keyframes|is-wild/);
  assert.doesNotMatch(finishCss, /radial-gradient\([^;]*var\(--cf-l[xy]/);
  assert.match(finishCss, /transform: translate\(var\(--cf-light-x/);
  assert.match(finishCss, /\.dw-cfp \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(finishCss, /\.dw-cfp-stage \{[^}]*min-width: 0;[^}]*box-sizing: border-box/);
});

test("Joker shimmer keyframes and timing are unchanged", () => {
  assert.match(css, /@keyframes dw-card-tile-shimmer \{ 0%, 24% \{ background-position: 100% 0; \} 70%, 100% \{ background-position: 0 0; \} \}/);
  assert.match(css, /animation: dw-card-tile-shimmer 3\.4s ease-in-out infinite;/);
  assert.match(css, /@keyframes dw-test-wild-shimmer \{\n  0%, 24% \{ transform: translateX\(-55%\) rotate\(-8deg\); \}\n  70%, 100% \{ transform: translateX\(55%\) rotate\(-8deg\); \}/);
  assert.match(css, /animation: dw-test-wild-shimmer 3\.4s ease-in-out infinite;/);
});

test("card artwork and lettering stay sharp through display and reveal animations", () => {
  assert.match(css, /\.dw-card-face-image \{[^}]*image-rendering: auto;[^}]*filter: none;/);
  assert.doesNotMatch(css, /@keyframes dw-test-card-deal \{[^}]*scale\(/);
  assert.doesNotMatch(css, /@keyframes dw-card-flight \{[^}]*scale\(/);
  assert.doesNotMatch(css, /@keyframes dw-card-zoom-in \{[^}]*scale\(/);
  assert.match(css, /text-shadow: 0 0 1px var\(--card-neon\), 0 0 2px var\(--card-neon\)/);
  assert.match(css, /dw-card-simple\[data-suit="hearts"\][^{]*\{[^}]*text-shadow: 0 0 1px #ff45d4, 0 0 2px #ff45d4/);
  assert.equal(CARD_FINISH_REST.scale, 1);
});
