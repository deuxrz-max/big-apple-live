import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getCardTestFace } from "@/chat/owner-card-game-test-card-policy";
import {
  JOKER_CARD_H, JOKER_CARD_W, JOKER_CODE, JOKER_REST, JOKER_UNAVAILABLE_TEXT, capDpr, dragToTilt,
  fitCameraDistance, foilState, shouldDrawFrame, stepTilt, wantsLoop, type JokerSceneStatus, type JokerTilt, type JokerUnavailableReason,
} from "./joker-webgl";
import { FOIL_FRAGMENT, FOIL_VERTEX, composeJokerFace, composeJokerFoilMask } from "./joker-foil";
import "./joker-webgl.css";

const face = getCardTestFace(JOKER_CODE)!;
export const JOKER_IMAGE_URL = `${import.meta.env.BASE_URL}${face.imagePath}`;

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** three r0.163+ requires WebGL2. Probe, then release the probe context immediately. */
export function hasWebGL2(): boolean {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    gl = c.getContext("webgl2");
    return !!gl;
  } catch { return false; } finally {
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
  }
}

export type JokerSceneHandle = { reset: () => void };

/**
 * Isolated single-Joker 3D card with a gold foil band. Idle sweep throttled to ~30fps; pauses
 * offscreen, in background tabs and under reduced motion (renders only on change), disposes everything on unmount. Any failure shows the static Joker.
 */
