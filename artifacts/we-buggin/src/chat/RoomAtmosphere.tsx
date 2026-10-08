import { useEffect, useRef, useState } from "react";
import type { CommunityAtmosphere } from "@workspace/api-client-react";
import { roomVideoMapping, type Scene } from "./video-config";

function SceneLayer({ scene, outgoing, reduced }: { scene: Scene; outgoing: boolean; reduced: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const source = roomVideoMapping[scene].src;
  useEffect(() => {
    setFailed(false);
    const sync = () => {
      const el = video.current;
      if (!el) return;
      if (document.hidden || reduced || outgoing) el.pause();
      else void el.play().catch(() => setFailed(true));
    };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); video.current?.pause(); };
  }, [source, reduced, outgoing]);
  return <div className={`room-scene room-scene-${scene}${outgoing ? " is-outgoing" : ""}`}
    data-testid="atmosphere-layer" data-scene={scene}>
    {source && !reduced && !failed && <video ref={video} src={source} autoPlay muted playsInline loop
      preload="metadata" tabIndex={-1} aria-hidden="true" onError={() => setFailed(true)} />}
  </div>;
}

export function RoomAtmosphere({ atmosphere }: { atmosphere?: CommunityAtmosphere }) {
  const scene = atmosphere?.scene ?? "calm";
  const previous = useRef<Scene>(scene);
  const [outgoing, setOutgoing] = useState<Scene | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (previous.current === scene) return;
    const last = previous.current; previous.current = scene;
    if (reduced) { setOutgoing(null); return; }
    setOutgoing(last);
    const timer = setTimeout(() => setOutgoing(null), 1800);
    return () => clearTimeout(timer);
  }, [scene, reduced]);
  return <div className="room-atmosphere" aria-hidden="true" data-testid="room-atmosphere"
    data-scene={scene} data-assets={roomVideoMapping[scene].src ? "configured" : "placeholder"}>
    <style>{`
      .room-atmosphere{position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate;background:#050505}
      .room-scene{position:absolute;inset:0;pointer-events:none;animation:room-scene-in 1.8s ease both}
      .room-scene.is-outgoing{z-index:1;animation:room-scene-out 1.8s ease forwards}
      .room-scene video{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;object-fit:cover;object-position:center;pointer-events:none}
      .room-atmosphere:after{content:"";position:absolute;inset:0;background:rgba(4,5,10,.78);z-index:2;pointer-events:none}
      @keyframes room-scene-in{from{opacity:0}to{opacity:1}}
      @keyframes room-scene-out{from{opacity:1}to{opacity:0}}
      @media(prefers-reduced-motion:reduce){.room-scene{animation:none!important}.room-scene.is-outgoing{display:none}}
    `}</style>
    <SceneLayer key={scene} scene={scene} outgoing={false} reduced={reduced} />
    {outgoing && outgoing !== scene && <SceneLayer key={outgoing} scene={outgoing} outgoing reduced={reduced} />}
  </div>;
}
