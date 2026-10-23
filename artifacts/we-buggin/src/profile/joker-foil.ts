/**
 * Procedural face composite + gold-foil shader for the owner-only single-Joker preview.
 * No external assets: the original Joker image is drawn whole (contained, never cropped) onto a
 * canvas with padding; a new gold frame and small JOKER corner marks are drawn outside the art.
 */
import { JOKER_FACE_PX_H, JOKER_FACE_PX_W, JOKER_MARK_TEXT, jokerFaceLayout } from "./joker-webgl";

const GOLD_HI = "#f3d58a", GOLD = "#c99a3e", GOLD_LO = "#7a5a1c";

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function drawMark(g: CanvasRenderingContext2D, size: number) {
  g.font = `800 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  g.textAlign = "left"; g.textBaseline = "top";
  // Tracking via per-letter placement keeps it crisp and font-independent.
  let x = 0;
  for (const ch of JOKER_MARK_TEXT) { g.fillText(ch, x, 0); x += g.measureText(ch).width + size * 0.14; }
  // Small diamond pip under the word.
  const d = size * 0.28, cx = size * 0.32, cy = size * 1.5;
  g.beginPath(); g.moveTo(cx, cy - d); g.lineTo(cx + d * 0.7, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d * 0.7, cy); g.closePath(); g.fill();
}

function frameStrokes(g: CanvasRenderingContext2D, L: ReturnType<typeof jokerFaceLayout>, mask: boolean) {
  const { frame: f, art: a } = L;
  const r = f.w * 0.045;
  g.lineJoin = "round";
  // Outer gold frame
  g.lineWidth = f.w * 0.009;
  g.strokeStyle = mask ? "#fff" : GOLD;
  g.beginPath(); g.roundRect(f.x, f.y, f.w, f.h, r); g.stroke();
  // Inner hairline
  g.lineWidth = f.w * 0.0028;
  g.strokeStyle = mask ? "#fff" : GOLD_HI;
  const k = f.w * 0.016;
  g.beginPath(); g.roundRect(f.x + k, f.y + k, f.w - k * 2, f.h - k * 2, r * 0.75); g.stroke();
  // Thin keyline just outside the art bounds (never over the art)
  g.lineWidth = f.w * 0.0024;
  g.strokeStyle = mask ? "#ddd" : GOLD_LO;
  const o = f.w * 0.006;
  g.strokeRect(a.x - o, a.y - o, a.w + o * 2, a.h + o * 2);
}

function marks(g: CanvasRenderingContext2D, L: ReturnType<typeof jokerFaceLayout>, fill: string) {
  g.fillStyle = fill;
  g.save(); g.translate(L.markTL.x, L.markTL.y); drawMark(g, L.markSize); g.restore();
  g.save(); g.translate(L.markBR.x, L.markBR.y); g.rotate(Math.PI); drawMark(g, L.markSize); g.restore();
}

/** Base face: satin black-gold ground with fine grain, full contained art, frame, marks. */
export function composeJokerFace(img: CanvasImageSource): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = JOKER_FACE_PX_W; c.height = JOKER_FACE_PX_H;
  const g = c.getContext("2d");
  if (!g) throw new Error("2d context");
  const L = jokerFaceLayout(c.width, c.height);
  // Satin ground: soft radial falloff, not flat black
  const bg = g.createRadialGradient(c.width * 0.42, c.height * 0.36, c.width * 0.05, c.width * 0.5, c.height * 0.5, c.height * 0.75);
  bg.addColorStop(0, "#2a2114"); bg.addColorStop(0.55, "#16110a"); bg.addColorStop(1, "#0a0806");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  // Fine horizontal satin brushing
  const rnd = seeded(11);
  for (let y = 0; y < c.height; y += 2) {
    g.fillStyle = `rgba(255,224,160,${(rnd() * 0.035).toFixed(3)})`;
    g.fillRect(0, y, c.width, 1);
  }
  frameStrokes(g, L, false);
  marks(g, L, GOLD_HI);
  // Full original art, contained; drawn last so nothing overlaps its pixels.
  g.imageSmoothingQuality = "high";
  g.drawImage(img, L.art.x, L.art.y, L.art.w, L.art.h);
  return c;
}

/** Foil mask (R): frame/marks = 1, satin ground = .3, art = .26 so ink stays legible. */
export function composeJokerFoilMask(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = JOKER_FACE_PX_W / 2; c.height = JOKER_FACE_PX_H / 2;
  const g = c.getContext("2d");
  if (!g) throw new Error("2d context");
  g.scale(0.5, 0.5);
  const L = jokerFaceLayout();
  g.fillStyle = "rgb(77,77,77)"; g.fillRect(0, 0, JOKER_FACE_PX_W, JOKER_FACE_PX_H);
  g.fillStyle = "rgb(66,66,66)"; g.fillRect(L.art.x, L.art.y, L.art.w, L.art.h);
  frameStrokes(g, L, true);
  marks(g, L, "#fff");
  return c;
}

export const FOIL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Unlit base (exact ink) + additive gold band with soft gaussian falloff and fine satin grain. */
export const FOIL_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMask;
uniform float uPos;
uniform float uStrength;
uniform vec2 uDir;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 base = texture2D(uMap, vUv);
  float m = texture2D(uMask, vUv).r;
  float d = dot(vUv - 0.5, uDir) + 0.5;
  float x = (d - uPos) / 0.12;
  float band = exp(-x * x);
  float core = exp(-x * x * 7.0);
  float grain = 0.72 + 0.28 * hash(floor(vUv * vec2(760.0, 1080.0)));
  float brush = 0.86 + 0.14 * hash(vec2(floor(vUv.y * 900.0), 3.0));
  vec3 gold = mix(vec3(0.66, 0.44, 0.13), vec3(1.0, 0.88, 0.55), core);
  float a = (band * 0.8 + core * 0.55) * uStrength * m * grain * brush;
  gl_FragColor = vec4(base.rgb + gold * a, 1.0);
  #include <colorspace_fragment>
}
`;