export function JokerCardScene({ resetSignal = 0 }: { resetSignal?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<JokerTilt>(JOKER_REST);
  const kickRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<JokerSceneStatus>("loading");
  const [reason, setReason] = useState<JokerUnavailableReason | null>(null);

  useEffect(() => { targetRef.current = JOKER_REST; kickRef.current(); }, [resetSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dead = false, raf = 0;
    const disposers: Array<() => void> = [];
    const own = (fn: () => void) => { disposers.push(fn); };
    const teardown = () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; kickRef.current = () => {};
      while (disposers.length) { try { disposers.pop()!(); } catch { /* keep releasing */ } }
    };
    const fail = (r: JokerUnavailableReason) => {
      if (dead) return;
      teardown();
      setReason(r); setStatus("unavailable");
    };
    if (!hasWebGL2()) { fail("unsupported"); return teardown; }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderer: any = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      const canvas: HTMLCanvasElement = renderer.domElement;
      own(() => { canvas.remove(); });
      own(() => { renderer.dispose(); renderer.forceContextLoss(); });
      if (!renderer.capabilities?.isWebGL2) throw new Error("webgl2 required");
      renderer.setPixelRatio(capDpr(window.devicePixelRatio));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${face.label}, 3D card. Drag to tilt and move the gold foil.`);
      canvas.tabIndex = 0;
      canvas.dataset.testid = "canvas-joker-webgl";
      host.prepend(canvas);

      const lost = (e: Event) => { e.preventDefault(); fail("context-lost"); };
      canvas.addEventListener("webglcontextlost", lost);
      own(() => canvas.removeEventListener("webglcontextlost", lost));

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer); own(() => pmrem.dispose());
      const roomEnv = new RoomEnvironment(); own(() => roomEnv.dispose?.());
      const envRT = pmrem.fromScene(roomEnv, 0.04); own(() => envRT.dispose());
      scene.environment = envRT.texture;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      const key = new THREE.DirectionalLight(0xfff1d6, 0.9); key.position.set(-1.5, 2, 3); scene.add(key);
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      const W = JOKER_CARD_W, H = JOKER_CARD_H, R = 0.06, D = 0.02, B = 0.012;
      const bodyGeo = new THREE.ExtrudeGeometry(roundedRect(W - B * 2, H - B * 2, R), { depth: D, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 4, curveSegments: 10 });
      own(() => bodyGeo.dispose());
      bodyGeo.translate(0, 0, -D / 2);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9a24e, metalness: 1, roughness: 0.32, envMapIntensity: 0.9 }); own(() => rimMat.dispose());
      const body = new THREE.Mesh(bodyGeo, rimMat);

      const inset = 0.022;
      const faceGeo = new THREE.ShapeGeometry(roundedRect(W - inset * 2, H - inset * 2, R - inset * 0.6), 10); own(() => faceGeo.dispose());
      const pos = faceGeo.attributes.position, uv = faceGeo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (W - inset * 2) + 0.5, pos.getY(i) / (H - inset * 2) + 0.5);
      uv.needsUpdate = true;
      // Exact ink: unlit composite (no colour management, no tone mapping) + additive foil band.
      const foilUniforms = {
        uMap: { value: null as unknown }, uMask: { value: null as unknown },
        uPos: { value: -1 }, uStrength: { value: 0 }, uDir: { value: new THREE.Vector2(0.62, -0.78) },
      };
      const faceMat = new THREE.ShaderMaterial({ uniforms: foilUniforms, vertexShader: FOIL_VERTEX, fragmentShader: FOIL_FRAGMENT, toneMapped: false });
      own(() => faceMat.dispose());
      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.z = D / 2 + B + 0.0015;
      rimMat.emissive = new THREE.Color(0x8a5f14);
      const backMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.6, metalness: 0.2 }); own(() => backMat.dispose());
      const back = new THREE.Mesh(faceGeo, backMat); back.rotation.y = Math.PI; back.position.z = -faceMesh.position.z;
      const card = new THREE.Group(); card.add(body, faceMesh, back); scene.add(card);

      let artTex: { dispose(): void } | null = null;
      own(() => { artTex?.dispose(); artTex = null; });
      let maskTex: { dispose(): void } | null = null;
      own(() => { maskTex?.dispose(); maskTex = null; });
      let onScreen = true, dirty = true, last = 0, lastDraw = 0;
      let pointerUV: { u: number; v: number } | null = null;
      let cur: JokerTilt = { ...JOKER_REST };
      const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; };

      const frame = (t: number) => {
        raf = 0;
        if (dead) return;
        const dt = last ? t - last : 16; last = t;
        const red = !!reduced?.matches;
        const r = stepTilt(cur, red ? JOKER_REST : targetRef.current, red ? 1000 : dt);
        cur = r.tilt;
        if (shouldDrawFrame(t, lastDraw, dirty || !r.settled || !!pointerUV)) {
          lastDraw = t; dirty = false;
          card.rotation.set(THREE.MathUtils.degToRad(cur.rx), THREE.MathUtils.degToRad(cur.ry), 0);
          const f = foilState({ pointer: pointerUV, tilt: cur, tMs: t, reduced: red });
          foilUniforms.uPos.value = f.pos; foilUniforms.uStrength.value = f.strength;
          // Gold edge answers the same band: brightest as the sweep crosses the card.
          rimMat.emissiveIntensity = 0.06 + 0.42 * f.strength * Math.exp(-(((f.pos - 0.5) / 0.4) ** 2));
          try { renderer.render(scene, camera); } catch { fail("render"); return; }
        }
        if (!dead && wantsLoop({ onScreen, docHidden: document.hidden, reduced: red, settled: r.settled, dirty })) raf = requestAnimationFrame(frame);
        else last = 0;
      };
      const kick = () => {
        if (dead) return;
        dirty = true;
        if (!raf && artTex && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
      };
      kickRef.current = kick;
      const resize = () => {
        if (dead) return;
        try {
          const w = host.clientWidth || 1, h = host.clientHeight || 1;
          renderer.setSize(w, h, false);
          camera.aspect = w / h; camera.position.set(0, 0, fitCameraDistance(w / h, camera.fov)); camera.updateProjectionMatrix();
        } catch { fail("render"); return; }
        kick();
      };

      new THREE.ImageLoader().load(JOKER_IMAGE_URL, (img: HTMLImageElement) => {
        // Late arrival after unmount/failure: nothing allocated yet, do nothing.
        if (dead) return;
        try {
          const tex = new THREE.CanvasTexture(composeJokerFace(img));
          const mask = new THREE.CanvasTexture(composeJokerFoilMask());
          artTex = tex; maskTex = mask;
          tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          foilUniforms.uMap.value = tex; foilUniforms.uMask.value = mask;
        } catch { fail("texture"); return; }
        setStatus("ready"); kick();
      }, undefined, () => fail("texture"));

      const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
      const pickUV = (e: PointerEvent) => {
        const b = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - b.left) / (b.width || 1)) * 2 - 1, -((e.clientY - b.top) / (b.height || 1)) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(faceMesh, false)[0];
        pointerUV = hit?.uv ? { u: hit.uv.x, v: hit.uv.y } : { u: (ndc.x + 1) / 2, v: (ndc.y + 1) / 2 };
      };
      // Pointer: captured on the canvas only; page scroll outside the canvas is untouched.
      let drag: { id: number; x: number; y: number; base: JokerTilt } | null = null;
      const down = (e: PointerEvent) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, base: { ...targetRef.current } }; canvas.setPointerCapture?.(e.pointerId); pickUV(e); kick(); };
      const move = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        targetRef.current = dragToTilt(drag.base, e.clientX - drag.x, e.clientY - drag.y, canvas.clientWidth, canvas.clientHeight, !!reduced?.matches);
        pickUV(e); kick();
      };
      const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { canvas.releasePointerCapture?.(e.pointerId); drag = null; pointerUV = null; kick(); } };
      const keydown = (e: KeyboardEvent) => {
        const step = ({ ArrowLeft: [0, -40], ArrowRight: [0, 40], ArrowUp: [-40, 0], ArrowDown: [40, 0] } as Record<string, number[]>)[e.key];
        if (step) { e.preventDefault(); targetRef.current = dragToTilt(targetRef.current, step[1], step[0], 400, 400, !!reduced?.matches); kick(); }
        else if (e.key === "Escape" || e.key === "0") { targetRef.current = JOKER_REST; kick(); }
      };
      const vis = () => { if (!document.hidden) kick(); else stop(); };
      const listen = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void) => {
        canvas.addEventListener(t, fn); own(() => canvas.removeEventListener(t, fn));
      };
      listen("pointerdown", down); listen("pointermove", move); listen("pointerup", up); listen("pointercancel", up); listen("keydown", keydown);
      document.addEventListener("visibilitychange", vis); own(() => document.removeEventListener("visibilitychange", vis));
      const motionChange = () => kick();
      reduced?.addEventListener?.("change", motionChange); own(() => reduced?.removeEventListener?.("change", motionChange));
      if (typeof IntersectionObserver !== "undefined") {
        const io = new IntersectionObserver(([en]) => { onScreen = !!en?.isIntersecting; if (onScreen) kick(); else stop(); });
        io.observe(host); own(() => io.disconnect());
      }
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(resize); ro.observe(host); own(() => ro.disconnect());
      }
      resize();
    } catch {
      fail("render");
    }
    return teardown;
  }, []);

  return (
    <div ref={hostRef} className="dw-jk" data-testid="stage-joker-webgl" data-status={status}>
      {status === "loading" && <div className="dw-jk-status" role="status" aria-live="polite" data-testid="status-joker-loading">Loading 3D card…</div>}
      {status === "unavailable" && (
        <div className="dw-jk-fallback" data-testid="status-joker-fallback">
          <img src={JOKER_IMAGE_URL} alt={face.label} width={500} height={711} data-testid="img-joker-static" />
          <p className="dw-jk-note" role="status" data-testid="text-joker-3d-unavailable">{reason ? JOKER_UNAVAILABLE_TEXT[reason] : JOKER_UNAVAILABLE_TEXT.render} Showing the original card.</p>
        </div>
      )}
    </div>
  );
}
