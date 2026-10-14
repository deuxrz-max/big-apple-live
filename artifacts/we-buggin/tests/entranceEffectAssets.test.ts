import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const component = readFileSync(path.join(root, "src/chat/RoomEntranceEffectOverlay.tsx"), "utf8");
const styles = readFileSync(path.join(root, "src/chat/university-room.css"), "utf8");
const apiMedia = readFileSync(path.join(root, "../api-server/src/lib/room-entry-effect-media.ts"), "utf8");

test("entrance effect layers are transparent and have no backing panel", () => {
  assert.match(styles, /\.ur-room-entry-effect\{[^}]*background:transparent!important[^}]*box-shadow:none!important/);
  assert.match(styles, /\.ur-room-entry-effect img,\.ur-room-entry-effect video\{[^}]*background:transparent!important[^}]*box-shadow:none!important/);
  assert.doesNotMatch(styles, /ur-tier-effect-placeholder/);
});

test("entrance effects play video or animated WebP, never a badge still", () => {
  assert.match(component, /webmSrc = tierUrl\(tier, "animation\.webm"\)/);
  assert.match(component, /webpSrc = tierUrl\(tier, "animation\.webp"\)/);
  assert.match(component, /<video[\s\S]*?autoPlay[\s\S]*?muted[\s\S]*?playsInline/);
  assert.match(component, /className="ur-entry-effect-webp"/);
  assert.doesNotMatch(component, /badgeImage|\.png|\.svg/);
  assert.match(component, /Tier 1 and 5 do not have uploaded entrance animations yet/);
  assert.match(apiMedia, /room-effects\/monthly-credit-tiers\/tier\$\{tier\}\/v2/);
  assert.match(apiMedia, /!?\["2", "3", "4"\]\.includes\(tier\)/);
  assert.match(apiMedia, /"animation\.webm": "video\/webm"/);
  assert.doesNotMatch(apiMedia, /audio\.m4a/);
  assert.doesNotMatch(component, /new Audio|\.play\(\).*audio/);
  assert.match(component, /HOLD_LAST_FRAME_MS = 2_000/);
  assert.match(component, /FADE_OUT_MS = 500/);
  assert.match(component, /onEnded=\{\(\) => beginHoldRef\.current\(\)\}/);
  assert.match(component, /beginHoldRef\.current\(\)[\s\S]{0,100}event\.durationMs/);
  assert.match(styles, /\.ur-room-entry-effect\.is-fading/);
  for (let tier = 1; tier <= 5; tier += 1) {
    const art = path.join(root, "public/badges/monthly-credit-tiers", `tier${tier}.${tier === 1 || tier === 5 ? "svg" : "png"}`);
    assert.equal(existsSync(art), true, `tier ${tier} badge art exists`);
  }
  for (const tier of [2, 3, 4]) {
    assert.equal(existsSync(path.join(root, "public/entrance-effects/monthly-credit-tiers", `tier${tier}`, "entrance.mp4")), false);
  }
});
