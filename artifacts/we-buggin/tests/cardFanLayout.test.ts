import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getHandGridLayout, fitCard, CARD_ASPECT, MAX_CARD_W, isSimpleNumberRank, isRedSuit } from "../src/chat/card-fan-layout";

const overlap = (a: { left: number; top: number }, b: { left: number; top: number }, w: number, h: number) =>
  a.left < b.left + w && b.left < a.left + w && a.top < b.top + h && b.top < a.top + h;

// Approximate inner card box of the popup at 390x844 and 360x640.
const PHONES = { "390x844": [338, 499], "360x640": [308, 300] } as const;
for (const [name, [w, h]] of Object.entries(PHONES)) {
  test(`grid fits ${name} for 1-5 cards without overlap`, () => {
    for (let n = 1; n <= 5; n++) {
      const L = getHandGridLayout(n, w, h);
      assert.ok(L.width <= w && L.height <= h, `n=${n} ${L.width}x${L.height}`);
      assert.ok(L.cardW <= MAX_CARD_W && L.cardW >= 60, `n=${n} w=${L.cardW}`);
      assert.ok(Math.abs(L.cardW / L.cardH - CARD_ASPECT) < 0.02);
      for (const c of L.cards) assert.ok(c.left >= 0 && c.top >= 0 && c.left + L.cardW <= L.width + .5 && c.top + L.cardH <= L.height + .5);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!overlap(L.cards[i], L.cards[j], L.cardW, L.cardH));
    }
  });
}
test("4-5 cards: top row of 3, bottom row centred", () => {
  for (const n of [4, 5]) {
    const L = getHandGridLayout(n, 338, 499);
    assert.equal(L.rows, 2);
    assert.deepEqual(L.cards.map(c => c.row), [0, 0, 0, ...Array(n - 3).fill(1)]);
    const bottom = L.cards.filter(c => c.row === 1);
    const mid = (bottom[0].left + bottom[bottom.length - 1].left + L.cardW) / 2;
    assert.ok(Math.abs(mid - L.width / 2) < 0.5);
  }
  assert.equal(getHandGridLayout(3, 338, 499).rows, 1);
});
test("zoom keeps aspect ratio whichever side limits", () => {
  for (const [w, h] of [[300, 300], [300, 900], [200, 1000]]) {
    const z = fitCard(w, h);
    assert.ok(z.width <= w && z.height <= h);
    assert.ok(Math.abs(z.width / z.height - CARD_ASPECT) < 0.01);
  }
});
test("simple number ranks are 3-10 only; no twos; red suits", () => {
  for (const r of ["3", "7", "10"]) assert.ok(isSimpleNumberRank(r));
  for (const r of ["2", "A", "J", "Q", "K", "Joker"]) assert.ok(!isSimpleNumberRank(r));
  assert.ok(isRedSuit("H") && isRedSuit("D") && !isRedSuit("S") && !isRedSuit("C"));
});
const src = readFileSync("src/chat/CardHandFan.tsx", "utf8");
const css = readFileSync("src/chat/owner-card-game-test.css", "utf8");
test("popup tiles reset inherited button CSS and contain the joker shimmer", () => {
  assert.match(src, /dw-card-tile-face/);
  assert.match(src, /Back to hand/);
  assert.doesNotMatch(src, /getExpandedFanLayout/);
  assert.match(css, /button\.dw-card-tile \{\s*all: unset/);
  assert.match(css, /\.dw-card-tile-face \{[^}]*overflow: hidden[^}]*clip-path: inset\(0 round 7px\)/);
  assert.match(css, /\.dw-card-tile-face\.is-wild::before \{[^}]*inset: 0;/);
  assert.match(css, /img\.dw-card-face-image \{[^}]*border-radius: 0 !important/);
});
