import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import type { DeveloperGiftMotionPreset } from "@workspace/api-client-react";

export type GiftMotionModelInfo = {
  animationNames: string[];
  dimensions: [number, number, number];
};

export type GiftMotionPreviewProps = {
  src: string;
  category: DeveloperGiftMotionPreset["category"];
  motion: DeveloperGiftMotionPreset;
  loop: boolean;
  onModelInfo?: (info: GiftMotionModelInfo) => void;
  onProgress?: (progress: number) => void;
  onError?: (message: string) => void;
  onFinish?: () => void;
};

const entryPoint: Record<DeveloperGiftMotionPreset["entry"], [number, number, number]> = {
  left: [-2.6, 0, 0],
  right: [2.6, 0, 0],
  top: [0, 2.35, 0],
  bottom: [0, -2.35, 0],
  depth: [0, 0, -3.3],
};

class PreviewBoundary extends Component<{
  children: ReactNode;
  onError?: (message: string) => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error.message || "The 3D model could not be rendered.");
  }
  render() {
    if (this.state.failed) {
      return <div className="gift-motion-preview-fallback" role="status">3D preview is unavailable on this device.</div>;
    }
    return this.props.children;
  }
}

function ModelScene({
  src,
  category,
  motion,
  loop,
  onModelInfo,
  onProgress,
  onError,
  onFinish,
}: GiftMotionPreviewProps) {
  const draco = useMemo(() => new DRACOLoader(), []);
  const callbacks = useRef({ onModelInfo, onProgress, onError, onFinish });
  callbacks.current = { onModelInfo, onProgress, onError, onFinish };
  const gltf = useLoader(
    GLTFLoader,
    src,
    (loader) => {
      draco.setDecoderPath(`${import.meta.env.BASE_URL}scene-draco/gltf/`);
      loader.setDRACOLoader(draco);
    },
    (event) => {
      if (event.total > 0) callbacks.current.onProgress?.(Math.min(1, event.loaded / event.total));
    },
  );
  const root = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const { camera } = useThree();
  const startedAt = useRef<number | null>(null);
  const finished = useRef(false);
  const animationMixer = useRef<any>(null);
  const motionGroup = useRef<any>(null);
  const normalizedModel = useMemo(() => {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const dimensions = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
    root.position.sub(center);
    root.scale.setScalar(1.7 / maxDimension);
    root.traverse((child: any) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    return {
      root,
      dimensions: [dimensions.x, dimensions.y, dimensions.z] as [number, number, number],
    };
  }, [root]);

  useEffect(() => {
    callbacks.current.onProgress?.(1);
    callbacks.current.onModelInfo?.({
      animationNames: gltf.animations.map((clip: any) => clip.name || "Animation"),
      dimensions: normalizedModel.dimensions,
    });
    const selectedAnimation = motion.animationIndex === null ? null : gltf.animations[motion.animationIndex];
    if (selectedAnimation) {
      const mixer = new THREE.AnimationMixer(normalizedModel.root);
      const action = mixer.clipAction(selectedAnimation);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.play();
      animationMixer.current = mixer;
    }
    return () => {
      animationMixer.current?.stopAllAction();
      animationMixer.current = null;
    };
  }, [gltf.animations, loop, motion.animationIndex, normalizedModel]);

  useEffect(() => {
    const radius = 4.4;
    camera.position.set(
      Math.sin(motion.cameraYaw) * radius,
      Math.sin(motion.cameraPitch) * radius,
      Math.cos(motion.cameraYaw) * radius,
    );
    camera.lookAt(0, 0, 0);
  }, [camera, motion.cameraYaw, motion.cameraPitch]);

  useEffect(() => () => draco.dispose(), [draco]);

  useFrame((state, delta) => {
    const group = motionGroup.current;
    if (!group) return;
    if (startedAt.current === null) startedAt.current = state.clock.elapsedTime;
    const startTime = startedAt.current ?? state.clock.elapsedTime;
    startedAt.current = startTime;
    const elapsed = Math.max(0, state.clock.elapsedTime - startTime);
    const duration = motion.durationMs / 1000;
    const cycleElapsed = loop ? elapsed % duration : Math.min(elapsed, duration);
    const raw = cycleElapsed / duration;
    const eased = (value: number) => {
      const t = Math.max(0, Math.min(1, value));
      return t * t * (3 - 2 * t);
    };
    const enter = eased(raw / 0.18);
    const leave = eased((raw - 0.82) / 0.18);
    const from = entryPoint[motion.entry];
    const to = entryPoint[motion.exit];
    const phase = Math.max(0, Math.min(1, (raw - 0.18) / 0.64));
    const drift = Math.sin(raw * Math.PI * 2 * 1.6) * motion.drift * 0.3;
    group.position.set(
      (from[0] * (1 - enter)) * (1 - leave) + to[0] * leave + drift,
      (from[1] * (1 - enter)) * (1 - leave) + to[1] * leave
        + Math.sin(raw * Math.PI * 5) * motion.bounce * 0.13,
      (from[2] * (1 - enter)) * (1 - leave) + to[2] * leave,
    );
    const scaleIn = 0.82 + 0.18 * enter;
    group.scale.setScalar(scaleIn * (1 - leave * 0.15));
    group.rotation.set(
      motion.spin[0] * phase,
      motion.spin[1] * phase,
      motion.spin[2] * phase,
    );
    if (category === "vehicle") group.rotation.y += Math.sin(raw * Math.PI * 2) * motion.drift * 0.2;
    animationMixer.current?.update(delta * motion.speed);
    if (!loop && raw >= 1 && !finished.current) {
      finished.current = true;
      callbacks.current.onFinish?.();
    }
  });

  useEffect(() => {
    startedAt.current = null;
    finished.current = false;
  }, [
    src,
    motion.entry,
    motion.exit,
    motion.speed,
    motion.spin[0],
    motion.spin[1],
    motion.spin[2],
    motion.drift,
    motion.bounce,
    motion.cameraYaw,
    motion.cameraPitch,
    motion.animationIndex,
  ]);

  return (
    <>
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#dcd7ff", "#160c2b", 1.1]} />
      <directionalLight position={[2.5, 3.5, 4]} intensity={2.2} color="#fff4e8" />
      <pointLight position={[-2, 0.5, 1]} intensity={2.6} color="#bd52ff" />
      <pointLight position={[1.5, -1.5, -1]} intensity={1.5} color="#ff4bd8" />
      <group ref={motionGroup}>
        <primitive object={normalizedModel.root} dispose={null} />
      </group>
    </>
  );
}

export function GiftMotionPreview(props: GiftMotionPreviewProps) {
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      const context = probe.getContext("webgl2", { alpha: true }) || probe.getContext("webgl", { alpha: true });
      if (!context) {
        setWebglReady(false);
        onErrorRef.current?.("This browser does not provide WebGL.");
        return;
      }
      context.getExtension("WEBGL_lose_context")?.loseContext();
      setWebglReady(true);
    } catch {
      setWebglReady(false);
      onErrorRef.current?.("This browser could not start WebGL.");
    }
  }, []);
  if (webglReady === false) {
    return <div className="gift-motion-preview-fallback" role="status">3D preview is unavailable on this device.</div>;
  }
  if (webglReady === null) {
    return <div className="gift-motion-preview-fallback" role="status">Checking 3D support…</div>;
  }
  return (
    <PreviewBoundary key={props.src} onError={props.onError}>
      <Canvas
        className="gift-motion-preview-canvas"
        dpr={[1, 1.25]}
        camera={{ position: [0, 0, 4.4], fov: 36 }}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          props.onProgress?.(0);
        }}
      >
        <ModelScene {...props} />
      </Canvas>
    </PreviewBoundary>
  );
}

