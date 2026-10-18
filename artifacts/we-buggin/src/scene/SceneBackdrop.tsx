import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, SSAO } from "@react-three/postprocessing";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import "./SceneBackdrop.css";
import { sceneSettings } from "./sceneSettings";
import colorMapUrl from "./maps/nebula-color.svg?url";
import roughnessMapUrl from "./maps/nebula-roughness.svg?url";
import metalnessMapUrl from "./maps/nebula-metalness.svg?url";
import normalMapUrl from "./maps/nebula-normal.svg?url";

export type SceneVector3 = [number, number, number];

export interface SceneModel {
  id: string;
  url: string;
  position: SceneVector3;
  rotation: SceneVector3;
  scale: number | SceneVector3;
}

export interface ModelLoadStatus {
  id: string;
  url: string;
  status: "loading" | "progress" | "loaded" | "error";
  progress?: number;
  error?: Error;
}

export interface SceneBackdropProps {
  models?: SceneModel[];
  onModelLoad?: (status: ModelLoadStatus) => void;
}

type GestureState = {
  azimuth: number;
  polar: number;
  distance: number;
  targetAzimuth: number;
  targetPolar: number;
  targetDistance: number;
  pointerX: number;
  pointerY: number;
  tapPulse: number;
};

const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "button, a, input, textarea, select, [role='button'], [role='link'], [contenteditable='true'], video, canvas:not(.st-scene-canvas)",
  ));
};

const isSceneGestureSurface = (target: EventTarget | null) =>
  target === document.body
  || target === document.documentElement
  || target === document.getElementById("root")
  || (target instanceof Element && target.classList.contains("app-page"));

function disposeModelObject(root: any) {
  root?.traverse?.((child: any) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material) as unknown[]) {
        if (value && typeof value === "object" && "isTexture" in value
          && "dispose" in value && typeof value.dispose === "function") {
          value.dispose();
        }
      }
      material.dispose?.();
    }
  });
}

const makeEnvironmentMap = () => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#35254c");
  gradient.addColorStop(0.42, "#171526");
  gradient.addColorStop(1, "#060812");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(340, 94, 5, 340, 94, 155);
  glow.addColorStop(0, "rgba(181, 80, 155, .62)");
  glow.addColorStop(0.38, "rgba(82, 59, 131, .23)");
  glow.addColorStop(1, "rgba(30, 22, 52, 0)");
  context.fillStyle = glow;
  context.fillRect(170, 0, 342, 230);
  const teal = context.createRadialGradient(65, 178, 4, 65, 178, 116);
  teal.addColorStop(0, "rgba(55, 135, 138, .32)");
  teal.addColorStop(1, "rgba(12, 22, 35, 0)");
  context.fillStyle = teal;
  context.fillRect(0, 60, 190, 196);
  for (let index = 0; index < 70; index += 1) {
    const x = (index * 197 + 41) % canvas.width;
    const y = (index * 83 + 29) % canvas.height;
    context.fillStyle = `rgba(221, 208, 255, ${index % 5 === 0 ? 0.45 : 0.17})`;
    context.fillRect(x, y, index % 7 === 0 ? 2 : 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

function AtmosphericEnvironment() {
  const { scene } = useThree();
  const environment = useMemo(makeEnvironmentMap, []);
  useEffect(() => {
    if (!environment) return undefined;
    scene.environment = environment;
    scene.environmentIntensity = 0.38;
    return () => {
      scene.environment = null;
      environment.dispose();
    };
  }, [environment, scene]);
  return null;
}

function CameraDrift({
  gesture,
  reducedMotion,
  invalidateRef,
}: {
  gesture: MutableRefObject<GestureState>;
  reducedMotion: boolean;
  invalidateRef: MutableRefObject<(() => void) | null>;
}) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  useFrame((_, delta) => {
    const state = gesture.current;
    const damping = 1 - Math.pow(1 - sceneSettings.camera.damping, Math.min(delta * 60, 4));
    state.azimuth += (state.targetAzimuth - state.azimuth) * damping;
    state.polar += (state.targetPolar - state.polar) * damping;
    state.distance += (state.targetDistance - state.distance) * damping;
    const idleDrift = reducedMotion ? 0 : Math.sin(performance.now() * 0.00012) * 0.018;
    const spherical = new THREE.Spherical(state.distance, state.polar, state.azimuth + idleDrift);
    camera.position.setFromSpherical(spherical);
    camera.lookAt(0, 0, 0);
    if (Math.abs(state.targetAzimuth - state.azimuth) > 0.001
      || Math.abs(state.targetPolar - state.polar) > 0.001
      || Math.abs(state.targetDistance - state.distance) > 0.01
      || !reducedMotion) invalidate();
  });
  return null;
}

function MovingLights({ reducedMotion }: { reducedMotion: boolean }) {
  const warm = useRef<any>(null);
  const cool = useRef<any>(null);
  useFrame(({ clock }) => {
    const time = reducedMotion ? 0 : clock.elapsedTime * sceneSettings.motion.lightSpeed;
    if (warm.current) {
      warm.current.position.set(Math.sin(time) * 5.3, 2.2 + Math.sin(time * 0.72) * 0.55, 2.3);
    }
    if (cool.current) {
      cool.current.position.set(Math.cos(time * 0.76) * 5.8, -1.1 + Math.cos(time) * 0.65, -2.5);
    }
  });
  return (
    <>
      <ambientLight intensity={0.48} color="#b9b0d4" />
      <hemisphereLight args={["#9f8dbc", "#111522", 0.52]} />
      <pointLight ref={warm} color="#d060a3" intensity={12} distance={15} decay={2} />
      <pointLight ref={cool} color="#42b5ba" intensity={9} distance={14} decay={2} />
      <directionalLight position={[-4, 5, 6]} color="#c8b5ff" intensity={1.45} />
    </>
  );
}

function Starfield({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const a = index * 2.399963229728653;
      const radius = 5.5 + ((index * 37) % 100) / 12;
      positions[index * 3] = Math.cos(a) * radius;
      positions[index * 3 + 1] = (((index * 53) % 100) / 100 - 0.5) * 9;
      positions[index * 3 + 2] = Math.sin(a) * radius - 3;
      sizes[index] = index % 13 === 0 ? 0.035 : 0.016;
    }
    const points = new THREE.BufferGeometry();
    points.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    points.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    return points;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#c9c3e3" size={0.025} sizeAttenuation transparent opacity={0.72} depthWrite={false} />
    </points>
  );
}

