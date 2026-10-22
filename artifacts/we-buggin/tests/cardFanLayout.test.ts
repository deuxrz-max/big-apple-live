import assert from "node:assert/strict";
import test from "node:test";
import { getExpandedFanLayout, fitCard, CARD_ASPECT, EXPOSE_RATIO } from "../src/chat/card-fan-layout";

const rad = (d: number) => (d * Math.PI) / 180;
/** Independently recompute rotated corners from CSS-equivalent left/top/angle (origin 50% 100%). */
function rotatedBounds(L: ReturnType<typeof getExpandedFanLayout>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of L.cards) {
    const ox = c.left + L.cardW / 2, oy = c.top + L.cardH;
    const cs = Math.cos(rad(c.angle)), sn = Math.sin(rad(c.angle));
    for (const [x, y] of [[-L.cardW / 2, 0], [L.cardW / 2, 0], [-L.cardW / 2, -L.cardH], [L.cardW / 2, -L.cardH]]) {
      const rx = ox + x * cs - y * sn, ry = oy + x * sn + y * cs;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
  }
  return { minX, maxX, minY, maxY };
}

for (const [w, h] of [[256, 300], [310, 480], [326, 495], [348, 566]]) {
  test(`expanded fan rotated bounds fit ${w}x${h} for 1-5 cards`, () => {
    let prev = Infinity;
    for (let n = 1; n <= 5; n++) {
      const L = getExpandedFanLayout(n, w, h);
      const b = rotatedBounds(L);
      assert.ok(b.minX >= -0.5 && b.maxX <= w + 0.5, `n=${n} x ${b.minX}..${b.maxX} vs ${w}`);
      assert.ok(b.minY >= -0.5 && b.maxY <= h + 0.5, `n=${n} y ${b.minY}..${b.maxY} vs ${h}`);
      assert.ok(L.width <= w && L.height <= h);
      assert.ok(L.cardW <= prev);
      assert.ok(L.cardW > 53);
      if (n > 1) assert.ok((L.cardW < 100 || L.step > 32) && Math.abs(L.step - L.cardW * EXPOSE_RATIO) < 1);
      prev = L.cardW;
    }
  });
}
test("5 cards at a 390px phone are ~125px wide", () => {
  assert.ok(getExpandedFanLayout(5, 338, 499).cardW >= 122);
  assert.ok(getExpandedFanLayout(3, 338, 499).cardW >= 175);
});
test("fan is symmetric", () => {
  const L = getExpandedFanLayout(5, 380, 450);
  assert.equal(L.cards[0].angle, -L.cards[4].angle);
  assert.ok(Math.abs(L.cards[0].top - L.cards[4].top) < 0.01);
});
test("zoom keeps aspect ratio whichever side limits", () => {
  for (const [w, h] of [[300, 300], [300, 900], [200, 1000]]) {
    const z = fitCard(w, h);
    assert.ok(z.width <= w && z.height <= h);
    assert.ok(Math.abs(z.width / z.height - CARD_ASPECT) < 0.01);
  }
});

import { readFileSync } from "node:fs";
const fanSrc = readFileSync("src/chat/CardHandFan.tsx", "utf8");
test("expanded fan shows a default full preview of the latest card above a chooser fan", () => {
  assert.match(fanSrc, /useState\(cards\.length - 1\)/);
  assert.match(fanSrc, /data-testid="button-card-preview"/);
  assert.match(fanSrc, /aria-label=\{`Showing \$\{face\.label\}\. Enlarge`\}/);
  assert.match(fanSrc, /aria-pressed=\{on\}/);
  assert.match(fanSrc, /aria-label=\{`Show \$\{f\.label\}`\}/);
  assert.match(fanSrc, /onClick=\{\(\) => setActive\(i\)\}/);
  assert.match(fanSrc, /\{!solo && \(/);
  assert.match(fanSrc, /Back to hand/);
});
test("preview fills height left after the fan at a 390 phone", () => {
  const w = 338, h = 499, L = getExpandedFanLayout(5, w, Math.floor(h * 0.42));
  const p = fitCard(w, h - L.height - 10);
  assert.ok(p.height >= 270, `preview ${p.width}x${p.height}`);
  assert.ok(L.cardW >= 100);
});
