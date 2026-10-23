import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JOKER_CARD_H, JOKER_DPR_CAP, JOKER_MAX_TILT_DEG, JOKER_REST, capDpr, dragToTilt, fitCameraDistance, shouldRender, stepTilt } from "../src/profile/joker-webgl";
import { getCardTestFace } from "../src/chat/owner-card-game-test-card-policy";

const scene = readFileSync("src/profile/JokerCardScene.tsx", "utf8");
const page = readFileSync("src/profile/CardFinishPreview.tsx", "utf8");
const css = readFileSync("src/profile/joker-webgl.css", "utf8");
const wrapper = readFileSync("src/chat/CardSurfaceFinish.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

test("pure math: tilt clamped, reduced motion zero, damping settles", () => {
  for (const [dx, dy] of [[1e6, -1e6], [-1e6, 1e6], [NaN, 3]]) {
    const t = dragToTilt(JOKER_REST, dx, dy, 360, 400);
    assert.ok(Math.abs(t.rx) <= JOKER_MAX_TILT_DEG && Math.abs(t.ry) <= JOKER_MAX_TILT_DEG);
  }
  assert.ok(JOKER_MAX_TILT_DEG <= 15);
  assert.deepEqual(dragToTilt(JOKER_REST, 200, 200, 360, 400, true), JOKER_REST);
  assert.deepEqual(dragToTilt(JOKER_REST, 5, 5, 0, 0), JOKER_REST);
  let cur = { rx: 12, ry: -12 }, settled = false, n = 0;
  while (!settled && n++ < 500) ({ tilt: cur, settled } = stepTilt(cur, JOKER_REST, 16));
  assert.ok(settled); assert.deepEqual(cur, JOKER_REST);
  assert.ok(Math.abs(JOKER_CARD_H - 711 / 500) < 1e-9);
});

test("card fits a 360px-wide viewport at max tilt", () => {
  const fov = 30, aspect = 360 / 360, d = fitCameraDistance(aspect, fov);
  const visH = 2 * d * Math.tan((fov * Math.PI / 180) / 2);
  assert.ok(visH * aspect >= 1 && visH >= JOKER_CARD_H, "card fits");
  assert.ok(fitCameraDistance(360 / 640, fov) > fitCameraDistance(1, fov) * 0.99);
});

test("render budget: DPR cap, on-demand, offscreen/background pause, cleanup", () => {
  assert.equal(JOKER_DPR_CAP, 1.5); assert.equal(capDpr(3), 1.5); assert.equal(capDpr(NaN), 1);
  assert.equal(shouldRender({ onScreen: false, docHidden: false, dirty: true }), false);
  assert.equal(shouldRender({ onScreen: true, docHidden: true, dirty: true }), false);
  assert.equal(shouldRender({ onScreen: true, docHidden: false, dirty: false }), false);
  assert.match(scene, /IntersectionObserver/); assert.match(scene, /visibilitychange/);
  assert.doesNotMatch(scene, /setAnimationLoop|EffectComposer|Bloom|postprocessing|shadowMap|https?:\/\/|\.hdr|RGBELoader|useState\([^)]*\)[^;]*pointer/);
  for (const d of ["cancelAnimationFrame", "artTex?.dispose", "bodyGeo.dispose", "faceGeo.dispose", "renderer.dispose", "forceContextLoss", "envRT.dispose", "pmrem.dispose", "io.disconnect", "ro.disconnect", 'removeEventListener("visibilitychange"', "canvas.removeEventListener(t, fn)", 'removeEventListener("webglcontextlost"', "canvas.remove()"]) assert.ok(scene.includes(d), d);
  assert.match(scene, /NoToneMapping/); assert.match(scene, /toneMapped: false/);
});

test("fallbacks: unsupported, context loss, texture and render errors show static Joker", () => {
  for (const r of ['fail("unsupported")', 'fail("context-lost")', 'fail("texture")', 'fail("render")']) assert.ok(scene.includes(r), r);
  assert.match(scene, /img-joker-static/); assert.match(scene, /3D unavailable|JOKER_UNAVAILABLE_TEXT/);
  assert.equal(getCardTestFace("joker-wild-1")?.imagePath, "api/card-deck/joker-wild-1.png");
  assert.match(scene, /import\.meta\.env\.BASE_URL\}\$\{face\.imagePath\}/);
  assert.match(scene, /aria-label/); assert.match(scene, /status-joker-loading/);
});