function AmbientRelics({
  count,
  textures,
  gesture,
  reducedMotion,
}: {
  count: number;
  textures: any[];
  gesture: MutableRefObject<GestureState>;
  reducedMotion: boolean;
}) {
  const refs = useRef<Array<any | null>>([]);
  const positions = useMemo(() => Array.from({ length: count }, (_, index) => {
    const angle = index * 2.399963229728653 + 0.35;
    const radius = 4.35 + (index % 3) * 0.48;
    return {
      position: [Math.cos(angle) * radius, ((index % 4) - 1.5) * 1.03, Math.sin(angle) * radius - 0.7] as SceneVector3,
      scale: 0.18 + (index % 4) * 0.035,
      speed: 0.13 + (index % 5) * 0.025,
      phase: index * 1.7,
    };
  }), [count]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    positions.forEach((item, index) => {
      const object = refs.current[index];
      if (!object) return;
      const p = gesture.current;
      const pointerNear = Math.abs(p.pointerX - item.position[0] / 8) < 0.2
        && Math.abs(p.pointerY + item.position[1] / 5) < 0.24;
      const pulse = pointerNear || p.tapPulse > 0 ? 1.13 : 1;
      const idle = reducedMotion ? 0 : Math.sin(t * item.speed + item.phase) * 0.11;
      object.position.y = item.position[1] + idle;
      object.rotation.y += reducedMotion ? 0 : 0.0018;
      object.scale.setScalar(item.scale * pulse);
    });
  });

  return (
    <group>
      {positions.map((item, index) => (
        <group key={index} ref={(node: any) => { refs.current[index] = node; }} position={item.position}>
          {index % 3 === 0 ? (
            <mesh rotation={[0.5, 0.2, 0.7]}>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial
                map={textures[0]} roughnessMap={textures[1]} metalnessMap={textures[2]}
                normalMap={textures[3]} roughness={0.43} metalness={0.65}
                emissive="#302044" emissiveIntensity={0.24} envMapIntensity={0.62}
              />
            </mesh>
          ) : (
            <mesh rotation={[0.7, index * 0.68, 0.2]}>
              <torusGeometry args={[0.78, 0.055, 8, 28]} />
              <meshStandardMaterial
                color={index % 2 === 0 ? "#956a9c" : "#488f91"}
                metalness={0.84} roughness={0.29} emissive="#38203d" emissiveIntensity={0.2}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function ModelAsset({
  model,
  onModelLoad,
}: {
  model: SceneModel;
  onModelLoad?: (status: ModelLoadStatus) => void;
}) {
  const [asset, setAsset] = useState<any | null>(null);
  const [failed, setFailed] = useState(false);
  const reportRef = useRef(onModelLoad);
  reportRef.current = onModelLoad;
  useEffect(() => {
    let active = true;
    let loadedObject: any = null;
    setAsset(null);
    setFailed(false);
    reportRef.current?.({ id: model.id, url: model.url, status: "loading", progress: 0 });
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}scene-draco/gltf/`);
    loader.setDRACOLoader(draco);
    loader.load(
      model.url,
      (gltf: { scene: any }) => {
        if (!active) return;
        const clone = gltf.scene.clone(true);
        clone.traverse((child: any) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        loadedObject = clone;
        setAsset(clone);
        reportRef.current?.({ id: model.id, url: model.url, status: "loaded", progress: 1 });
      },
      (event: { loaded: number; total: number }) => {
        if (!active) return;
        const progress = event.total > 0 ? event.loaded / event.total : undefined;
        reportRef.current?.({ id: model.id, url: model.url, status: "progress", progress });
      },
      (error: unknown) => {
        if (!active) return;
        setFailed(true);
        reportRef.current?.({
          id: model.id,
          url: model.url,
          status: "error",
          error: error instanceof Error ? error : new Error("Unable to load scene model."),
        });
      },
    );
    return () => {
      active = false;
      draco.dispose();
      disposeModelObject(loadedObject);
    };
  }, [model.id, model.url]);

  if (!asset || failed) return null;
  return (
    <primitive
      object={asset}
      position={model.position}
      rotation={model.rotation}
      scale={model.scale}
    />
  );
}

function SceneWorld({
  models,
  onModelLoad,
  gesture,
  invalidateRef,
  reducedMotion,
  lowEnd,
}: {
  models: SceneModel[];
  onModelLoad?: (status: ModelLoadStatus) => void;
  gesture: MutableRefObject<GestureState>;
  invalidateRef: MutableRefObject<(() => void) | null>;
  reducedMotion: boolean;
  lowEnd: boolean;
}) {
  const textures = useMemo(() => new THREE.TextureLoader(), []);
  const [color, roughness, metalness, normal] = useMemo(() => [
    textures.load(colorMapUrl),
    textures.load(roughnessMapUrl),
    textures.load(metalnessMapUrl),
    textures.load(normalMapUrl),
  ], [textures]);
  const mapSet = useMemo<any[]>(() => {
    color.colorSpace = THREE.SRGBColorSpace;
    [color, roughness, metalness, normal].forEach((texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.5, 2.5);
      texture.anisotropy = 2;
    });
    return [color, roughness, metalness, normal];
  }, [color, roughness, metalness, normal]);

  useEffect(() => () => mapSet.forEach((texture) => texture.dispose()), [mapSet]);

  return (
    <>
      <AtmosphericEnvironment />
      <MovingLights reducedMotion={reducedMotion} />
      <CameraDrift gesture={gesture} reducedMotion={reducedMotion} invalidateRef={invalidateRef} />
      <Starfield count={lowEnd ? sceneSettings.quality.lowEndParticleCount : sceneSettings.quality.particleCount} />
      <AmbientRelics
        count={lowEnd ? sceneSettings.quality.lowEndObjectCount : sceneSettings.quality.objectCount}
        textures={mapSet}
        gesture={gesture}
        reducedMotion={reducedMotion}
      />
      {models.slice(0, sceneSettings.quality.maxModels).map((model) => (
        <ModelAsset key={model.id} model={model} onModelLoad={onModelLoad} />
      ))}
      {!lowEnd && <EffectComposer multisampling={0}>
        <Bloom intensity={sceneSettings.postProcessing.bloom} luminanceThreshold={0.78} luminanceSmoothing={0.24} />
        <DepthOfField focusDistance={0.025} focalLength={0.018} bokehScale={sceneSettings.postProcessing.depthOfField} />
        <SSAO intensity={sceneSettings.postProcessing.ambientOcclusion} radius={0.12} luminanceInfluence={0.34} />
      </EffectComposer>}
    </>
  );
}

const initialGesture = (): GestureState => ({
  azimuth: 0,
  polar: Math.PI / 2,
  distance: sceneSettings.camera.initialDistance,
  targetAzimuth: 0,
  targetPolar: Math.PI / 2,
  targetDistance: sceneSettings.camera.initialDistance,
  pointerX: 0,
  pointerY: 0,
  tapPulse: 0,
});

function SceneBackdrop({ models = [], onModelLoad }: SceneBackdropProps) {
  const gesture = useRef<GestureState>(initialGesture());
  const invalidateRef = useRef<(() => void) | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; target: EventTarget | null }>());
  const touchStart = useRef<{ x: number; y: number; distance: number; eligible: boolean } | null>(null);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowEnd, setLowEnd] = useState(false);
  const [dpr, setDpr] = useState(1);

  const updateMotionPreference = useCallback(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    updateMotionPreference();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", updateMotionPreference);
    const updateVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const weak = (navigator.hardwareConcurrency || 8) <= 4
      || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
      || Boolean(connection?.saveData);
    setLowEnd(weak);
    setDpr(Math.min(window.devicePixelRatio || 1, weak ? sceneSettings.quality.lowEndDpr : sceneSettings.quality.maxDpr));
    return () => {
      media.removeEventListener("change", updateMotionPreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [updateMotionPreference]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = pointers.current.get(event.pointerId);
      if (active && active.target && isInteractiveTarget(active.target)) return;
      gesture.current.pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      gesture.current.pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      invalidateRef.current?.();
      if (!active || !isSceneGestureSurface(active.target) || event.pointerType === "touch") return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        gesture.current.targetAzimuth = THREE.MathUtils.clamp(
          gesture.current.targetAzimuth - dx * 0.0034,
          sceneSettings.camera.minAzimuth,
          sceneSettings.camera.maxAzimuth,
        );
        gesture.current.targetPolar = THREE.MathUtils.clamp(
          gesture.current.targetPolar + dy * 0.0024,
          sceneSettings.camera.minPolar,
          sceneSettings.camera.maxPolar,
        );
      }
      active.x = event.clientX;
      active.y = event.clientY;
      invalidateRef.current?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isSceneGestureSurface(event.target) || isInteractiveTarget(event.target)) return;
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, target: event.target });
        gesture.current.tapPulse = 1;
        invalidateRef.current?.();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId);
      gesture.current.tapPulse = 0;
      invalidateRef.current?.();
    };
    const onTouchStart = (event: TouchEvent) => {
      const eligible = isSceneGestureSurface(event.target) && !isInteractiveTarget(event.target);
      if (!eligible || event.touches.length === 0) {
        touchStart.current = null;
        return;
      }
      const touch = event.touches[0];
      const distance = event.touches.length > 1
        ? Math.hypot(event.touches[1].clientX - touch.clientX, event.touches[1].clientY - touch.clientY)
        : 0;
      touchStart.current = { x: touch.clientX, y: touch.clientY, distance, eligible };
      gesture.current.tapPulse = 1;
      invalidateRef.current?.();
    };
    const onTouchMove = (event: TouchEvent) => {
      const start = touchStart.current;
      if (!start?.eligible || event.touches.length === 0) return;
      if (event.touches.length > 1) {
        const [a, b] = [event.touches[0], event.touches[1]];
        const nextDistance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const delta = start.distance - nextDistance;
        gesture.current.targetDistance = THREE.MathUtils.clamp(
          gesture.current.targetDistance + delta * 0.018,
          sceneSettings.camera.minDistance,
          sceneSettings.camera.maxDistance,
        );
        start.distance = nextDistance;
        event.preventDefault();
        invalidateRef.current?.();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        gesture.current.targetAzimuth = THREE.MathUtils.clamp(
          gesture.current.targetAzimuth - dx * 0.0034,
          sceneSettings.camera.minAzimuth,
          sceneSettings.camera.maxAzimuth,
        );
        gesture.current.targetPolar = THREE.MathUtils.clamp(
          gesture.current.targetPolar + dy * 0.0024,
          sceneSettings.camera.minPolar,
          sceneSettings.camera.maxPolar,
        );
        event.preventDefault();
      }
      start.x = touch.clientX;
      start.y = touch.clientY;
      invalidateRef.current?.();
    };
    const onTouchEnd = () => {
      if (pointers.current.size === 0) {
        touchStart.current = null;
        gesture.current.tapPulse = 0;
        invalidateRef.current?.();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("touchstart", onTouchStart, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchEnd, true);
    };
  }, []);

  const safeModels = useMemo(() => models.slice(0, sceneSettings.quality.maxModels), [models]);
  return (
    <div className="st-scene-backdrop" aria-hidden="true">
      <Canvas
        className="st-scene-canvas"
        frameloop={visible ? "demand" : "never"}
        dpr={dpr}
        camera={{ position: [0, 0, sceneSettings.camera.initialDistance], fov: 37, near: 0.1, far: 60 }}
        gl={{ alpha: true, antialias: false, powerPreference: "low-power", toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ gl }) => {
          gl.setClearColor("#090813", 0);
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <SceneWorld
          models={safeModels}
          onModelLoad={onModelLoad}
          gesture={gesture}
          invalidateRef={invalidateRef}
          reducedMotion={reducedMotion}
          lowEnd={lowEnd}
        />
        {!reducedMotion && visible && <ContinuousInvalidation fps={lowEnd ? 24 : 30} />}
      </Canvas>
    </div>
  );
}

function ContinuousInvalidation({ fps }: { fps: number }) {
  const { invalidate } = useThree();
  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const frame = () => {
      if (stopped) return;
      invalidate();
      timer = window.setTimeout(frame, 1000 / fps);
    };
    frame();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [fps, invalidate]);
  return null;
}

export default SceneBackdrop;
