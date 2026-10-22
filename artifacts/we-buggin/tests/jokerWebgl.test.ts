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
  for (const d of ["cancelAnimationFrame", "artTex?.dispose", "normalMap.dispose", "bodyGeo.dispose", "faceGeo.dispose", "renderer.dispose", "forceContextLoss", "envRT.dispose", "pmrem.dispose", "io.disconnect", "ro.disconnect", 'removeEventListener("visibilitychange"', "canvas.removeEventListener(t, fn)", 'removeEventListener("webglcontextlost"', "canvas.remove()"]) assert.ok(scene.includes(d), d);
  assert.match(scene, /NoToneMapping/); assert.match(scene, /color: 0xffffff/);
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
  for (const s of ["new THREE.WebGLRenderer", "PMREMGenerator", "fromScene", "ExtrudeGeometry", "TextureLoader", "resize();"]) assert.ok(effect.includes(s), s);
  assert.match(effect, /\} catch \{\n      fail\("render"\);\n    \}\s*$/);
  assert.match(scene, /const fail = [^]*?teardown\(\);[^]*?setStatus\("unavailable"\)/);
  assert.match(scene, /const teardown = [^]*?cancelAnimationFrame\(raf\)[^]*?disposers\.pop\(\)/);
  assert.match(scene, /if \(dead\) \{ tex\.dispose\(\); return; \}/);
  assert.match(scene, /return teardown;/);
});

test("fallback layout fits a 360px stage; 44px touch targets", () => {
  assert.match(css, /\.dw-jk-fallback \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.dw-jk-fallback img \{[^}]*min-height: 0/);
  assert.match(css, /\.dw-jk\[data-status="unavailable"\] canvas \{ display: none; \}/);
  assert.match(css, /\.dw-jk-bar button, \.dw-cfp-tabs button \{[^}]*min-height: 44px/);
});

test("satin lighting never replaces the original ink with a grey reflective face", () => {
  assert.match(scene, /faceMat = new THREE\.MeshBasicMaterial\(\{ color: 0xffffff, toneMapped: false \}/);
  assert.match(scene, /finishMat = new THREE\.MeshPhysicalMaterial/);
  assert.match(scene, /opacity: 0\.035, depthWrite: false/);
  assert.match(scene, /own\(\(\) => finishMat\.dispose\(\)\)/);
});