test("gating and isolation: scene mounts only after gate; canvas-only touch capture", () => {
  assert.match(page, /canUsePremiumCardFinish\(import\.meta\.env\.DEV, access\.data\)/);
  assert.ok(page.indexOf("canUsePremiumCardFinish(import.meta.env.DEV") < page.indexOf("<JokerCardScene"));
  assert.match(page, /useState<'singleJokerWebGL' \| 'handComparison'>\('singleJokerWebGL'\)/);
  assert.match(page, /CardHandFan/);
  assert.match(css, /\.dw-jk canvas \{[^}]*touch-action: none/);
  assert.doesNotMatch(css.replace(/\.dw-jk canvas \{[^}]*\}/, ""), /touch-action/);
  assert.match(scene, /setPointerCapture/);
  assert.doesNotMatch(wrapper, /three|JokerCardScene/);
  assert.doesNotMatch(app, /JokerCardScene|three/);
  assert.doesNotMatch(scene.replace(/RoomEnvironment|roomEnv/g, ""), /socket|fetch\(|localStorage|room|audio|deal|seat|payout/i);
});

test("failure lifecycle: WebGL2 probe released, setup wrapped, teardown on fail, late texture freed", () => {
  assert.match(scene, /getContext\("webgl2"\)/);
  assert.doesNotMatch(scene, /getContext\("webgl"\)/);
  assert.match(scene, /WEBGL_lose_context"\)\?\.loseContext\(\)/);
  assert.match(scene, /isWebGL2/);
  const effect = scene.slice(scene.indexOf("try {\n      // eslint"), scene.indexOf("return teardown;\n  }, []);"));
  for (const s of ["new THREE.WebGLRenderer", "PMREMGenerator", "fromScene", "ExtrudeGeometry", "ImageLoader", "resize();"]) assert.ok(effect.includes(s), s);
  assert.match(effect, /\} catch \{\n      fail\("render"\);\n    \}\s*$/);
  assert.match(scene, /const fail = [^]*?teardown\(\);[^]*?setStatus\("unavailable"\)/);
  assert.match(scene, /const teardown = [^]*?cancelAnimationFrame\(raf\)[^]*?disposers\.pop\(\)/);
  assert.match(scene, /if \(dead\) return;\n\s+try \{\n\s+const tex = new THREE\.CanvasTexture/);
  assert.match(scene, /return teardown;/);
});

test("fallback layout fits a 360px stage; 44px touch targets", () => {
  assert.match(css, /\.dw-jk-fallback \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.dw-jk-fallback img \{[^}]*min-height: 0/);
  assert.match(css, /\.dw-jk\[data-status="unavailable"\] canvas \{ display: none; \}/);
  assert.match(css, /\.dw-jk-bar button, \.dw-cfp-tabs button \{[^}]*min-height: 44px/);
});

test("ink is never replaced by a grey reflective face", () => {
  assert.match(scene, /new THREE\.ShaderMaterial\(\{ uniforms: foilUniforms/);
  assert.doesNotMatch(scene, /MeshPhysicalMaterial|opacity: 0\.035/);
});

import { JOKER_ART_H, JOKER_ART_W, JOKER_FACE_PX_H, JOKER_FACE_PX_W, JOKER_IDLE_FPS, JOKER_IDLE_PERIOD_MS, foilState, idleSweep, jokerFaceLayout, shouldDrawFrame, wantsLoop } from "../src/profile/joker-webgl";
const foil = readFileSync("src/profile/joker-foil.ts", "utf8");
const shell = readFileSync("src/mobile-shell.css", "utf8");

test("foil band: pointer UV drives it directly, tilt steers it, idle sweeps 6-9s", () => {
  assert.ok(JOKER_IDLE_PERIOD_MS >= 6000 && JOKER_IDLE_PERIOD_MS <= 9000);
  const a = foilState({ pointer: { u: 0, v: 1 }, tilt: JOKER_REST, tMs: 0, reduced: false });
  const b = foilState({ pointer: { u: 1, v: 0 }, tilt: JOKER_REST, tMs: 0, reduced: false });
  assert.equal(a.pos, 0); assert.equal(b.pos, 1); assert.equal(a.strength, 1);
  const l = foilState({ pointer: null, tilt: { rx: 0, ry: -12 }, tMs: 1234, reduced: false });
  const r = foilState({ pointer: null, tilt: { rx: 0, ry: 12 }, tMs: 1234, reduced: false });
  // Tilt offsets the automatic sweep instead of replacing it. Finger contact
  // still drives the full range above; releasing must never freeze the band.
  assert.ok(Math.abs((r.pos - l.pos) - 0.18) < 1e-9);
  const seen = new Set<number>();
  for (let t = 0; t < JOKER_IDLE_PERIOD_MS; t += 500) seen.add(Math.round(idleSweep(t) * 10));
  assert.ok(Math.min(...seen) < 0 && Math.max(...seen) > 10, "idle band crosses the whole face");
  assert.ok(foilState({ pointer: null, tilt: JOKER_REST, tMs: 3000, reduced: false }).strength >= 0.7, "visible, not a 3.5% varnish");
});

test("reduced motion: static band, loop stops when settled; idle pauses offscreen/hidden; ~30fps idle", () => {
  const s0 = foilState({ pointer: null, tilt: JOKER_REST, tMs: 0, reduced: true });
  const s1 = foilState({ pointer: null, tilt: JOKER_REST, tMs: 5000, reduced: true });
  assert.deepEqual(s0, s1);
  assert.equal(wantsLoop({ onScreen: true, docHidden: false, reduced: true, settled: true, dirty: false }), false);
  assert.equal(wantsLoop({ onScreen: true, docHidden: false, reduced: false, settled: true, dirty: false }), true);
  assert.equal(wantsLoop({ onScreen: false, docHidden: false, reduced: false, settled: false, dirty: true }), false);
  assert.equal(wantsLoop({ onScreen: true, docHidden: true, reduced: false, settled: false, dirty: true }), false);
  assert.ok(JOKER_IDLE_FPS <= 30);
  assert.equal(shouldDrawFrame(1016, 1000, false), false);
  assert.equal(shouldDrawFrame(1034, 1000, false), true);
  assert.equal(shouldDrawFrame(1001, 1000, true), true);
  assert.match(scene, /prefers-reduced-motion/); assert.match(scene, /addEventListener\?\.\("change"/);
});

test("touch: pointer capture, raycast UV on the face, release clears foil pointer; no per-frame React state", () => {
  assert.match(scene, /setPointerCapture\?\.\(e\.pointerId\); pickUV\(e\)/);
  assert.match(scene, /intersectObject\(faceMesh/);
  assert.match(scene, /drag = null; pointerUV = null/);
  const frame = scene.slice(scene.indexOf("const frame = "), scene.indexOf("const kick = "));
  assert.doesNotMatch(frame, /setStatus|setReason/);
  assert.match(frame, /foilUniforms\.uPos\.value = f\.pos/);
  assert.match(frame, /rimMat\.emissiveIntensity/);
});

test("artwork: full source contained with padding, frame and corner marks outside art bounds", () => {
  assert.equal(JOKER_FACE_PX_H / JOKER_FACE_PX_W - JOKER_ART_H / JOKER_ART_W < 0.002, true);
  const L = jokerFaceLayout();
  assert.ok(Math.abs(L.art.w / L.art.h - JOKER_ART_W / JOKER_ART_H) < 1e-9, "aspect preserved, no crop");
  assert.ok(L.art.x > L.frame.x + 20 && L.art.y > L.frame.y + 20);
  assert.ok(L.art.x + L.art.w < L.frame.x + L.frame.w - 20 && L.art.y + L.art.h < L.frame.y + L.frame.h - 20);
  assert.ok(L.markTL.y + L.markSize * 1.8 < L.art.y, "top-left mark above art");
  assert.ok(L.markBR.y - L.markSize * 1.8 > L.art.y + L.art.h, "bottom-right mark below art");
  assert.match(foil, /drawImage\(img, L\.art\.x, L\.art\.y, L\.art\.w, L\.art\.h\)/);
  assert.match(foil, /g\.rotate\(Math\.PI\)/); assert.match(foil, /JOKER_MARK_TEXT/);
  assert.doesNotMatch(foil, /https?:\/\/|\.png|\.jpg/);
  assert.match(foil, /base\.rgb \+ gold \* a/, "unlit ink kept, additive gold");
  for (const d of ["artTex?.dispose", "maskTex?.dispose", "faceMat.dispose"]) assert.ok(scene.includes(d), d);
});

test("nav: legacy purple curved outline reset to neutral black-gold", () => {
  const block = shell.slice(shell.lastIndexOf("body #root nav.app-bottom-nav {"));
  assert.match(block, /border: 0 !important/);
  assert.match(block, /border-radius: 0 !important/);
  assert.match(block, /box-shadow: 0 -8px 24px rgba\(0, 0, 0, \.5\) !important/);
  assert.doesNotMatch(block.split("}")[0], /190|159|255|purple|143, ?91/);
});

test("idle foil still sweeps after releasing a tilted card; output preserves artwork color space", async () => {
  const { foilState } = await import("../src/profile/joker-webgl");
  const input = { pointer: null, tilt: { rx: 8, ry: 12 }, reduced: false };
  const a = foilState({ ...input, tMs: 1000 });
  const b = foilState({ ...input, tMs: 4000 });
  assert.ok(Math.abs(a.pos - b.pos) > 0.4, "retained tilt must not freeze the idle sweep");
  assert.deepEqual(
    foilState({ ...input, tMs: 1000, reduced: true }),
    foilState({ ...input, tMs: 4000, reduced: true }),
    "reduced motion disables automatic sweeping",
  );
  assert.match(readFileSync("src/profile/joker-foil.ts", "utf8"), /#include <colorspace_fragment>/);
});
